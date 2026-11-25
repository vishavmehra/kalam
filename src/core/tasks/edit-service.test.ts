import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import { irToSpec } from '../compiler/convert';
import { compilerIRSchema } from '../compiler/ir';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { createEditService, wireOpsToPatch } from './edit-service';

const ir = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const base: KalamSpec = validateSpec(irToSpec(ir, { appId: 'app_tailor01', now: 1 })).spec!;

const supplierOps = {
  summary: 'Added a suppliers screen with a list and an add form.',
  ops: [
    { op: 'addCollection', collectionDef: { id: 'suppliers', label: 'Suppliers', fields: [{ id: 'name', type: 'text', label: 'Supplier', required: true }, { id: 'phone', type: 'text', label: 'Phone' }] } },
    { op: 'addAction', actionDef: { id: 'go_suppliers', type: 'navigate', screen: 'suppliers' } },
    { op: 'addAction', actionDef: { id: 'save_supplier', type: 'insert', collection: 'suppliers', thenNavigate: 'suppliers' } },
    {
      op: 'addScreen', after: 'customers',
      screenDef: {
        id: 'suppliers', title: 'Suppliers', form: 'suppliers', components: [
          { id: 'supplier_list', type: 'list', source: 'suppliers', primary: 'name', secondaryField: 'phone' },
          { id: 'supplier_name', type: 'textInput', label: 'Supplier', field: 'name' },
          { id: 'supplier_phone', type: 'textInput', label: 'Phone', field: 'phone' },
          { id: 'save_supplier_button', type: 'bigButton', label: 'Save supplier', action: 'save_supplier' },
        ],
      },
    },
    { op: 'addComponent', screen: 'home', componentDef: { id: 'suppliers_button', type: 'bigButton', label: 'Suppliers', action: 'go_suppliers' } },
  ],
};

describe('edit service', () => {
  it('applies a clear small edit deterministically without any model', async () => {
    const ai = createFakeAI({ onDevice: 'available' });
    const before = structuredClone(base);
    const out = await createEditService({ ai }).applyInstruction(base, 'change the app name to "Sharma Tailors"');
    expect(out.ok).toBe(true);
    expect(out).toMatchObject({ editClass: 'small', route: 'deterministic', provider: 'deterministic' });
    expect(out.spec?.name).toBe('Sharma Tailors');
    expect(out.summary).toMatch(/Sharma Tailors/);
    expect(ai.calls).toHaveLength(0);
    expect(base).toEqual(before);
  });

  it('asks Gemini Nano for a restricted patch when the parser is unsure', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { ops: [{ op: 'setThemePreset', preset: 'soft_lavender' }, { op: 'addScreen' }] } }) });
    const svc = createEditService({
      ai,
      classifyEdit: () => ({ editClass: 'small', reasons: [] }),
      parseSmallEdit: () => ({ ops: [], confidence: 0.2, unmatched: ['make it feel softer'] }),
    });
    const out = await svc.applyInstruction(base, 'make it feel softer');
    // `addScreen` is outside Nano's schema, so the Nano parse rejects the patch; the edit then
    // escalates once to the cloud editor (whose reply here is also invalid) and nothing is applied.
    expect(ai.calls.map((c) => [c.req.taskType, c.req.mode, c.result.errorCode])).toEqual([
      ['generate_patch', 'only_on_device', 'invalid_output'],
      ['modify_app', 'only_in_cloud', 'invalid_output'],
    ]);
    expect(out.ok).toBe(false);
    expect(out.spec).toBeUndefined();
    expect(out.message).toMatch(/safe way/);
  });

  it('applies a valid Nano patch on device', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { ops: [{ op: 'setThemePreset', preset: 'soft_lavender' }] } }) });
    const svc = createEditService({
      ai,
      classifyEdit: () => ({ editClass: 'small', reasons: [] }),
      parseSmallEdit: () => ({ ops: [], confidence: 0.2, unmatched: ['make it feel softer'] }),
    });
    const out = await svc.applyInstruction(base, 'make it feel softer');
    expect(out).toMatchObject({ ok: true, route: 'on_device', provider: 'firebase', editClass: 'small' });
    expect(out.spec?.theme.preset).toBe('soft_lavender');
    expect(ai.cloudCalls()).toHaveLength(0);
  });

  it('routes structural edits to Firebase cloud as constrained patch ops', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: supplierOps }) });
    const before = structuredClone(base);
    const out = await createEditService({ ai }).applyInstruction(base, 'Add a new screen to keep track of my cloth suppliers with their phone numbers');
    expect(out.errors).toEqual([]);
    expect(out).toMatchObject({ ok: true, editClass: 'structural', route: 'cloud', provider: 'firebase' });
    expect(ai.calls[0].req).toMatchObject({ taskType: 'modify_app', mode: 'only_in_cloud', role: 'edit' });
    expect(ai.calls[0].ctx.escalationReason).toBeUndefined();
    expect(out.spec?.screens.map((s) => s.id)).toContain('suppliers');
    expect(out.spec?.collections.suppliers).toBeDefined();
    expect(out.ops?.map((o) => o.op)).toEqual(['addCollection', 'addAction', 'addAction', 'addScreen', 'addComponent']);
    expect(out.summary).toBe(supplierOps.summary);
    expect(base).toEqual(before);
  });

  it('fails structural edits offline in plain language and keeps the app', async () => {
    const ai = createFakeAI({ online: false });
    const out = await createEditService({ ai }).applyInstruction(base, 'Add a new screen to keep track of my cloth suppliers with their phone numbers');
    expect(out.ok).toBe(false);
    expect(out.spec).toBeUndefined();
    expect(out.message).toMatch(/offline/i);
    expect(ai.calls).toHaveLength(0);
  });

  it('rejects cloud patches that would break the app', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: { summary: 'x', ops: [{ op: 'addComponent', screen: 'home', componentDef: { id: 'bad', type: 'bigButton', label: 'Go', action: 'missing_action' } }] } }) });
    const out = await createEditService({ ai }).applyInstruction(base, 'Add a new screen for suppliers');
    expect(out.ok).toBe(false);
    expect(out.spec).toBeUndefined();
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it('applyOps applies explicit ops synchronously', () => {
    const out = createEditService({ ai: createFakeAI() }).applyOps(base, [{ op: 'setAppName', value: 'New name' }], 'Renamed');
    expect(out).toMatchObject({ ok: true, route: 'deterministic', editClass: 'small', summary: 'Renamed' });
  });

  it('converts wire ops with fresh, de-duplicated ids', () => {
    const ops = wireOpsToPatch(base, [{ op: 'addComponent', screen: 'home', componentDef: { id: 'Orders List', type: 'text', label: 'Hi' } }]);
    expect(ops[0]).toMatchObject({ op: 'addComponent', screen: 'home', component: { id: 'orders_list_2', type: 'text' } });
  });
});
