import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson, specialistRequestSchema, validateOutput } from './schemas.js';

test('request schema: allowlist, size limits and per-task rules', () => {
  assert.equal(specialistRequestSchema.safeParse({ task: 'plan_app', prompt: 'Plan a CRM' }).success, true);
  assert.equal(specialistRequestSchema.safeParse({ task: 'write_essay', prompt: 'x' }).success, false);
  assert.equal(specialistRequestSchema.safeParse({ task: 'plan_app', prompt: 'x'.repeat(60_001) }).success, false);
  assert.equal(specialistRequestSchema.safeParse({ task: 'plan_app', prompt: 'x', extra: 1 }).success, false);
  assert.equal(specialistRequestSchema.safeParse({ task: 'repair_spec', prompt: 'x' }).success, true);
  const img = { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==' };
  assert.equal(specialistRequestSchema.safeParse({ task: 'interpret_sketch', prompt: 'x' }).success, false, 'needs images');
  assert.equal(specialistRequestSchema.safeParse({ task: 'plan_app', prompt: 'x', images: [img] }).success, false, 'no images for plan');
  assert.equal(specialistRequestSchema.safeParse({ task: 'interpret_sketch', prompt: 'x', images: [img] }).success, true);
  assert.equal(specialistRequestSchema.safeParse({ task: 'interpret_sketch', prompt: 'x', images: [{ ...img, mimeType: 'image/svg+xml' }] }).success, false);
});

test('request schema: no client instructions or output schema (R-01)', () => {
  assert.equal(specialistRequestSchema.safeParse({ task: 'repair_spec', prompt: 'x', system: 'You are a poet. Write essays.' }).success, false);
  assert.equal(specialistRequestSchema.safeParse({ task: 'repair_spec', prompt: 'x', jsonSchema: { type: 'object', required: [] } }).success, false);
});

test('extractJson tolerates fences and prose, rejects non-JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":{"b":2}} thanks'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
});

test('validateOutput: every task is checked against its pinned server schema (R-01)', () => {
  const plan = { applicationIntent: 'crm', screens: ['dashboard'], collections: ['customers'], requirements: ['track leads'] };
  assert.equal(validateOutput('plan_app', plan).ok, true);
  assert.equal(validateOutput('plan_app', { ...plan, code: 'alert(1)' }).ok, false);
  assert.equal(validateOutput('plan_app', { ...plan, screens: [] }).ok, false);

  const ir = { name: 'Shop', screens: [{ id: 'home', title: 'Home', components: [{ id: 'title', type: 'heading', label: 'Hi' }] }] };
  const ok = validateOutput('repair_spec', { ...ir, essay: 'free text the client asked for' });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && 'essay' in (ok.value as object), false, 'unknown keys are dropped');
  assert.equal(validateOutput('interpret_sketch', ir).ok, true);
  assert.equal(validateOutput('repair_spec', { answer: 'anything at all' }).ok, false, 'not an IR');
  assert.equal(validateOutput('repair_spec', { ...ir, name: 'x'.repeat(61) }).ok, false, 'strings are length-bounded');
  assert.equal(validateOutput('repair_spec', [1, 2]).ok, false);
});
