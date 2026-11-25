import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI, type FakeAI, type FakeReply } from '../../../tests/fixtures/compiler/fake-ai';
import { irToSpec } from '../compiler/convert';
import { compilerIRSchema } from '../compiler/ir';
import type { CreationStage, NormalizedInput, StoredApp, StructuredRequest } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { createAIBlockService, VERIFY_PROMPT_VERSION } from '../tasks/ai-block-service';
import { createApplicationPipeline } from './create-application';
import { pendingChecks, recheckPending, reportsByBlock, verifyAIBlocks, type VerifyStageDeps } from './verify-blocks';

const tailorIR = JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8'));
const tailor = irToSpec(compilerIRSchema.parse(tailorIR), { appId: 'app_tailor01', now: 1 });
/** Tailor app with one AI step of every kind (the photo step comes from the fixture). */
const spec: KalamSpec = {
  ...tailor,
  aiBlocks: {
    ...tailor.aiBlocks,
    note_kind: { kind: 'classify', prompt: 'Is this note urgent, normal or about payment?', verified: 'unverified', labels: ['Urgent', 'Normal', 'Payment'], inputField: 'notes', outputField: 'notes' },
    note_summary: { kind: 'summarise', prompt: 'Summarise the note.', verified: 'unverified', inputField: 'notes', outputField: 'notes', maxWords: 10 },
    note_hindi: { kind: 'translate', prompt: 'Translate the note.', verified: 'unverified', inputField: 'notes', outputField: 'notes', targetLang: 'hi' },
  },
};

const inputs = ['Pay the cloth bill', 'Deliver Raju kurta tonight', 'Regular alteration', 'Advance pending', 'Wedding order due tomorrow'];
const labels = ['Payment', 'Urgent', 'Normal', 'Payment', 'Urgent'];
const isCaseGen = (r: StructuredRequest<unknown>) => r.taskType === 'verify_ai_block' && (r.system ?? '').includes('write test cases');
const isJudge = (r: StructuredRequest<unknown>) => r.taskType === 'verify_ai_block' && (r.system ?? '').includes('You grade');
const caseIndex = (r: StructuredRequest<unknown>) => inputs.findIndex((t) => r.prompt.includes(t));

/**
 * Cloud writes 5 cases per step. Nano labels 4 of 5 right, translates exactly, and paraphrases
 * summaries (so only summaries need the judge, which passes 4 of 5).
 */
const responder = (r: StructuredRequest<unknown>): FakeReply => {
  if (isCaseGen(r)) {
    const kind = (r.system ?? '').includes('classify') ? 'classify' : (r.system ?? '').includes('summarise') ? 'summarise' : 'translate';
    return { raw: { cases: inputs.map((input, i) => ({ input, expected: kind === 'classify' ? labels[i] : kind === 'summarise' ? `About ${input}` : `HI ${input}` })) } };
  }
  if (isJudge(r)) return { raw: { verdicts: [0, 1, 2, 3, 4].map((index) => ({ index, pass: index !== 4 })) } };
  const i = caseIndex(r);
  if (r.taskType === 'classify') return { raw: { label: i === 2 ? 'Urgent' : labels[i] } };
  if (r.taskType === 'summarize') return { raw: { summary: `Note on ${inputs[i]}` } };
  if (r.taskType === 'translate') return { raw: { text: `HI ${inputs[i]}` } };
  return { error: 'provider_error' };
};

const deps = (ai: FakeAI, extra: Partial<VerifyStageDeps> = {}): VerifyStageDeps => ({
  ai, aiBlocks: createAIBlockService({ ai }), now: Date.now, ...extra,
});
const byId = <T extends { blockId: string }>(reports: readonly T[]): Record<string, T | undefined> =>
  Object.fromEntries(reports.map((r) => [r.blockId, r]));

describe('verifying stage: online with cloud help on', () => {
  it('tests every text step on device, records the result in the spec and keeps the cases', async () => {
    expect(validateSpec(spec).ok).toBe(true);
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    const out = await verifyAIBlocks(spec, deps(ai, { cloudConsent: () => true }));
    expect(validateSpec(out.spec).ok).toBe(true);
    expect(out.spec.aiBlocks.note_kind).toMatchObject({ verified: 'onDevice', verification: { status: 'onDevice', testCount: 5, passCount: 4, model: 'gemini-nano' } });
    expect(out.spec.aiBlocks.note_summary?.verified).toBe('onDevice');
    expect(out.spec.aiBlocks.note_hindi?.verified).toBe('onDevice');
    const r = byId(out.reports);
    expect(r.note_kind).toMatchObject({ status: 'onDevice', testCount: 5, passCount: 4, judgeUsed: false, appVersion: 1, promptVersion: VERIFY_PROMPT_VERSION });
    expect(r.note_kind?.blockHash).toMatch(/^[0-9a-f]{8}$/);
    // The capability context the check ran in is kept with it (docs/15 §9.5).
    expect(r.note_kind?.device).toEqual({ platform: 'web', availability: 'available' });
    expect(r.note_kind?.cases).toHaveLength(5);
    expect(r.note_kind?.cases[2]).toMatchObject({ input: inputs[2], expected: 'Normal', actual: 'Urgent', pass: false, reason: 'wrong label' });
    expect(out.skipped).toEqual(['needs_samples']);
    expect(spec.aiBlocks.note_kind?.verified).toBe('unverified'); // input never mutated
  });

  it('grades deterministically first and calls the cloud judge only for the open-ended summary', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    const progress: Array<[number, number]> = [];
    const out = await verifyAIBlocks(spec, deps(ai), { onProgress: (n, total) => progress.push([n, total]) });
    // Progress counts only the steps that can be tested now (the photo step waits for samples).
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    const judges = ai.calls.filter((c) => isJudge(c.req));
    expect(judges).toHaveLength(1);
    expect(judges[0]?.req.system).toContain('summaries');
    // Per step: 1 case-writing call + 5 device runs; the summary adds its one judge call.
    expect(ai.calls.filter((c) => isCaseGen(c.req))).toHaveLength(3);
    expect(ai.calls.filter((c) => c.req.mode === 'only_on_device' && c.result.source === 'on_device')).toHaveLength(15);
    expect(ai.calls).toHaveLength(19);
    const r = byId(out.reports);
    expect(r.note_kind?.judgeUsed).toBe(false);
    expect(r.note_hindi?.judgeUsed).toBe(false);
    expect(r.note_summary?.judgeUsed).toBe(true);
  });

  it('never spends a call on a photo step at build time: it waits for real sample photos', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    const photoOnly: KalamSpec = { ...spec, aiBlocks: { slip_to_order: spec.aiBlocks.slip_to_order! } };
    const out = await verifyAIBlocks(photoOnly, deps(ai));
    expect(ai.calls).toHaveLength(0);
    expect(out.spec).toBe(photoOnly);
    expect(out.reports[0]).toMatchObject({ blockId: 'slip_to_order', status: 'unverified', reason: 'needs_samples', testCount: 0 });
    expect(out.reports[0]?.message).toMatch(/sample photos/);
  });
});

describe('verifying stage: honest "not checked yet" without spending calls', () => {
  const textSteps = ['note_kind', 'note_summary', 'note_hindi'];

  it('offline: nothing is called, every text step says it will be checked when online', async () => {
    const ai = createFakeAI({ onDevice: 'available', online: false, respond: responder });
    const out = await verifyAIBlocks(spec, deps(ai));
    expect(ai.calls).toHaveLength(0);
    expect(out.spec).toBe(spec);
    for (const id of textSteps) {
      expect(byId(out.reports)[id]).toMatchObject({ status: 'unverified', reason: 'offline', testCount: 0, cases: [] });
      expect(byId(out.reports)[id]?.message).toBe('Not checked yet. Kalam will check it when you are online.');
    }
  });

  it('cloud help off or offline-only mode: nothing is called', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    const out = await verifyAIBlocks(spec, deps(ai, { cloudConsent: async () => false }));
    expect(ai.calls).toHaveLength(0);
    expect(out.reports.filter((r) => r.reason === 'cloud_off').map((r) => r.blockId)).toEqual(textSteps);
    expect(out.spec.aiBlocks.note_kind?.verified).toBe('unverified');
  });

  it('treats unreadable settings as no consent', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    const out = await verifyAIBlocks(spec, deps(ai, { cloudConsent: () => { throw new Error('db closed'); } }));
    expect(ai.calls).toHaveLength(0);
    expect(byId(out.reports).note_kind?.reason).toBe('cloud_off');
  });

  it('separates a device without Gemini Nano from one where it is not ready yet', async () => {
    const none = await verifyAIBlocks(spec, deps(createFakeAI({ onDevice: 'unavailable', respond: responder })));
    expect(byId(none.reports).note_kind).toMatchObject({ reason: 'device_unsupported' });
    const later = await verifyAIBlocks(spec, deps(createFakeAI({ onDevice: 'downloadable', respond: responder })));
    expect(byId(later.reports).note_kind).toMatchObject({ reason: 'device_not_ready' });
  });

  it('skips a cold model and warms it for next time', async () => {
    const ai = createFakeAI({ onDevice: 'available', warm: false, respond: responder });
    const out = await verifyAIBlocks(spec, deps(ai));
    expect(ai.calls).toHaveLength(0);
    expect(ai.warmUps).toBe(1);
    expect(byId(out.reports).note_kind?.reason).toBe('device_loading');
  });

  it('stops testing the rest when the network drops during a check', async () => {
    let online = true;
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (r, ctx, n) => (isCaseGen(r) && n > 0 && !online ? { error: 'offline' } : responder(r)),
    });
    const aiBlocks = createAIBlockService({ ai });
    const out = await verifyAIBlocks(spec, {
      ai, now: Date.now,
      aiBlocks: { verify: async (s, id, o) => { const v = await aiBlocks.verify(s, id, o); online = false; return v; } },
    });
    const r = byId(out.reports);
    expect(r.note_kind?.status).toBe('onDevice');
    expect(r.note_summary).toMatchObject({ reason: 'offline', testCount: 0, message: 'Not checked yet. Kalam will check it when you are online.' });
    expect(r.note_hindi?.reason).toBe('offline');
    expect(ai.calls.filter((c) => isCaseGen(c.req))).toHaveLength(2); // the third step was never started
  });
});

describe('verifying stage: bounded deadline', () => {
  it('reports unfinished steps as not checked instead of holding up the app', async () => {
    const ai = createFakeAI({ onDevice: 'available', delayMs: 40, respond: responder });
    const t0 = Date.now();
    const out = await verifyAIBlocks(spec, deps(ai, { budgetMs: 100 }));
    expect(Date.now() - t0).toBeLessThan(600);
    for (const id of ['note_kind', 'note_summary', 'note_hindi']) {
      expect(byId(out.reports)[id]).toMatchObject({ status: 'unverified', reason: 'timeout', testCount: 0 });
    }
    expect(out.spec.aiBlocks.note_kind?.verified).toBe('unverified');
    // The step that was cut off stops at its next abort check: no new case writing starts afterwards.
    await new Promise((r) => setTimeout(r, 120));
    expect(ai.calls.filter((c) => isCaseGen(c.req))).toHaveLength(1);
  });

  it('a user cancel stops the stage and marks the rest cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    const out = await verifyAIBlocks(spec, deps(ai), { signal: ctl.signal });
    expect(ai.calls).toHaveLength(0);
    expect(byId(out.reports).note_kind?.reason).toBe('cancelled');
  });
});

describe('reportsByBlock', () => {
  it('keys reports by step and drops steps removed during review', async () => {
    const ai = createFakeAI({ onDevice: 'available', online: false });
    const { reports } = await verifyAIBlocks(spec, deps(ai));
    const { note_hindi: _gone, ...rest } = spec.aiBlocks;
    const keyed = reportsByBlock({ ...spec, aiBlocks: rest }, reports);
    expect(Object.keys(keyed).sort()).toEqual(['note_kind', 'note_summary', 'slip_to_order']);
  });
});

describe('checks that waited for the network (pendingChecks, recheckPending)', () => {
  const saved = (reports: Parameters<typeof reportsByBlock>[1]): StoredApp => ({
    id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'cloud' }, aiVerification: reportsByBlock(spec, reports),
  });

  it('lists the steps waiting for the network, consent or the model, never photo steps without samples', async () => {
    const offline = await verifyAIBlocks(spec, deps(createFakeAI({ onDevice: 'available', online: false })));
    expect(pendingChecks(saved(offline.reports)).sort()).toEqual(['note_hindi', 'note_kind', 'note_summary']);
    expect(pendingChecks({ spec })).toEqual([]);
    const checked = await verifyAIBlocks(spec, deps(createFakeAI({ onDevice: 'available', respond: responder })));
    expect(pendingChecks(saved(checked.reports))).toEqual([]);
  });

  it('makes no call while still offline, then finishes the checks once online', async () => {
    const app = saved((await verifyAIBlocks(spec, deps(createFakeAI({ onDevice: 'available', online: false })))).reports);
    const still = createFakeAI({ onDevice: 'available', online: false, respond: responder });
    expect(await recheckPending(app, deps(still))).toBeUndefined();
    expect(still.calls).toHaveLength(0);

    const back = createFakeAI({ onDevice: 'available', respond: responder });
    const next = await recheckPending(app, deps(back, { cloudConsent: () => true }));
    expect(validateSpec(next?.spec).ok).toBe(true);
    expect(next?.spec.aiBlocks.note_kind?.verified).toBe('onDevice');
    expect(next?.aiVerification?.note_kind).toMatchObject({ status: 'onDevice', testCount: 5, promptVersion: VERIFY_PROMPT_VERSION });
    expect(next?.aiVerification?.slip_to_order?.reason).toBe('needs_samples');
    expect(back.calls.some((c) => c.req.images?.length)).toBe(false);
    expect(app.spec.aiBlocks.note_kind?.verified).toBe('unverified'); // input never mutated
  });

  it('with cloud help still off nothing changes and nothing is called', async () => {
    const app = saved((await verifyAIBlocks(spec, deps(createFakeAI({ onDevice: 'available', online: false })))).reports);
    const ai = createFakeAI({ onDevice: 'available', respond: responder });
    expect(await recheckPending(app, deps(ai, { cloudConsent: () => false }))).toBeUndefined();
    expect(ai.calls).toHaveLength(0);
  });
});

describe('createApplication with the verifying stage', () => {
  const request = 'A tailor shop app with customers and orders, measurements like chest waist sleeve, delivery dates, advance payment, and reading a photo of the measurement slip';
  const text = (t: string): NormalizedInput => ({ text: t, modalities: ['text'], images: [] });
  const withClassify = {
    ...tailorIR,
    aiBlocks: [...tailorIR.aiBlocks, { id: 'note_kind', kind: 'classify', prompt: 'Is this note urgent, normal or about payment?', labels: ['Urgent', 'Normal', 'Payment'], inputField: 'notes', outputField: 'notes' }],
  };
  const compileThen = (r: StructuredRequest<unknown>): FakeReply => (r.role === 'compiler' ? { raw: withClassify } : responder(r));

  it('reports progress, verifies after validation, returns the reports and an up to date review', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: compileThen });
    const stages: Array<[CreationStage, string | undefined]> = [];
    const res = await createApplicationPipeline({ ai, cloudConsent: () => true })(text(request), { onStage: (s, d) => stages.push([s, d]) });
    expect(res.ok).toBe(true);
    const names = stages.map(([s]) => s);
    expect(names.indexOf('verifying')).toBeGreaterThan(names.lastIndexOf('validating'));
    expect(names.at(-1)).toBe('done');
    expect(stages.filter(([s]) => s === 'verifying')).toEqual([['verifying', 'Testing AI step 1 of 1']]);
    expect(res.spec?.aiBlocks.note_kind?.verified).toBe('onDevice');
    expect(validateSpec(res.spec).ok).toBe(true);
    expect(res.verification?.map((v) => [v.blockId, v.status, v.reason])).toEqual([
      ['slip_to_order', 'unverified', 'needs_samples'], ['note_kind', 'onDevice', undefined],
    ]);
    // The review reads the real result: the checked step has no "not checked" warning, the photo step does.
    expect(res.warnings.filter((w) => w.code === 'UNVERIFIED_AI_BLOCK').map((w) => w.path)).toEqual(['aiBlocks.slip_to_order.verified']);
    const features = Object.fromEntries((res.understanding?.aiFeatures ?? []).map((f) => [f.id, f.verified]));
    expect(features.note_kind).toBe('Works on this device, even offline');
    expect(features.slip_to_order).toMatch(/sample photos/);
    // The skipped photo check is recorded as a decision.
    expect(ai.events).toContainEqual(expect.objectContaining({ taskType: 'verify_ai_block', route: 'deterministic', success: false }));
  });

  it('with cloud help off the app is still built and the step honestly stays unchecked', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: compileThen });
    const stages: CreationStage[] = [];
    const res = await createApplicationPipeline({ ai, cloudConsent: () => false })(text(request), { onStage: (s) => stages.push(s) });
    expect(res.ok).toBe(true);
    expect(stages).not.toContain('verifying');
    expect(ai.calls.filter((c) => c.req.taskType !== 'create_app' && c.req.role !== 'compiler')).toHaveLength(0);
    expect(res.spec?.aiBlocks.note_kind?.verified).toBe('unverified');
    expect(res.verification?.find((v) => v.blockId === 'note_kind')).toMatchObject({ reason: 'cloud_off' });
    expect(ai.events).toContainEqual(expect.objectContaining({ taskType: 'verify_ai_block', errorCode: 'consent_denied' }));
  });

  it('never makes the person wait past the deadline', async () => {
    const ai = createFakeAI({ onDevice: 'available', delayMs: 30, respond: compileThen });
    const t0 = Date.now();
    const res = await createApplicationPipeline({ ai, verifyBudgetMs: 50 })(text(request));
    expect(Date.now() - t0).toBeLessThan(800);
    expect(res.ok).toBe(true);
    expect(res.verification?.find((v) => v.blockId === 'note_kind')).toMatchObject({ reason: 'timeout' });
  });

  it('template apps have no AI steps: no verifying stage, no extra calls', async () => {
    const ai = createFakeAI({ onDevice: 'unavailable' });
    const stages: CreationStage[] = [];
    const res = await createApplicationPipeline({ ai })(text('Make me a calculator'), { onStage: (s) => stages.push(s) });
    expect(res.ok).toBe(true);
    expect(stages).not.toContain('verifying');
    expect(res.verification).toBeUndefined();
    expect(ai.calls).toHaveLength(0);
  });
});
