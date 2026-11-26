/**
 * Cloud validity (eval 2026-11-25): answers are cleaned before Zod, every pass is logged with its stage and exact
 * validator codes (docs/13 §6.1, §21), the repair pass gets the full output budget, and assumptions never claim a
 * server enforces roles (mx05).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import type { NormalizedInput, TaskClassification, ValidationResult } from '../contracts';
import { createApplicationPipeline } from '../pipeline/create-application';
import { validateSpec } from '../spec/validate';
import { compileWithCloud, honestAssumptions } from './compile';
import { irToSpec } from './convert';
import { compilerIRSchema, type CompilerIR } from './ir';

const tailorIR: CompilerIR = compilerIRSchema.parse(
  JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')),
);
const complex: TaskClassification = {
  taskType: 'create_app', complexity: 'complex', estimatedScreens: 3, estimatedCollections: 2, estimatedActions: 4,
  requiresMultimodalReasoning: false, requiresCloudReasoning: true, confidence: 0.8, method: 'deterministic', reasons: ['test'],
};
const text = (t: string): NormalizedInput => ({ text: t, modalities: ['text'], images: [] });
/** The faults the findings name: feedback past 120 characters, a suffix past 12, an empty AI prompt. */
const overLong = {
  ...tailorIR,
  actions: tailorIR.actions?.map((a) => (a.type === 'insert' ? { ...a, thenFeedback: 'Saved. '.repeat(30) } : a)),
  screens: tailorIR.screens.map((s) => ({
    ...s, components: s.components.map((c) => (c.type === 'stat' ? { ...c, suffix: 'rupees collected so far' } : c)),
  })),
  aiBlocks: tailorIR.aiBlocks?.map((b) => ({ ...b, prompt: '' })),
};
const broken: CompilerIR = {
  ...tailorIR,
  screens: tailorIR.screens.map((s) => s.id === 'home'
    ? { ...s, components: s.components.map((c) => (c.id === 'orders_list' ? { ...c, source: 'ordrs' } : c)) }
    : s),
};

describe('compile attempts', () => {
  it('cleans over-long values on the first pass instead of spending the repair pass on them', async () => {
    expect(compilerIRSchema.safeParse(overLong).success).toBe(false);
    const ai = createFakeAI({ respond: () => ({ raw: overLong }) });
    const out = await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345' });
    expect(out.ok).toBe(true);
    expect(out.route).toBe('cloud');
    expect(ai.calls).toHaveLength(1);
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts![0]).toMatchObject({ pass: 'first', stage: 'ok', issues: [] });
    expect(out.attempts![0].repairs.some((r) => /thenFeedback: shortened/.test(r))).toBe(true);
    expect(out.attempts![0].repairs.some((r) => /suffix: shortened/.test(r))).toBe(true);
  });

  it('logs both passes with their stage, category and validator codes when the app stays invalid', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: broken }) });
    const out = await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345' });
    expect(out.ok).toBe(false);
    expect(out.attempts?.map((a) => [a.pass, a.stage, a.category, a.errorCode])).toEqual([
      ['first', 'validation', 'OUTPUT_INVALID', 'invalid_output'],
      ['repair', 'validation', 'REPAIR_FAILED', 'invalid_output'],
    ]);
    for (const a of out.attempts!) expect(a.issues.some((i) => /^[A-Z_]+ screens\[0\]\.children\[\d+\]\.source$/.test(i))).toBe(true);
  });

  it('names the structured-output stage when the answer does not match the IR at all', async () => {
    const ai = createFakeAI({ respond: (_r, _c, i) => ({ raw: i === 0 ? { name: 'x' } : tailorIR }) });
    const out = await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345' });
    expect(out.ok).toBe(true);
    expect(out.attempts?.[0]).toMatchObject({ pass: 'first', stage: 'structured_output', category: 'OUTPUT_INVALID' });
    expect(out.attempts?.[0].issues[0]).toMatch(/^IR /);
    expect(out.attempts?.[1]).toMatchObject({ pass: 'repair', stage: 'ok' });
  });

  it('waits 150 s for a compile and a repair, and never retries a timeout of either (s25 and mx03 ran out of 90 s)', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: broken }) });
    await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345' });
    expect(ai.calls.map((c) => c.req.timeoutMs)).toEqual([150_000, 150_000]);
    expect(ai.calls.map((c) => c.req.maxRetries)).toEqual([{ timeout: 0 }, { timeout: 0 }]);
  });

  it('gives the compile and the repair pass the full 16k output budget (8192 cut the repair JSON short)', async () => {
    const ai = createFakeAI({ respond: (_r, _c, i) => ({ raw: i === 0 ? broken : tailorIR }) });
    await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345' });
    expect(ai.calls.map((c) => c.req.maxOutputTokens)).toEqual([16_384, 16_384]);
  });

  it('tells the repair pass about the model\'s own app when the deterministic repair cannot save it', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: broken }) });
    const out = await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345', now: () => 1 });
    const own = validateSpec(irToSpec(broken, { appId: 'app_abc12345', now: 1 }));
    expect(out.attempts![0].issues).toEqual(own.errors.slice(0, 20).map((e) => `${e.code} ${e.path || '(root)'}`));
    expect(out.attempts![0].repairs).toContain('deterministic repair skipped: the app was invalid before it');
    for (const e of own.errors) expect(ai.calls[1].req.prompt).toContain(`${e.path}: ${e.message}`);
  });

  it('never ships a button that changes nothing: NO_OP_UPDATE blocks a new app, though a stored one still opens', async () => {
    const noOp = (x: unknown): ValidationResult => {
      const v = validateSpec(x);
      return { ...v, warnings: [...v.warnings, { code: 'NO_OP_UPDATE', path: 'screens[0].children[3].action', message: 'changes nothing', severity: 'warning', recoverable: true }] };
    };
    const ai = createFakeAI({ respond: () => ({ raw: tailorIR }) });
    const out = await compileWithCloud(text('tailor shop'), complex, { ai, appId: 'app_abc12345', validate: noOp });
    expect(out.ok).toBe(false);
    expect(ai.calls).toHaveLength(2);
    expect(out.attempts![0].issues).toContain('NO_OP_UPDATE screens[0].children[3].action');
    expect(ai.calls[1].req.prompt).toContain('screens[0].children[3].action: changes nothing');
  });

  it('carries the passes into the creation result, so the eval report shows the failing stage', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: broken }) });
    const res = await createApplicationPipeline({ ai, classify: () => complex })(text('tailor shop'));
    expect(res.ok).toBe(false);
    expect(res.compileAttempts?.map((a) => a.category)).toEqual(['OUTPUT_INVALID', 'REPAIR_FAILED']);
  });
});

describe('honestAssumptions (mx05)', () => {
  const request = 'Doctors should only see their own patients and the admin should see everything';
  it('drops a note that says a server or the runtime enforces roles, and says plainly what was left out', () => {
    const out = honestAssumptions(['Roles are enforced by a runtime or server policy.', 'Ages are in years.'], request);
    expect(out[0]).toBe('Ages are in years.');
    expect(out.some((a) => /server|runtime|polic/i.test(a))).toBe(false);
    expect(out.at(-1)).toMatch(/one device for one person.*not built/);
  });
  it('adds nothing when roles were not asked for', () => {
    expect(honestAssumptions(['Ages are in years.'], 'clinic app with patients')).toEqual(['Ages are in years.']);
  });
  it('keeps an assumption that only mentions an admin or a policy, and does not read "log in" or "admin" as roles', () => {
    const fee = 'Late fee policy is set by the admin and applied to every student.';
    expect(honestAssumptions([fee], 'fee register for my coaching class, the admin sets late fees')).toEqual([fee]);
    expect(honestAssumptions([], 'an app to log in my workouts every day')).toEqual([]);
    expect(honestAssumptions(['Permissions are enforced on the server.'], 'clinic with logins for each doctor'))
      .toEqual([expect.stringMatching(/logins and roles are not built/)]);
  });
});
