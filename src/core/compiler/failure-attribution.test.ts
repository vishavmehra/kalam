/**
 * Per-stage failure attribution (docs/13 §6.1, §21, D13-019). Every way a compile can stop is run once and the pass log must
 * say which pass, which stage and which category stopped it, so an eval report or a bug report points at the right
 * stage: the model call, the IR schema check, or the KalamSpec validator. A wrong attribution sends a fix to the wrong
 * place (a prompt change for a timeout, a timeout change for a schema miss).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI, type FakeReply } from '../../../tests/fixtures/compiler/fake-ai';
import type { AIErrorCode, CompileAttempt, NormalizedInput, TaskClassification } from '../contracts';
import { compileWithCloud } from './compile';
import { compilerIRSchema, type CompilerIR } from './ir';

const tailorIR: CompilerIR = compilerIRSchema.parse(
  JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')),
);
const complex: TaskClassification = {
  taskType: 'create_app', complexity: 'complex', estimatedScreens: 3, estimatedCollections: 2, estimatedActions: 4,
  requiresMultimodalReasoning: false, requiresCloudReasoning: true, confidence: 0.8, method: 'deterministic', reasons: ['test'],
};
const input: NormalizedInput = { text: 'tailor shop', modalities: ['text'], images: [] };
const good: FakeReply = { raw: tailorIR };
/** Valid IR whose list points at a collection that does not exist: the validator, not the schema, catches it. */
const invalidApp: FakeReply = {
  raw: {
    ...tailorIR,
    screens: tailorIR.screens.map((s) => (s.id === 'home'
      ? { ...s, components: s.components.map((c) => (c.id === 'orders_list' ? { ...c, source: 'ordrs' } : c)) }
      : s)),
  },
};
/** Not the IR shape at all: the structured-output check catches it. */
const notIR: FakeReply = { raw: { name: 'x' } };
const error = (code: AIErrorCode): FakeReply => ({ error: code, message: 'upstream detail' });

type Row = [name: string, script: FakeReply[], expected: Array<Pick<CompileAttempt, 'pass' | 'stage'> & Partial<CompileAttempt>>, calls: number, ok: boolean];

const rows: Row[] = [
  ['first pass ok', [good], [{ pass: 'first', stage: 'ok' }], 1, true],
  ['first pass: invalid app, repair ok', [invalidApp, good],
    [{ pass: 'first', stage: 'validation', category: 'OUTPUT_INVALID', errorCode: 'invalid_output' }, { pass: 'repair', stage: 'ok' }], 2, true],
  ['first pass: not the IR shape, repair ok', [notIR, good],
    [{ pass: 'first', stage: 'structured_output', category: 'OUTPUT_INVALID', errorCode: 'invalid_output' }, { pass: 'repair', stage: 'ok' }], 2, true],
  ['both passes: invalid app', [invalidApp, invalidApp],
    [{ pass: 'first', stage: 'validation', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'validation', category: 'REPAIR_FAILED' }], 2, false],
  ['both passes: not the IR shape', [notIR, notIR],
    [{ pass: 'first', stage: 'structured_output', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'structured_output', category: 'REPAIR_FAILED' }], 2, false],
  ['invalid app, then the repair is not the IR shape', [invalidApp, notIR],
    [{ pass: 'first', stage: 'validation', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'structured_output', category: 'REPAIR_FAILED' }], 2, false],
  ['not the IR shape, then the repair is an invalid app', [notIR, invalidApp],
    [{ pass: 'first', stage: 'structured_output', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'validation', category: 'REPAIR_FAILED' }], 2, false],
  ['invalid app, then the repair call times out', [invalidApp, error('timeout')],
    [{ pass: 'first', stage: 'validation', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'model', category: 'INFERENCE_TIMEOUT', errorCode: 'timeout' }], 2, false],
  ['invalid app, then the repair call is rate limited', [invalidApp, error('quota')],
    [{ pass: 'first', stage: 'validation', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'model', category: 'RATE_LIMITED', errorCode: 'quota' }], 2, false],
  ['invalid app, then the network drops for the repair', [invalidApp, error('offline')],
    [{ pass: 'first', stage: 'validation', category: 'OUTPUT_INVALID' }, { pass: 'repair', stage: 'model', category: 'NETWORK_UNAVAILABLE', errorCode: 'offline' }], 2, false],
  ['first call times out (no repair is spent)', [error('timeout')],
    [{ pass: 'first', stage: 'model', category: 'INFERENCE_TIMEOUT', errorCode: 'timeout' }], 1, false],
  ['first call is rate limited (no repair is spent)', [error('quota')],
    [{ pass: 'first', stage: 'model', category: 'RATE_LIMITED', errorCode: 'quota' }], 1, false],
  ['first call has no network (no repair is spent)', [error('offline')],
    [{ pass: 'first', stage: 'model', category: 'NETWORK_UNAVAILABLE', errorCode: 'offline' }], 1, false],
  ['first call fails at the provider (no repair is spent)', [error('provider_error')],
    [{ pass: 'first', stage: 'model', category: 'INFERENCE_FAILED', errorCode: 'provider_error' }], 1, false],
  ['App Check refuses the device', [error('app_check_failed')],
    [{ pass: 'first', stage: 'model', category: 'INFERENCE_FAILED', errorCode: 'app_check_failed' }], 1, false],
  ['the provider rejects the request', [error('bad_request')],
    [{ pass: 'first', stage: 'model', category: 'INFERENCE_FAILED', errorCode: 'bad_request' }], 1, false],
];

describe('compile failure attribution (D13-019)', () => {
  it.each(rows)('%s', async (_name, script, expected, calls, ok) => {
    const ai = createFakeAI({ respond: (_req, _ctx, i) => script[Math.min(i, script.length - 1)]! });
    const out = await compileWithCloud(input, complex, { ai, appId: 'app_abc12345' });
    expect(out.ok).toBe(ok);
    expect(ai.calls).toHaveLength(calls);
    expect(out.attempts).toHaveLength(expected.length);
    expected.forEach((e, i) => expect(out.attempts![i]).toMatchObject(e));
    // The pass order is first, then repair, and an app never comes out of a failed pass.
    expect(out.attempts!.map((a) => a.pass)).toEqual(expected.map((e) => e.pass));
    if (!ok) expect(out.spec).toBeUndefined();
    // The route says whether the repair pass was reached.
    expect(out.route).toBe(expected.some((e) => e.pass === 'repair') ? 'cloud+repair' : 'cloud');
  });

  it('records the exact validator code and path of an invalid app, and the IR path of a schema miss', async () => {
    const validation = await compileWithCloud(input, complex, { ai: createFakeAI({ respond: () => invalidApp }), appId: 'app_abc12345' });
    for (const a of validation.attempts!) {
      expect(a.issues.length).toBeGreaterThan(0);
      for (const issue of a.issues) expect(issue).toMatch(/^[A-Z_]+ \S+$/);
    }
    const schema = await compileWithCloud(input, complex, { ai: createFakeAI({ respond: () => notIR }), appId: 'app_abc12345' });
    for (const a of schema.attempts!) for (const issue of a.issues) expect(issue).toMatch(/^IR /);
  });

  it('keeps provider detail out of the pass log and out of the message the person sees', async () => {
    const ai = createFakeAI({ respond: () => ({ error: 'provider_error', message: 'SECRET-UPSTREAM-DETAIL for Raju' }) });
    const out = await compileWithCloud(input, complex, { ai, appId: 'app_abc12345' });
    expect(JSON.stringify(out)).not.toContain('SECRET-UPSTREAM-DETAIL');
    expect(out.message).not.toMatch(/SECRET|Raju/);
  });

  it('caps a long issue list so a report stays small', async () => {
    const many = {
      ...tailorIR,
      screens: tailorIR.screens.map((s) => ({
        ...s, components: s.components.map((c) => (c.type === 'list' ? { ...c, source: 'nope', primary: 'nope', secondaryField: 'nope' } : c)),
      })),
    };
    const out = await compileWithCloud(input, complex, { ai: createFakeAI({ respond: () => ({ raw: many }) }), appId: 'app_abc12345' });
    for (const a of out.attempts!) expect(a.issues.length).toBeLessThanOrEqual(20);
  });
});
