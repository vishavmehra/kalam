import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import type { SpecPatchOp } from '../contracts';
import { validateSpec, type KalamSpec } from '../spec';
import { applyPatchOps, classifyEdit, parseSmallEdit, THEME_PRESET_TOKENS } from './index';

const spec = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.spec) throw new Error(`fixture ${name} invalid`);
  return r.spec;
};
const tailor = spec('tailor-measurement-book');
const find = (s: KalamSpec, id: string) => s.screens.flatMap((x) => x.children).find((c) => c.id === id);

describe('applyPatchOps', () => {
  it('applies theme, name, label and visibility ops immutably', () => {
    const before = JSON.stringify(tailor);
    const ops: SpecPatchOp[] = [
      { op: 'setThemeToken', token: 'primary', value: '#0a0' },
      { op: 'setThemeNumber', token: 'fontScale', value: 9 },
      { op: 'setThemeNumber', token: 'radius', value: 7.6 },
      { op: 'setAppName', value: '  Ramesh Darzi ' },
      { op: 'renameComponent', component: 'save_button', label: 'Save' },
      { op: 'setComponentProperty', component: 'scan_slip', property: 'visible', value: false },
      { op: 'renameScreen', screen: 'new', title: 'Naya order' },
      { op: 'moveComponent', component: 'save_button', direction: 'up' },
    ];
    const r = applyPatchOps(tailor, ops);
    expect(r.errors).toEqual([]);
    const s = r.spec as KalamSpec;
    expect(s.theme).toMatchObject({ primary: '#00AA00', fontScale: 1.6, radius: 8 });
    expect(s.name).toBe('Ramesh Darzi');
    expect(find(s, 'save_button')).toMatchObject({ label: 'Save' });
    expect(find(s, 'scan_slip')).toMatchObject({ visible: false });
    expect(s.screens[1]?.title).toBe('Naya order');
    expect(s.screens[1]?.children.at(-2)?.id).toBe('save_button');
    expect(JSON.stringify(tailor)).toBe(before);
    expect(s.version).toBe(tailor.version);
  });

  it('applies presets as token sets', () => {
    const r = applyPatchOps(tailor, [{ op: 'setThemePreset', preset: 'ocean_blue' }]);
    expect(r.spec?.theme).toMatchObject({ ...THEME_PRESET_TOKENS.ocean_blue, preset: 'ocean_blue', radius: 16 });
  });

  it('adds screens, collections, actions and components that validate together', () => {
    const r = applyPatchOps(tailor, [
      { op: 'addCollection', id: 'payments', collection: { label: 'Payments', fields: { amount: { type: 'number', label: 'Amount' } } } },
      { op: 'addScreen', after: 'home', screen: { id: 'pay', title: 'Payment', form: 'payments', children: [
        { id: 'pay_amount', type: 'number', label: 'Amount', field: 'amount' },
        { id: 'pay_save', type: 'bigButton', label: 'Save payment', action: 'save_payment' },
      ] } },
      { op: 'addAction', id: 'save_payment', action: { type: 'insert', collection: 'payments', then: { navigate: 'home' } } },
      { op: 'addAction', id: 'go_pay', action: { type: 'navigate', screen: 'pay' } },
      { op: 'addComponent', screen: 'home', index: 0, component: { id: 'go_pay_button', type: 'bigButton', label: 'Take payment', action: 'go_pay' } },
      { op: 'updateCollectionField', collection: 'orders', field: 'phone', definition: { type: 'text', label: 'Phone' } },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.spec?.screens.map((s) => s.id)).toEqual(['home', 'pay', 'new']);
    expect(r.spec?.screens[0]?.children[0]?.id).toBe('go_pay_button');
    expect(r.spec?.collections.orders?.fields.phone).toEqual({ type: 'text', label: 'Phone' });
  });

  it('reports op errors with the op index', () => {
    const r = applyPatchOps(tailor, [
      { op: 'setAppName', value: 'Ok' },
      { op: 'renameComponent', component: 'ghost', label: 'Boo' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: 'PATCH_FAILED', path: 'ops[1]' });
    expect(r.errors[0]?.message).toMatch(/^Change 2: .*ghost/);
  });

  it('rejects malformed or hostile ops before touching the spec', () => {
    const bad = [
      { op: 'setComponentProperty', component: 'save_button', property: '__proto__', value: 'x' },
      { op: 'setComponentProperty', component: 'save_button', property: 'constructor', value: 'x' },
      { op: 'setComponentProperty', component: 'save_button', property: 'type', value: 'list' },
      { op: 'addCollection', id: '__proto__', collection: { fields: {} } },
      { op: 'setThemeToken', token: 'primary', value: 'javascript:alert(1)' },
      { op: 'deleteEverything' },
      { op: 'addComponent', screen: 'home', component: { id: 'x', type: 'iframe' } },
    ];
    for (const op of bad) {
      const r = applyPatchOps(tailor, [op as unknown as SpecPatchOp]);
      expect(r.ok, JSON.stringify(op)).toBe(false);
      expect(r.errors[0]?.path).toBe('ops[0]');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns validation errors when the result is inconsistent', () => {
    const r = applyPatchOps(tailor, [{ op: 'addComponent', screen: 'home', component: { id: 'bad', type: 'bigButton', label: 'Bad', action: 'nope' } }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('UNKNOWN_ACTION');
  });

  it('fixes initialScreen when its screen is removed, and errors on the last screen', () => {
    const habit = spec('habit-counter');
    expect(applyPatchOps(habit, [{ op: 'removeScreen', screen: 'home' }]).errors[0]?.message).toMatch(/at least one screen/);
    const gst = spec('gst-calculator');
    const swapped = applyPatchOps(gst, [
      { op: 'addScreen', screen: { id: 'about', title: 'About', children: [{ id: 'about_text', type: 'text', label: 'GST helper' }] } },
      { op: 'removeScreen', screen: 'calc' },
    ]);
    expect(swapped.errors).toEqual([]);
    expect(swapped.spec?.initialScreen).toBe('about');
    // Removing a screen that buttons still navigate to is caught by validation.
    expect(applyPatchOps(tailor, [{ op: 'removeScreen', screen: 'new' }]).errors.map((e) => e.code)).toContain('UNKNOWN_SCREEN');
  });
});

describe('applyPatchOps on KalamSpec 1.1 layout groups and permissions', () => {
  const linked = validateSpec(loadFixture('valid', 'tailor-orders-linked', 'v11')).spec as KalamSpec;
  const home = (s: KalamSpec | undefined) => s!.screens.find((x) => x.id === 'home')!;

  it('removes a grouped component from its group, and drops a group left empty', () => {
    const one = applyPatchOps(linked, [{ op: 'removeComponent', component: 'advance_total' }]);
    expect(one.errors).toEqual([]);
    expect(home(one.spec).layout?.[0]).toEqual({ type: 'row', children: ['open_orders'] });
    const both = applyPatchOps(linked, [
      { op: 'removeComponent', component: 'add_order' },
      { op: 'removeComponent', component: 'add_customer' },
    ]);
    expect(both.errors).toEqual([]);
    expect(home(both.spec).layout?.map((g) => g.type)).toEqual(['row', 'grid']); // the card held only those two
  });

  it('moves a grouped component inside its group, where the order on screen comes from', () => {
    const r = applyPatchOps(linked, [{ op: 'moveComponent', component: 'advance_chart', direction: 'down' }]);
    expect(r.errors).toEqual([]);
    expect(home(r.spec).layout?.[1]).toMatchObject({ children: ['garment_chart', 'advance_chart'] });
    expect(home(r.spec).children.map((c) => c.id)).toEqual(home(linked).children.map((c) => c.id));
  });

  it('keeps permissions derived from the components after an edit', () => {
    const gone = applyPatchOps(linked, [{ op: 'removeComponent', component: 'delivery_reminder' }]);
    expect(gone.errors).toEqual([]);
    expect(gone.spec?.permissions).toBeUndefined();
    expect(validateSpec(gone.spec).warnings.map((w) => w.code)).not.toContain('PERMISSION_UNUSED');
    const photo = applyPatchOps(linked, [{ op: 'addComponent', screen: 'home', component: { id: 'snap', type: 'photo', label: 'Photo' } }]);
    expect(photo.errors).toEqual([]);
    expect(photo.spec?.permissions?.map((p) => p.kind)).toEqual(['camera', 'notifications']);
    expect(photo.spec?.permissions?.[1].reason).toBe('To remind you a day before each delivery'); // the app's own reason stays
    // A 1.0 app is not given the 1.1 section just because it has a photo.
    expect(applyPatchOps(tailor, [{ op: 'setAppName', value: 'Tailor' }]).spec?.permissions).toBeUndefined();
  });
});

describe('parseSmallEdit', () => {
  const ops = (text: string, s: KalamSpec = tailor) => parseSmallEdit(text, s).ops;

  it('maps colour names (English and Hinglish) to theme tokens', () => {
    expect(ops('make the buttons green')).toEqual([{ op: 'setThemeToken', token: 'primary', value: '#2E7D32' }]);
    expect(ops('button hara karo')).toEqual([{ op: 'setThemeToken', token: 'primary', value: '#2E7D32' }]);
    expect(ops('background neela kar do')).toEqual([{ op: 'setThemeToken', token: 'background', value: '#1E63C6' }]);
    expect(ops('change the text colour to dark blue')).toEqual([{ op: 'setThemeToken', token: 'text', value: '#0D3B7A' }]);
    expect(ops('use #ff8800 for the accent')).toEqual([{ op: 'setThemeToken', token: 'secondary', value: '#ff8800' }]);
  });

  it('renames components and screens with fuzzy label matching', () => {
    expect(ops('rename Save order to Save')).toEqual([{ op: 'renameComponent', component: 'save_button', label: 'Save' }]);
    expect(ops('rename the "sav ordr" button to "Done"')).toEqual([{ op: 'renameComponent', component: 'save_button', label: 'Done' }]);
    expect(ops('rename the New order screen to Naya order')).toEqual([{ op: 'renameScreen', screen: 'new', title: 'Naya order' }]);
    expect(ops('Save order ka naam Rakh do karo')).toEqual([{ op: 'renameComponent', component: 'save_button', label: 'Rakh do' }]);
    expect(parseSmallEdit('rename the wardrobe to Closet', tailor).unmatched).toEqual(['rename the wardrobe to Closet']);
  });

  it('changes text size, corners, visibility, presets, dark theme and app name', () => {
    expect(ops('make the text bigger')).toEqual([{ op: 'setThemeNumber', token: 'fontScale', value: 1.2 }]);
    expect(ops('much larger font')).toEqual([{ op: 'setThemeNumber', token: 'fontScale', value: 1.3 }]);
    expect(ops('akshar bade karo')).toEqual([{ op: 'setThemeNumber', token: 'fontScale', value: 1.2 }]);
    expect(ops('rounder corners')).toEqual([{ op: 'setThemeNumber', token: 'radius', value: 22 }]);
    expect(ops('square corners')).toEqual([{ op: 'setThemeNumber', token: 'radius', value: 0 }]);
    expect(ops('hide the photo button')).toEqual([{ op: 'setComponentProperty', component: 'scan_slip', property: 'visible', value: false }]);
    expect(ops('show the scan measurement slip')).toEqual([{ op: 'setComponentProperty', component: 'scan_slip', property: 'visible', value: true }]);
    expect(ops('use the warm paper theme')).toEqual([{ op: 'setThemePreset', preset: 'warm_paper' }]);
    expect(ops('dark mode').map((o) => (o as { token: string }).token)).toEqual(['background', 'surface', 'text']);
    expect(ops('call the app Darzi Book')).toEqual([{ op: 'setAppName', value: 'Darzi Book' }]);
  });

  it('clamps the font scale', () => {
    const big = applyPatchOps(tailor, [{ op: 'setThemeNumber', token: 'fontScale', value: 1.6 }]).spec as KalamSpec;
    expect(ops('make the text bigger', big)).toEqual([{ op: 'setThemeNumber', token: 'fontScale', value: 1.6 }]);
  });

  it('handles several clauses and reports what it did not understand', () => {
    const r = parseSmallEdit('make the background white, the text bigger and add a reports tab', tailor);
    expect(r.ops).toEqual([
      { op: 'setThemeToken', token: 'background', value: '#FFFFFF' },
      { op: 'setThemeNumber', token: 'fontScale', value: 1.2 },
    ]);
    expect(r.unmatched).toEqual(['add a reports tab']);
    expect(r.confidence).toBeGreaterThan(0.4);
    expect(r.confidence).toBeLessThan(0.9);
    expect(parseSmallEdit('sing me a song', tailor)).toEqual({ ops: [], confidence: 0, unmatched: ['sing me a song'] });
  });

  it('produces ops that apply cleanly', () => {
    const r = parseSmallEdit('button hara karo and make the text bigger, hide the photo button', tailor);
    expect(applyPatchOps(tailor, r.ops).ok).toBe(true);
  });
});

describe('classifyEdit', () => {
  const cls = (t: string) => classifyEdit(t, tailor).editClass;
  it('detects structural edits', () => {
    for (const t of [
      'add a new screen for customers', 'create a payments collection', 'add a workflow for approvals',
      'link orders to customers', 'add a monthly report', 'add a dashboard', 'add roles for staff',
      'naya page jodo', 'add a field for phone number',
    ]) expect(cls(t), t).toBe('structural');
  });
  it('detects small edits', () => {
    for (const t of [
      'make the buttons blue', 'rename Save order to Save', 'bigger text', 'hide the photo button',
      'translate the labels to Tamil', 'dark theme', 'rounder corners', 'button hara karo', 'change the font',
    ]) expect(cls(t), t).toBe('small');
  });
  it('defaults unknown requests to structural with a reason', () => {
    expect(classifyEdit('make it calculate profit per customer', tailor)).toEqual({
      editClass: 'structural', reasons: ['Not a simple style or label change'],
    });
  });
});
