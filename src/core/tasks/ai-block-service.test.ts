import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI, type FakeReply } from '../../../tests/fixtures/compiler/fake-ai';
import { irToSpec } from '../compiler/convert';
import { compilerIRSchema } from '../compiler/ir';
import type { AIBlockVerificationOutcome, StructuredRequest } from '../contracts';
import type { KalamAIBlock, KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import {
  blockHash, blockPolicy, createAIBlockService, needsReverification, recordVerification, reusableCases, sameValue,
  splitUnsure, verificationMetrics, verificationReport, VERIFY_PROMPT_VERSION,
} from './ai-block-service';

const ir = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const tailor = irToSpec(ir, { appId: 'app_tailor01', now: 1 });
const spec: KalamSpec = {
  ...tailor,
  aiBlocks: {
    ...tailor.aiBlocks,
    note_kind: { kind: 'classify', prompt: 'Is this note urgent, normal or about payment?', verified: 'unverified', labels: ['Urgent', 'Normal', 'Payment'], inputField: 'notes', outputField: 'notes' },
    note_summary: { kind: 'summarise', prompt: 'Summarise the note.', verified: 'cloudPreferred', inputField: 'notes', outputField: 'notes', maxWords: 10 },
    note_hindi: { kind: 'translate', prompt: 'Translate the note.', verified: 'onDevice', inputField: 'notes', outputField: 'notes', targetLang: 'hi' },
  },
};
const IMAGE = { mimeType: 'image/jpeg' as const, base64: '/9j/AAAA' };
const runInput = (blockId: string, formValues: Record<string, string> = {}, image?: typeof IMAGE) => ({
  appId: spec.id, blockId, block: spec.aiBlocks[blockId], spec, formValues, image,
});

describe('AI block run', () => {
  it('coerces photo extraction output to the target field types', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: () => ({
        raw: {
          customer: ' Raju ', garment: 'kurta', chest: '40 in', waist: 'thirty', sleeve: 200, delivery: '25/12/2026',
          advance: '1,500', length: null, hacker: 'drop me',
        },
      }),
    });
    const r = await createAIBlockService({ ai }).run(runInput('slip_to_order', {}, IMAGE));
    expect(r.success).toBe(true);
    expect(r.output).toEqual({ customer: 'Raju', garment: 'Kurta', chest: 40, waist: 30, delivery: '2026-12-25', advance: 1500 });
    expect(r.source).toBe('on_device');
    expect(ai.calls[0].req).toMatchObject({ taskType: 'extract_data', mode: 'prefer_on_device' });
    expect(ai.calls[0].req.images).toEqual([IMAGE]);
  });

  it('validates input before inference', async () => {
    const ai = createFakeAI({ onDevice: 'available' });
    const svc = createAIBlockService({ ai });
    expect(await svc.run(runInput('slip_to_order'))).toMatchObject({ success: false, errorCode: 'unsupported_modality' });
    expect(await svc.run(runInput('note_kind', { notes: '   ' }))).toMatchObject({ success: false });
    expect(ai.calls).toHaveLength(0);
  });

  it('constrains classification to the declared labels', async () => {
    const ok = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { label: 'urgent' } }) });
    expect((await createAIBlockService({ ai: ok }).run(runInput('note_kind', { notes: 'Deliver by tonight!' }))).output).toEqual({ notes: 'Urgent' });
    const bad = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { label: 'spam' } }) });
    expect(await createAIBlockService({ ai: bad }).run(runInput('note_kind', { notes: 'x' }))).toMatchObject({ success: false, errorCode: 'invalid_output' });
  });

  it('routes cloudPreferred blocks to cloud first and caps summary length', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { summary: 'one two three four five six seven eight nine ten eleven twelve' } }) });
    const r = await createAIBlockService({ ai }).run(runInput('note_summary', { notes: 'long text' }));
    expect(ai.calls[0].req.mode).toBe('prefer_in_cloud');
    expect(r.output).toEqual({ notes: 'one two three four five six seven eight nine ten' });
  });

  it('translates with the translation role', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { text: 'नमस्ते' } }) });
    const r = await createAIBlockService({ ai }).run(runInput('note_hindi', { notes: 'Hello' }));
    expect(r.output).toEqual({ notes: 'नमस्ते' });
    expect(ai.calls[0].req).toMatchObject({ role: 'translation', taskType: 'translate', mode: 'prefer_on_device' });
  });
});

describe('sameValue grading', () => {
  it('handles exact, normalised and numeric tolerance', () => {
    expect(sameValue('Urgent', 'urgent.')).toBe(true);
    expect(sameValue('40', 40.2)).toBe(true);
    expect(sameValue('40', 42)).toBe(false);
    expect(sameValue('Payment', 'Urgent')).toBe(false);
  });
});

describe('AI block verification', () => {
  const inputs = ['Pay the cloth bill', 'Deliver Raju kurta tonight', 'Regular alteration', 'Advance pending', 'Wedding order due tomorrow'];
  const expected = ['Payment', 'Urgent', 'Normal', 'Payment', 'Urgent'];
  const isCaseGen = (r: StructuredRequest<unknown>) => r.taskType === 'verify_ai_block' && (r.system ?? '').includes('write test cases');

  /** Nano answers the first `correct` cases right and the rest wrong. */
  const classifyResponder = (correct: number) => (r: StructuredRequest<unknown>): FakeReply => {
    if (isCaseGen(r)) return { raw: { cases: inputs.map((input, i) => ({ input, expected: expected[i].toLowerCase() })) } };
    const i = inputs.findIndex((t) => r.prompt.includes(t));
    return { raw: { label: i < correct ? expected[i] : expected[i] === 'Normal' ? 'Urgent' : 'Normal' } };
  };

  it('marks a block onDevice at 4/5 passes, after really running on device', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: classifyResponder(4) });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind');
    expect(v).toMatchObject({ status: 'onDevice', testCount: 5, passCount: 4, model: 'gemini-nano' });
    expect(ai.calls[0].req).toMatchObject({ taskType: 'verify_ai_block', role: 'judge', mode: 'only_in_cloud' });
    const runs = ai.calls.filter((c) => c.req.taskType === 'classify');
    expect(runs).toHaveLength(5);
    expect(runs.every((c) => c.req.mode === 'only_on_device' && c.result.source === 'on_device')).toBe(true);
    // Labels are graded deterministically: no judge call.
    expect(ai.calls).toHaveLength(6);
  });

  it('marks a block cloudPreferred at 3/5', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: classifyResponder(3) });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind');
    expect(v).toMatchObject({ status: 'cloudPreferred', testCount: 5, passCount: 3 });
    expect(v.details.filter((d) => !d.pass).every((d) => d.reason === 'wrong label')).toBe(true);
  });

  it('stays unverified when on-device AI is unavailable, without spending calls', async () => {
    const ai = createFakeAI({ onDevice: 'downloadable', respond: classifyResponder(5) });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind');
    expect(v).toMatchObject({ status: 'unverified', testCount: 0, passCount: 0 });
    expect(v.message).toMatch(/not ready/);
    expect(ai.calls).toHaveLength(0);
  });

  it('stays unverified when the cloud cannot write cases (offline)', async () => {
    const ai = createFakeAI({ onDevice: 'available', online: false, respond: classifyResponder(5) });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind');
    expect(v.status).toBe('unverified');
    expect(v.message).toMatch(/offline/i);
  });

  it('never verifies photo extraction without real sample photos', async () => {
    const ai = createFakeAI({ onDevice: 'available' });
    const v = await createAIBlockService({ ai }).verify(spec, 'slip_to_order');
    expect(v.status).toBe('unverified');
    expect(ai.calls).toHaveLength(0);
  });

  describe('photo extraction with sample photos', () => {
    const photo = (n: number) => ({ mimeType: 'image/jpeg' as const, base64: `/9j/PHOTO${n}` });
    const slips = [
      { customer: 'Raju', chest: 40, delivery: '2026-12-25' },
      { customer: 'Meena', chest: 34, delivery: '2026-12-20' },
      { customer: 'Arif', chest: 42, delivery: '2027-01-02' },
    ];
    /** Cloud reads every slip correctly; the device reads slip i as `device(i)`. */
    const photoResponder = (device: (i: number) => Record<string, unknown>) => (r: StructuredRequest<unknown>): FakeReply => {
      const i = Number(r.images?.[0]?.base64.replace('/9j/PHOTO', ''));
      return { raw: r.mode === 'only_in_cloud' ? slips[i] : device(i) };
    };

    it('marks onDevice when Nano reads every sample photo like the cloud does', async () => {
      const ai = createFakeAI({ onDevice: 'available', respond: photoResponder((i) => ({ ...slips[i], chest: `${slips[i].chest} in` })) });
      const v = await createAIBlockService({ ai }).verify(spec, 'slip_to_order', { samplePhotos: [photo(0), photo(1), photo(2)] });
      expect(v).toMatchObject({ status: 'onDevice', testCount: 3, passCount: 3, model: 'gemini-nano' });
      const cloud = ai.calls.filter((c) => c.req.mode === 'only_in_cloud');
      const device = ai.calls.filter((c) => c.req.mode === 'only_on_device');
      expect(cloud).toHaveLength(3);
      expect(cloud.every((c) => c.req.role === 'judge' && c.req.taskType === 'verify_ai_block' && c.req.images?.length === 1)).toBe(true);
      expect(device).toHaveLength(3);
      expect(device.every((c) => c.result.source === 'on_device' && c.req.taskType === 'extract_data')).toBe(true);
      expect(v.message).not.toMatch(/—/);
    });

    it('prefers the cloud when Nano misreads or guesses fields', async () => {
      const ai = createFakeAI({
        onDevice: 'available',
        respond: photoResponder((i) => (i === 0 ? slips[0] : i === 1 ? { ...slips[1], chest: 43 } : { ...slips[2], advance: 500 })),
      });
      const v = await createAIBlockService({ ai }).verify(spec, 'slip_to_order', { samplePhotos: [photo(0), photo(1), photo(2)] });
      expect(v).toMatchObject({ status: 'cloudPreferred', testCount: 3, passCount: 1 });
      expect(v.details[1]).toMatchObject({ pass: false, reason: 'different: chest' });
      expect(v.details[2]).toMatchObject({ pass: false, reason: 'different: advance' });
    });

    it('asks for more photos (and spends nothing) below the minimum', async () => {
      const ai = createFakeAI({ onDevice: 'available', respond: photoResponder((i) => slips[i]) });
      const v = await createAIBlockService({ ai }).verify(spec, 'slip_to_order', { samplePhotos: [photo(0)] });
      expect(v.status).toBe('unverified');
      expect(v.message).toMatch(/at least 3 sample photos/);
      expect(ai.calls).toHaveLength(0);
    });

    it('stays unverified when Nano cannot be used on this device', async () => {
      const ai = createFakeAI({ onDevice: 'unavailable', respond: photoResponder((i) => slips[i]) });
      const v = await createAIBlockService({ ai }).verify(spec, 'slip_to_order', { samplePhotos: [photo(0), photo(1), photo(2)] });
      expect(v.status).toBe('unverified');
      expect(ai.calls).toHaveLength(0);
    });
  });

  it('uses the cloud judge only for semantic summary equivalence', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (r) => {
        if (isCaseGen(r)) return { raw: { cases: inputs.map((input) => ({ input, expected: `About: ${input}` })) } };
        if (r.taskType === 'verify_ai_block') {
          return { raw: { verdicts: [0, 1, 2, 3, 4].map((index) => ({ index, pass: index !== 4, reason: index === 4 ? 'missing facts' : undefined })) } };
        }
        const i = inputs.findIndex((t) => r.prompt.includes(t));
        return { raw: { summary: i === 0 ? `About: ${inputs[0]}` : `Note regarding ${inputs[i]}` } };
      },
    });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_summary');
    const judgeCalls = ai.calls.filter((c) => c.req.taskType === 'verify_ai_block' && (c.req.system ?? '').includes('You grade'));
    expect(judgeCalls).toHaveLength(1);
    // Case 0 matched exactly (deterministic) so only 4 items went to the judge.
    expect(judgeCalls[0].req.prompt).not.toContain('#0');
    expect(v).toMatchObject({ status: 'onDevice', passCount: 4, testCount: 5, judgeUsed: true });
  });
});

describe('AI block check details (docs/13 §8)', () => {
  const inputs = ['Pay the cloth bill', 'Deliver Raju kurta tonight', 'Regular alteration', 'Advance pending', 'Wedding order due tomorrow'];
  const expected = ['Payment', 'Urgent', 'Normal', 'Payment', 'Urgent'];
  const isCaseGen = (r: StructuredRequest<unknown>) => r.taskType === 'verify_ai_block' && (r.system ?? '').includes('write test cases');
  const isJudge = (r: StructuredRequest<unknown>) => r.taskType === 'verify_ai_block' && (r.system ?? '').includes('You grade');
  const labelAll = (r: StructuredRequest<unknown>): FakeReply => {
    if (isCaseGen(r)) return { raw: { cases: inputs.map((input, i) => ({ input, expected: expected[i] })) } };
    return { raw: { label: expected[inputs.findIndex((t) => r.prompt.includes(t))] } };
  };

  it('says why a check gave no answer', async () => {
    const reasonOf = async (ai: ReturnType<typeof createFakeAI>, id = 'note_kind') => (await createAIBlockService({ ai }).verify(spec, id)).reason;
    expect(await reasonOf(createFakeAI({ onDevice: 'unavailable' }))).toBe('device_unsupported');
    expect(await reasonOf(createFakeAI({ onDevice: 'downloadable' }))).toBe('device_not_ready');
    expect(await reasonOf(createFakeAI({ onDevice: 'available', online: false }))).toBe('offline');
    expect(await reasonOf(createFakeAI({ onDevice: 'available', respond: () => ({ error: 'consent_denied' }) }))).toBe('cloud_off');
    expect(await reasonOf(createFakeAI({ onDevice: 'available' }), 'slip_to_order')).toBe('needs_samples');
    expect(await reasonOf(createFakeAI({ onDevice: 'available' }), 'gone')).toBe('failed');
  });

  it('re-runs stored cases without asking the cloud for new ones (reproducible)', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: labelAll });
    const cases = inputs.map((input, i) => ({ input, expected: expected[i] }));
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind', { cases });
    expect(v).toMatchObject({ status: 'onDevice', testCount: 5, passCount: 5, judgeUsed: false });
    expect(ai.calls.filter((c) => isCaseGen(c.req))).toHaveLength(0);
    expect(ai.calls).toHaveLength(5);
    expect(v.details.map((d) => d.input)).toEqual(inputs);
  });

  it('rejects stored cases that no longer fit the step, without any call', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: labelAll });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind', { cases: inputs.map((input) => ({ input, expected: 'Spam' })) });
    expect(v).toMatchObject({ status: 'unverified', reason: 'failed', testCount: 0 });
    expect(ai.calls).toHaveLength(0);
  });

  it('does not call the judge after a cancel', async () => {
    const ctl = new AbortController();
    let deviceRuns = 0;
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (r) => {
        if (isCaseGen(r)) return { raw: { cases: inputs.map((input) => ({ input, expected: `About: ${input}` })) } };
        if (r.taskType === 'summarize' && ++deviceRuns === 5) ctl.abort();
        return { raw: { summary: 'Something else entirely' } };
      },
    });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_summary', { signal: ctl.signal });
    expect(v).toMatchObject({ status: 'unverified', reason: 'cancelled' });
    expect(ai.calls.filter((c) => isJudge(c.req))).toHaveLength(0);
  });

  it('records a judge failure honestly, with the cases that ran', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (r) => {
        if (isCaseGen(r)) return { raw: { cases: inputs.map((input) => ({ input, expected: `About: ${input}` })) } };
        if (isJudge(r)) return { error: 'quota' };
        return { raw: { summary: 'Something else entirely' } };
      },
    });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_summary');
    expect(v).toMatchObject({ status: 'unverified', reason: 'failed', testCount: 5, judgeUsed: true });
    expect(v.details).toHaveLength(5);
  });
});

describe('check records', () => {
  const ran: AIBlockVerificationOutcome = {
    status: 'cloudPreferred', testCount: 5, passCount: 3, model: 'gemini-nano', judgeUsed: false,
    details: [{ input: 'x', expected: 'Urgent', actual: 'Normal', pass: false, reason: 'wrong label' }],
    message: 'Passed 3 of 5 tests on this device.',
  };

  it('writes only checks that really ran into the spec, within schema limits', () => {
    const none = recordVerification(spec, 'note_kind', { status: 'onDevice', testCount: 0, passCount: 0, details: [] }, 1);
    expect(none).toBe(spec);
    const out = recordVerification(spec, 'note_kind', { ...ran, passCount: 99 }, 1_700_000_000_123.4);
    expect(out.aiBlocks.note_kind).toMatchObject({
      verified: 'cloudPreferred',
      verification: { status: 'cloudPreferred', testCount: 5, passCount: 5, model: 'gemini-nano', verifiedAt: 1_700_000_000_123, schemaVersion: '1.0.0' },
    });
    expect(validateSpec(out).ok).toBe(true);
    expect(spec.aiBlocks.note_kind?.verified).toBe('unverified');
  });

  it('builds a report with prompt version, block hash, app version and cases', () => {
    const r = verificationReport(spec, 'note_kind', ran, 42);
    expect(r).toMatchObject({
      blockId: 'note_kind', appVersion: spec.version, promptVersion: VERIFY_PROMPT_VERSION, status: 'cloudPreferred',
      testCount: 5, passCount: 3, model: 'gemini-nano', judgeUsed: false, checkedAt: 42, cases: ran.details,
    });
    expect(r.blockHash).toBe(blockHash(spec, 'note_kind'));
  });

  it('keeps which photo fields were read, never the values read from the photos', () => {
    const r = verificationReport(spec, 'slip_to_order', {
      status: 'onDevice', testCount: 1, passCount: 1, details: [
        { input: 'Sample photo 1', expected: { customer: 'Raju', chest: 40 }, actual: { customer: 'Raju', chest: 40 }, pass: true },
      ],
    }, 1);
    expect(r.cases[0]).toMatchObject({ input: 'Sample photo 1', expected: ['customer', 'chest'], actual: ['customer', 'chest'] });
    expect(JSON.stringify(r)).not.toContain('Raju');
  });

  it('hashes what a block does, not its check result', () => {
    const h = blockHash(spec, 'note_kind');
    expect(blockHash(recordVerification(spec, 'note_kind', ran, 1), 'note_kind')).toBe(h);
    const changed: KalamSpec = { ...spec, aiBlocks: { ...spec.aiBlocks, note_kind: { ...spec.aiBlocks.note_kind!, prompt: 'Something new' } as KalamAIBlock } };
    expect(blockHash(changed, 'note_kind')).not.toBe(h);
    // A photo step also changes when the fields it reads change.
    const orders = spec.collections.orders!;
    const relabelled: KalamSpec = {
      ...spec, collections: { ...spec.collections, orders: { ...orders, fields: { ...orders.fields, chest: { type: 'number', label: 'Chest (cm)', unit: 'cm' } } } },
    };
    expect(blockHash(relabelled, 'slip_to_order')).not.toBe(blockHash(spec, 'slip_to_order'));
  });

  it('offers stored cases for a re-check only while the step is unchanged', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ input: `note ${i}`, expected: 'Urgent', actual: 'Urgent', pass: true }));
    const report = verificationReport(spec, 'note_kind', { ...ran, details: five }, 1);
    expect(reusableCases(spec, 'note_kind', report)).toEqual(five.map(({ input, expected }) => ({ input, expected })));
    expect(reusableCases(spec, 'note_kind', { ...report, cases: five.slice(0, 3) })).toBeUndefined();
    const changed: KalamSpec = { ...spec, aiBlocks: { ...spec.aiBlocks, note_kind: { ...spec.aiBlocks.note_kind!, prompt: 'New' } as KalamAIBlock } };
    expect(reusableCases(changed, 'note_kind', report)).toBeUndefined();
    expect(reusableCases(spec, 'slip_to_order', report)).toBeUndefined();
  });

  it('asks for a new check when there is none, it never ran, or the block changed', () => {
    const report = verificationReport(spec, 'note_kind', ran, 1);
    expect(needsReverification(spec, 'note_kind')).toBe(true);
    expect(needsReverification(spec, 'note_kind', report)).toBe(false);
    expect(needsReverification(spec, 'note_kind', { ...report, testCount: 0 })).toBe(true);
    expect(needsReverification(spec, 'note_kind', { ...report, promptVersion: 'ai-block-verify/0' })).toBe(true);
    const changed: KalamSpec = { ...spec, aiBlocks: { ...spec.aiBlocks, note_kind: { ...spec.aiBlocks.note_kind!, labels: ['Urgent', 'Later'] } as KalamAIBlock } };
    expect(needsReverification(changed, 'note_kind', report)).toBe(true);
  });
});

describe('check metrics (docs/07 §13.5)', () => {
  it('measures accuracy, valid output, failures and time on device', () => {
    const cases = [10, 20, 30, 40, 50].map((latencyMs, i) => ({
      input: `t${i}`, expected: 'Urgent', actual: i === 4 ? null : 'Urgent', pass: i !== 4, latencyMs,
      ...(i === 4 ? { errorCode: 'invalid_output' as const } : {}),
    }));
    expect(verificationMetrics({ cases })).toEqual({ cases: 5, accuracy: 0.8, jsonValidity: 0.8, failureRate: 0.2, meanLatencyMs: 30, maxLatencyMs: 50 });
  });

  it('measures photo fields from a saved report that keeps field names only', () => {
    const cases = [
      { input: 'Sample photo 1', expected: ['a', 'b', 'c'], actual: ['a', 'b', 'c'], pass: true },
      { input: 'Sample photo 2', expected: ['a', 'b'], actual: ['a', 'c'], pass: false, reason: 'different: b, c' },
      { input: 'Sample photo 3', expected: ['a', 'b'], actual: ['a', 'b'], pass: false, reason: 'different: b' },
    ];
    expect(verificationMetrics({ cases }).fields).toEqual({
      total: 7, accuracy: 5 / 7, missingRate: 1 / 7, incorrectRate: 1 / 7, hallucinationRate: 1 / 7,
    });
  });

  it('reads the times and errors a real check records', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (r) => (r.taskType === 'verify_ai_block'
        ? { raw: { cases: ['a1', 'b2', 'c3', 'd4', 'e5'].map((input) => ({ input, expected: 'Normal' })) } }
        : r.prompt.includes('e5') ? { raw: { label: 'nope' } } : { raw: { label: 'Normal' } }),
    });
    const v = await createAIBlockService({ ai }).verify(spec, 'note_kind');
    const m = verificationMetrics({ cases: v.details });
    expect(m).toMatchObject({ cases: 5, accuracy: 0.8, jsonValidity: 0.8, failureRate: 0.2, maxLatencyMs: 5 });
  });
});

describe('block policy (docs/00 §11.5)', () => {
  const kind = spec.aiBlocks.note_kind!;
  it('derives the preferred mode from the check result, with a cloud fallback by default', () => {
    expect(blockPolicy(kind)).toEqual({ mode: 'prefer_on_device', fallback: 'cloud', onError: 'keep_input' });
    expect(blockPolicy({ ...kind, verified: 'cloudPreferred' } as KalamAIBlock).mode).toBe('prefer_in_cloud');
  });
  it('keeps a no-fallback step on the device and passes the error policy on', async () => {
    const strict: KalamAIBlock = { ...kind, verified: 'cloudPreferred', fallback: 'none', onError: 'manual_entry' };
    expect(blockPolicy(strict)).toEqual({ mode: 'only_on_device', fallback: 'none', onError: 'manual_entry' });
    // The fields are part of the spec: a strict spec with them validates, unknown values do not.
    const withPolicy: KalamSpec = { ...spec, aiBlocks: { ...spec.aiBlocks, note_kind: strict } };
    expect(validateSpec(withPolicy).ok).toBe(true);
    expect(validateSpec({ ...withPolicy, aiBlocks: { ...withPolicy.aiBlocks, note_kind: { ...strict, fallback: 'claude' } } }).ok).toBe(false);
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { label: 'Urgent' } }) });
    await createAIBlockService({ ai }).run({ ...runInput('note_kind', { notes: 'Deliver tonight' }), spec: withPolicy, block: strict });
    expect(ai.calls[0]?.req.mode).toBe('only_on_device');
  });
});

describe('unsure photo fields (docs/16 R-016)', () => {
  it('passes fields the model was unsure about to the caller and keeps them out of the values', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { customer: 'Raju', chest: 40, _unsure: ['chest', 'waist', 'constructor'] } }) });
    const r = await createAIBlockService({ ai }).run(runInput('slip_to_order', {}, IMAGE));
    expect(r.output).toEqual({ customer: 'Raju', chest: 40 });
    expect(r.uncertainFields).toEqual(['chest']);
    expect(ai.calls[0]?.req.system).toContain('_unsure');
  });

  it('leaves results without unsure fields as they are', () => {
    expect(splitUnsure({ a: 1 })).toEqual({ values: { a: 1 }, unsure: [] });
    expect(splitUnsure(undefined)).toEqual({ values: undefined, unsure: [] });
  });

  it('ignores the unsure list when grading sample photos', async () => {
    const photo = (n: number) => ({ mimeType: 'image/jpeg' as const, base64: `/9j/PHOTO${n}` });
    const slip = { customer: 'Raju', chest: 40 };
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (r) => ({ raw: r.mode === 'only_in_cloud' ? slip : { ...slip, _unsure: ['chest'] } }),
    });
    const v = await createAIBlockService({ ai }).verify(spec, 'slip_to_order', { samplePhotos: [photo(0), photo(1), photo(2)] });
    expect(v).toMatchObject({ status: 'onDevice', passCount: 3 });
  });
});
