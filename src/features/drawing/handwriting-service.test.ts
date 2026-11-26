import { describe, expect, it, vi } from 'vitest';
import type { AIExecutionResult, AIOrchestrator, StructuredRequest } from '@/core/contracts';
import { DIGIT_SHAPES, type StrokeElement } from './model';
import { buildHandwritingRequest, readDigits, readInCloud, readOnDevice, type HandwritingDeps } from './handwriting-service';

const stroke = (id: string, pts: Array<[number, number]>): StrokeElement => ({
  id, kind: 'stroke', tool: 'pen', color: '#000000', size: 4, points: pts.map(([x, y]) => ({ x, y })),
});
const zigzag = [stroke('z', [[0, 0], [20, 60], [40, 0], [60, 60], [80, 0]])];
const IMAGE = { mimeType: 'image/png' as const, base64: 'AAAA' };

type Reply = Partial<AIExecutionResult<{ text: string; unsure?: boolean }>>;
function harness(replies: Reply[], opts: { cloudAllowed?: boolean } = {}) {
  const calls: Array<{ req: StructuredRequest<unknown>; taskType: string }> = [];
  const run = vi.fn(async (req: StructuredRequest<unknown>, ctx: { taskType: string }) => {
    calls.push({ req, taskType: ctx.taskType });
    const r = replies.shift() ?? { success: false, errorCode: 'provider_error' as const };
    return { success: false, provider: 'firebase', source: 'on_device', latencyMs: 1, fallbackUsed: false, ...r } as AIExecutionResult<never>;
  });
  const deps: HandwritingDeps = {
    ai: { run } as unknown as Pick<AIOrchestrator, 'run'>,
    picture: () => IMAGE,
    cloudAllowed: async () => opts.cloudAllowed ?? true,
  };
  return { deps, calls, run };
}

describe('step 1: digits on this device', () => {
  it('reads digits with no model and says so', () => {
    const strokes = DIGIT_SHAPES['7']!.map((s, i) => stroke(`d${i}`, s.map((p) => [p.x * 80, p.y * 80] as [number, number])));
    expect(readDigits(strokes)).toEqual({ text: '7', source: 'deterministic', unsure: false });
  });

  it('gives nothing for other writing', () => {
    expect(readDigits(zigzag)).toBeUndefined();
  });
});

describe('step 2: Gemini Nano on this device', () => {
  it('asks only on-device, with a fixed prompt and just the picture of the strokes', async () => {
    const h = harness([{ success: true, source: 'on_device', output: { text: '  Rice   2 kg ' } }]);
    const out = await readOnDevice(zigzag, h.deps);
    expect(out).toEqual({ kind: 'read', reading: { text: 'Rice 2 kg', source: 'on_device', unsure: false } });
    expect(h.calls).toHaveLength(1);
    const { req, taskType } = h.calls[0]!;
    expect(taskType).toBe('extract_data');
    expect(req.mode).toBe('only_on_device');
    expect(req.images).toEqual([IMAGE]);
    expect(req.prompt).not.toMatch(/\d{3,}/);
    expect(JSON.stringify(req)).not.toContain('"points"');
    expect(req.temperature).toBe(0);
  });

  it('passes the unsure flag on, and reports what actually ran as the source', async () => {
    const h = harness([{ success: true, source: 'cloud', output: { text: 'Milk', unsure: true } }]);
    const out = await readOnDevice(zigzag, h.deps);
    expect(out).toEqual({ kind: 'read', reading: { text: 'Milk', source: 'cloud', unsure: true } });
  });

  it('marks a reading that was longer than a label, and does not mark a short one', async () => {
    const long = harness([{ success: true, source: 'on_device', output: { text: 'word '.repeat(80) } }]);
    const out = await readOnDevice(zigzag, long.deps);
    expect(out).toMatchObject({ kind: 'read', reading: { shortened: true } });
    if (out.kind === 'read') expect(out.reading.text.length).toBeLessThanOrEqual(200);
    const short = harness([{ success: true, source: 'on_device', output: { text: 'Milk' } }]);
    expect(await readOnDevice(zigzag, short.deps)).toEqual({ kind: 'read', reading: { text: 'Milk', source: 'on_device', unsure: false } });
    const cloud = harness([{ success: true, source: 'cloud', output: { text: 'a\nb\nc\nd\ne\nf\ng' } }]);
    expect(await readInCloud(zigzag, cloud.deps)).toMatchObject({ kind: 'read', reading: { shortened: true } });
  });

  it('says nothing was found when the reply has no text', async () => {
    const h = harness([{ success: true, source: 'on_device', output: { text: '   ' } }]);
    expect(await readOnDevice(zigzag, h.deps)).toEqual({ kind: 'nothing', source: 'on_device' });
  });

  it('offers one cloud try only when the device failed and cloud is allowed', async () => {
    const failed = { success: false, errorCode: 'model_unavailable' as const, errorMessage: 'Gemini Nano is not ready on this device.' };
    expect(await readOnDevice(zigzag, harness([failed]).deps)).toEqual({ kind: 'failed', cloudPossible: true, message: 'Gemini Nano is not ready on this device.' });
    expect(await readOnDevice(zigzag, harness([failed], { cloudAllowed: false }).deps)).toMatchObject({ kind: 'failed', cloudPossible: false });
    const off = { success: false, errorCode: 'consent_denied' as const, errorMessage: 'Cloud AI is off in Settings.' };
    expect(await readOnDevice(zigzag, harness([off]).deps)).toMatchObject({ kind: 'failed', cloudPossible: false, message: 'Cloud AI is off in Settings.' });
    const offline = { success: false, errorCode: 'offline' as const };
    expect(await readOnDevice(zigzag, harness([offline]).deps)).toMatchObject({ kind: 'failed', cloudPossible: false });
  });

  it('never calls the cloud by itself', async () => {
    const h = harness([{ success: false, errorCode: 'model_unavailable' }]);
    await readOnDevice(zigzag, h.deps);
    expect(h.calls.map((c) => c.req.mode)).toEqual(['only_on_device']);
  });
});

describe('step 3: the single cloud call, after the person agrees', () => {
  it('asks only in the cloud, once, and labels the result as cloud', async () => {
    const h = harness([{ success: true, source: 'cloud', output: { text: 'Total 1250' } }]);
    const out = await readInCloud(zigzag, h.deps);
    expect(out).toEqual({ kind: 'read', reading: { text: 'Total 1250', source: 'cloud', unsure: false } });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.req.mode).toBe('only_in_cloud');
  });

  it('does not call at all when cloud AI is off or offline', async () => {
    const h = harness([{ success: true, source: 'cloud', output: { text: 'x' } }], { cloudAllowed: false });
    const out = await readInCloud(zigzag, h.deps);
    expect(out).toMatchObject({ kind: 'failed', message: expect.stringMatching(/nothing was sent/i) });
    expect(h.run).not.toHaveBeenCalled();
  });

  it('turns a failure into plain words and does not retry', async () => {
    const h = harness([{ success: false, errorCode: 'provider_error' }]);
    const out = await readInCloud(zigzag, h.deps);
    expect(out).toMatchObject({ kind: 'failed', message: expect.stringMatching(/type it instead/i) });
    expect(h.calls).toHaveLength(1);
  });
});

describe('the request', () => {
  it('has a closed JSON schema with a required text field and a reply parser', () => {
    const req = buildHandwritingRequest(IMAGE, 'only_on_device', ['hi'], undefined);
    expect(req.jsonSchema).toMatchObject({ type: 'object', required: ['text'] });
    expect(req.languages).toEqual(['hi']);
    expect(req.parse({ text: 'ok' })).toMatchObject({ success: true });
    expect(req.parse({ nope: 1 })).toMatchObject({ success: false });
  });
});
