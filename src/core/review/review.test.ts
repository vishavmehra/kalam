import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { irToSpec } from '../compiler/convert';
import { VERIFY_COPY } from '../pipeline/copy';
import { compilerIRSchema } from '../compiler/ir';
import type { AIBlockVerificationReport } from '../contracts';
import { describeSpec } from '../spec/describe';
import { COMPONENT_TYPES, FIELD_TYPES, type KalamSpec, type ThemePreset } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import {
  applyReviewEdit, finalizeReview, initReview, listUncertainItems, resolveUncertainItem, REVIEW_COPY, reviewModel, reviewReducer,
  reviewSummary, type ReviewEdit, type ReviewResult, type ReviewSource,
} from './index';

const ir = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const tailor = irToSpec(ir, { appId: 'app_tailor01', now: 1 });
const frozen = JSON.stringify(tailor);

/** Applies an edit, asserts it worked and that the result is a valid spec, and returns it. */
function ok(edit: ReviewEdit, spec: KalamSpec = tailor): KalamSpec {
  const r = applyReviewEdit(spec, edit);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  expect(validateSpec(r.spec).ok).toBe(true);
  return r.spec;
}
/** Asserts an edit is rejected with a plain message (no ids, no schema paths) and returns the message. */
function rejected(edit: ReviewEdit, spec: KalamSpec = tailor): string {
  const r: ReviewResult = applyReviewEdit(spec, edit);
  expect(r.ok).toBe(false);
  const msg = r.ok ? '' : r.error;
  expect(msg).not.toMatch(/screens\[|collections\.|aiBlocks\.|_/);
  expect(msg).not.toMatch(/[—–!]/);
  return msg;
}
const screen = (s: KalamSpec, id: string) => s.screens.find((x) => x.id === id);
const component = (s: KalamSpec, id: string) => s.screens.flatMap((x) => x.children).find((c) => c.id === id);
/** The tailor app with no button or voice phrase left that opens Customers. */
const withLostScreen = (): KalamSpec => {
  // Voice phrases work from any screen, so "save customer" (which returns to Customers) counts as a way there too.
  const { go_customers: _open, save_customer: _save, ...intents } = tailor.intents;
  return ok({ kind: 'removeComponent', componentId: 'customers_button' }, { ...tailor, intents });
};

describe('review edits: app name and theme', () => {
  it('renames the app', () => {
    expect(ok({ kind: 'renameApp', name: '  Raju   Tailors ' }).name).toBe('Raju Tailors');
    expect(JSON.stringify(tailor)).toBe(frozen); // the input is never mutated
  });
  it('rejects an empty or too long name', () => {
    expect(rejected({ kind: 'renameApp', name: '   ' })).toMatch(/name/);
    rejected({ kind: 'renameApp', name: 'x'.repeat(61) });
  });
  it('changes the theme to a preset', () => {
    expect(ok({ kind: 'setTheme', preset: 'ocean_blue' }).theme.preset).toBe('ocean_blue');
    rejected({ kind: 'setTheme', preset: 'neon' as ThemePreset });
  });
});

describe('review edits: screens', () => {
  it('adds a screen that the start screen can open', () => {
    const s = ok({ kind: 'addScreen', title: 'Payments' });
    const added = screen(s, 'payments');
    expect(added?.children[0]).toMatchObject({ type: 'heading', label: 'Payments' });
    const button = screen(s, s.initialScreen)?.children.at(-1);
    expect(button).toMatchObject({ type: 'bigButton', label: 'Open Payments' });
    expect(s.actions[(button as { action: string }).action]).toEqual({ type: 'navigate', screen: 'payments' });
    expect(validateSpec(s).warnings.some((w) => w.code === 'UNREACHABLE_SCREEN')).toBe(false);
  });
  it('rejects a ninth screen and a blank title', () => {
    let s = tailor;
    for (const t of ['A', 'B', 'C']) s = ok({ kind: 'addScreen', title: t }, s);
    expect(s.screens).toHaveLength(8);
    expect(rejected({ kind: 'addScreen', title: 'One more' }, s)).toMatch(/8 screens/);
    rejected({ kind: 'addScreen', title: ' ' });
  });
  it('renames a screen', () => {
    expect(screen(ok({ kind: 'renameScreen', screenId: 'customers', title: 'Clients' }), 'customers')?.title).toBe('Clients');
    rejected({ kind: 'renameScreen', screenId: 'customers', title: '' });
    rejected({ kind: 'renameScreen', screenId: 'nope', title: 'Clients' });
  });
  it('reorders screens without changing where the app opens', () => {
    const s = ok({ kind: 'moveScreen', screenId: 'customers', toIndex: 0 });
    expect(s.screens.map((x) => x.id)).toEqual(['customers', 'home', 'new_order', 'order_detail', 'new_customer']);
    expect(s.initialScreen).toBe('home');
    expect(ok({ kind: 'moveScreen', screenId: 'home', toIndex: 99 }).screens.at(-1)?.id).toBe('home');
    rejected({ kind: 'moveScreen', screenId: 'nope', toIndex: 0 });
  });
  it('removes a screen and everything that only led to it', () => {
    const s = ok({ kind: 'removeScreen', screenId: 'customers' });
    expect(screen(s, 'customers')).toBeUndefined();
    expect(s.actions.go_customers).toBeUndefined();
    expect(component(s, 'customers_button')).toBeUndefined();
    expect(s.intents.go_customers).toBeUndefined();
    // "Save customer" no longer returns to the removed screen but keeps its message.
    expect(s.actions.save_customer).toEqual({ type: 'insert', collection: 'customers', then: { feedback: 'Customer saved' } });
  });
  it('removing the detail screen unlinks the list that opened it', () => {
    const s = ok({ kind: 'removeScreen', screenId: 'order_detail' });
    expect(component(s, 'orders_list')).not.toHaveProperty('detailScreen');
  });
  it('removing the start screen opens the app on the next one', () => {
    expect(ok({ kind: 'removeScreen', screenId: 'home' }).initialScreen).toBe('new_order');
  });
  it('keeps at least one screen', () => {
    let s = tailor;
    for (const id of ['customers', 'new_customer', 'order_detail', 'new_order']) s = ok({ kind: 'removeScreen', screenId: id }, s);
    expect(rejected({ kind: 'removeScreen', screenId: 'home' }, s)).toMatch(/at least one screen/);
  });
  it('links a screen nobody can reach', () => {
    const lost = withLostScreen();
    expect(validateSpec(lost).warnings.some((w) => w.code === 'UNREACHABLE_SCREEN')).toBe(true);
    const linked = ok({ kind: 'linkScreen', screenId: 'customers' }, lost);
    expect(validateSpec(linked).warnings.some((w) => w.code === 'UNREACHABLE_SCREEN')).toBe(false);
  });
});

describe('review edits: fields', () => {
  const field = (s: KalamSpec, c: string, f: string) => s.collections[c]?.fields[f];

  it('renames a field and the label on its inputs, keeping the unit', () => {
    const s = ok({ kind: 'editField', collectionId: 'orders', fieldId: 'chest', changes: { label: 'Chest size' } });
    expect(field(s, 'orders', 'chest')?.label).toBe('Chest size');
    expect(component(s, 'chest_input')).toMatchObject({ type: 'number', label: 'Chest size (in)' });
  });
  it('changes a type and turns the inputs into the matching kind', () => {
    const toText = ok({ kind: 'editField', collectionId: 'orders', fieldId: 'chest', changes: { type: 'text' } });
    expect(field(toText, 'orders', 'chest')).toEqual({ type: 'text', label: field(tailor, 'orders', 'chest')?.label });
    expect(component(toText, 'chest_input')).toMatchObject({ type: 'textInput', field: 'chest' });
    const toChoice = ok({ kind: 'editField', collectionId: 'orders', fieldId: 'delivery', changes: { type: 'enum', options: ['Today', 'Tomorrow', 'Later'] } });
    expect(field(toChoice, 'orders', 'delivery')).toMatchObject({ type: 'enum', options: ['Today', 'Tomorrow', 'Later'] });
    expect(component(toChoice, 'delivery_input')).toMatchObject({ type: 'choice', field: 'delivery' });
    expect(component(toChoice, 'detail_delivery')).toMatchObject({ type: 'choice', field: 'delivery' });
    const toYesNo = ok({ kind: 'editField', collectionId: 'customers', fieldId: 'notes', changes: { type: 'boolean' } });
    expect(component(toYesNo, 'notes_input')).toEqual({ id: 'notes_input', type: 'toggle', label: 'Notes', field: 'notes' });
  });
  it('rejects a choice field without choices', () => {
    expect(rejected({ kind: 'editField', collectionId: 'orders', fieldId: 'chest', changes: { type: 'enum' } })).toMatch(/choice/);
    rejected({ kind: 'editField', collectionId: 'orders', fieldId: 'garment', changes: { options: ['  ', ''] } });
    rejected({ kind: 'editField', collectionId: 'orders', fieldId: 'garment', changes: { options: Array.from({ length: 51 }, (_, i) => `Option ${i}`) } });
  });
  it('rejects a type change that breaks something using the field', () => {
    const counting: KalamSpec = { ...tailor, actions: { ...tailor.actions, more_chest: { type: 'increment', target: 'chest' } } };
    expect(validateSpec(counting).ok).toBe(true);
    expect(rejected({ kind: 'editField', collectionId: 'orders', fieldId: 'chest', changes: { type: 'date' } }, counting)).toMatch(/number/);
  });
  it('makes a field optional on the field and its inputs', () => {
    const before = component(tailor, 'customer_input') as { required?: boolean };
    const s = ok({ kind: 'editField', collectionId: 'orders', fieldId: 'customer', changes: { required: false } });
    expect(field(s, 'orders', 'customer')).not.toHaveProperty('required');
    expect(component(s, 'customer_input')).not.toHaveProperty('required');
    expect(before.required === undefined || before.required === true).toBe(true);
    expect(field(ok({ kind: 'editField', collectionId: 'orders', fieldId: 'chest', changes: { required: true } }), 'orders', 'chest')?.required).toBe(true);
  });
  it('edits the choices of a choice field', () => {
    const s = ok({ kind: 'editField', collectionId: 'orders', fieldId: 'garment', changes: { options: ['Kurta', 'Shirt', 'Lehenga', 'Kurta'] } });
    expect(field(s, 'orders', 'garment')).toMatchObject({ type: 'enum', options: ['Kurta', 'Shirt', 'Lehenga'] });
    expect(component(s, 'garment_choice')).not.toHaveProperty('options');
  });
  it('adds a field and an input for it above the buttons of every form for those entries', () => {
    const s = ok({ kind: 'addField', collectionId: 'orders', field: { label: 'Phone', type: 'text', required: true } });
    expect(field(s, 'orders', 'phone')).toEqual({ type: 'text', label: 'Phone', required: true });
    const form = screen(s, 'new_order')?.children ?? [];
    const at = form.findIndex((c) => c.type === 'textInput' && c.field === 'phone');
    expect(at).toBe(form.findIndex((c) => c.type === 'bigButton') - 1);
    expect(screen(s, 'order_detail')?.children.some((c) => c.type === 'textInput' && c.field === 'phone')).toBe(true);
    const withChoice = ok({ kind: 'addField', collectionId: 'customers', field: { label: 'Area', type: 'enum', options: ['North', 'South'] } });
    expect(component(withChoice, 'area_input')).toMatchObject({ type: 'choice', field: 'area' });
    rejected({ kind: 'addField', collectionId: 'customers', field: { label: 'Area', type: 'enum' } });
    rejected({ kind: 'addField', collectionId: 'nope', field: { label: 'Area', type: 'text' } });
  });
  it('removes a field with its inputs and the places that only pointed at it', () => {
    const s = ok({ kind: 'removeField', collectionId: 'orders', fieldId: 'sleeve' });
    expect(field(s, 'orders', 'sleeve')).toBeUndefined();
    expect(component(s, 'sleeve_input')).toBeUndefined();
    const photo = s.aiBlocks.slip_to_order;
    expect(photo?.kind === 'extractFromPhoto' && photo.fields).not.toContain('sleeve');
    const noDate = ok({ kind: 'removeField', collectionId: 'orders', fieldId: 'delivery' });
    expect(component(noDate, 'orders_list')).not.toHaveProperty('secondary');
    expect(component(noDate, 'orders_list')).not.toHaveProperty('sort');
  });
  it('gives a list a new main field when its old one is removed', () => {
    const s = ok({ kind: 'removeField', collectionId: 'customers', fieldId: 'name' });
    expect(component(s, 'customer_list')).toMatchObject({ primary: 'phone' });
  });
  it('rejects removing a field a total still uses', () => {
    expect(rejected({ kind: 'removeField', collectionId: 'orders', fieldId: 'advance' })).toMatch(/total or filter/);
  });
});

describe('review edits: labels, data and AI steps', () => {
  it('renames a button', () => {
    expect(component(ok({ kind: 'renameComponent', componentId: 'save_order_button', label: 'Save' }), 'save_order_button')).toMatchObject({ label: 'Save' });
    rejected({ kind: 'renameComponent', componentId: 'save_order_button', label: '' });
    rejected({ kind: 'renameComponent', componentId: 'nope', label: 'Save' });
  });
  it('corrects the role of a piece of text', () => {
    const withText = ok({ kind: 'addScreen', title: 'Help' });
    const heading = screen(withText, 'help')?.children[0];
    const asText = ok({ kind: 'setRole', componentId: heading!.id, role: 'text' }, withText);
    expect(component(asText, heading!.id)).toMatchObject({ type: 'text', label: 'Help' });
    expect(component(ok({ kind: 'setRole', componentId: heading!.id, role: 'heading' }, asText), heading!.id)?.type).toBe('heading');
    rejected({ kind: 'setRole', componentId: 'save_order_button', role: 'text' });
    rejected({ kind: 'setRole', componentId: 'nope', role: 'text' });
  });
  it('removes an AI step and the places that used it', () => {
    const s = ok({ kind: 'removeAIBlock', blockId: 'slip_to_order' });
    expect(s.aiBlocks).toEqual({});
    expect(component(s, 'scan_slip')).not.toHaveProperty('aiBlock');
  });
  it('sets how an AI step runs, keeping the defaults out of the spec', () => {
    const local = ok({ kind: 'setAIBlockPolicy', blockId: 'slip_to_order', fallback: 'none', onError: 'manual_entry' });
    expect(local.aiBlocks.slip_to_order).toMatchObject({ fallback: 'none', onError: 'manual_entry' });
    expect(reviewModel(local).aiSteps).toEqual([{ id: 'slip_to_order', kind: 'extractFromPhoto', fallback: 'none', onError: 'manual_entry' }]);
    const back = ok({ kind: 'setAIBlockPolicy', blockId: 'slip_to_order', fallback: 'cloud', onError: 'keep_input' }, local);
    expect(back.aiBlocks.slip_to_order).not.toHaveProperty('fallback');
    expect(back.aiBlocks.slip_to_order).not.toHaveProperty('onError');
    rejected({ kind: 'setAIBlockPolicy', blockId: 'nope', fallback: 'none' });
  });
  it('removes unused data but not data the app uses', () => {
    const extra: KalamSpec = { ...tailor, collections: { ...tailor.collections, suppliers: { label: 'Suppliers', fields: { name: { type: 'text', label: 'Name' } } } } };
    expect(ok({ kind: 'removeCollection', collectionId: 'suppliers' }, extra).collections).not.toHaveProperty('suppliers');
    rejected({ kind: 'removeCollection', collectionId: 'customers' });
  });
});

describe('review model', () => {
  it('summarises the edited draft with the check words for unchecked AI steps', () => {
    const renamed = ok({ kind: 'renameScreen', screenId: 'home', title: 'Today' });
    const words = VERIFY_COPY.notChecked.needs_samples;
    const report = {
      blockId: 'slip_to_order', appVersion: 1, blockHash: 'x', promptVersion: 'ai-block-verify/1', status: 'unverified' as const,
      testCount: 0, passCount: 0, judgeUsed: false, cases: [], checkedAt: 1, message: words,
    };
    const u = reviewSummary(renamed, { verification: [report] });
    expect(u.screens[0]?.title).toBe('Today');
    expect(u.aiFeatures[0]?.verified).toBe(words);
    expect(reviewSummary(renamed).aiFeatures[0]?.verified).toBe('Not checked yet');
  });

  it('lists what the controls need, with ids kept for them only', () => {
    const m = reviewModel(tailor);
    expect(m.name).toBe(tailor.name);
    expect(m.screens.find((s) => s.start)?.id).toBe('home');
    expect(m.screens.find((s) => s.id === 'home')?.components.filter((c) => c.type === 'bigButton').map((b) => b.label)).toEqual(['New order', 'Customers']);
    expect(m.collections.find((c) => c.id === 'orders')?.fields.find((f) => f.id === 'garment')).toMatchObject({ type: 'enum', required: true, options: expect.any(Array) });
  });
});

describe('uncertain items', () => {
  const report: AIBlockVerificationReport = {
    blockId: 'slip_to_order', appVersion: 1, blockHash: 'abcd1234', promptVersion: 'ai-block-verify/1', status: 'unverified',
    reason: 'needs_samples', testCount: 0, passCount: 0, judgeUsed: false, cases: [], checkedAt: 1,
    message: VERIFY_COPY.notChecked.needs_samples,
  };
  const general = describeSpec(tailor).assumptions;
  const source: ReviewSource = {
    route: 'cloud', spec: tailor, verification: [report],
    warnings: [{ code: 'generated_on_device', path: '', message: 'The on-device model drafted this app. Review it carefully.', severity: 'warning', recoverable: true }],
    understanding: { ...describeSpec(tailor), assumptions: [...general, 'Measurements are in inches.'] },
    clarifications: ['Should finished orders stay in the list?'],
  };

  it('lists checks, the compiler assumptions and its questions, in plain words', () => {
    const items = listUncertainItems(tailor, source);
    expect(items.map((i) => i.id)).toEqual(['check:untested:slip_to_order', 'check:generated_on_device', 'assumption:0', 'question:0']);
    expect(items[0]).toMatchObject({ kind: 'check', message: report.message, target: { type: 'aiBlock', id: 'slip_to_order' }, actions: ['accept', 'remove'] });
    expect(items[2]).toMatchObject({ kind: 'assumption', message: 'Measurements are in inches.', actions: ['accept', 'change'] });
    expect(items.map((i) => i.message).join(' ')).not.toMatch(/screens\[|aiBlocks\./);
  });

  it('does not treat template notes or general facts as uncertain', () => {
    const items = listUncertainItems(tailor, { ...source, route: 'template', clarifications: undefined, warnings: [] });
    expect(items.map((i) => i.kind)).toEqual(['check']);
  });

  it('finds screens nobody can reach and offers to link or remove them', () => {
    const lost = withLostScreen();
    const item = listUncertainItems(lost).find((i) => i.id === 'check:unreachable:customers');
    expect(item).toMatchObject({ actions: ['accept', 'change', 'remove'], target: { type: 'screen', id: 'customers' } });
    const linked = resolveUncertainItem(lost, item!, 'change');
    if (!linked.ok) throw new Error(linked.error);
    expect(listUncertainItems(linked.spec).some((i) => i.id === item!.id)).toBe(false);
    const removed = resolveUncertainItem(lost, item!, 'remove');
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.spec.screens.some((s) => s.id === 'customers')).toBe(false);
  });

  it('accept keeps the app; remove takes the part out; answered items drop off the list', () => {
    const [untested] = listUncertainItems(tailor, source);
    const kept = resolveUncertainItem(tailor, untested!, 'accept');
    expect(kept).toEqual({ ok: true, spec: tailor });
    expect(listUncertainItems(tailor, source, [untested!.id]).some((i) => i.id === untested!.id)).toBe(false);
    const removed = resolveUncertainItem(tailor, untested!, 'remove');
    if (!removed.ok) throw new Error(removed.error);
    expect(Object.keys(removed.spec.aiBlocks)).toEqual([]);
    expect(resolveUncertainItem(tailor, untested!, 'change').ok).toBe(false);
  });

  it('turns an answer to an assumption or question into a rebuild instruction', () => {
    const items = listUncertainItems(tailor, source);
    const assumption = items.find((i) => i.kind === 'assumption')!;
    const r = resolveUncertainItem(tailor, assumption, 'change', '  Use centimetres  ');
    expect(r).toEqual({ ok: true, spec: tailor, rebuild: 'Kalam assumed: Measurements are in inches. Correction: Use centimetres' });
    expect(resolveUncertainItem(tailor, assumption, 'change', '   ').ok).toBe(false);
    const question = items.find((i) => i.kind === 'question')!;
    expect(resolveUncertainItem(tailor, question, 'change', 'No').ok && (resolveUncertainItem(tailor, question, 'change', 'No') as { rebuild?: string }).rebuild)
      .toBe('Should finished orders stay in the list? Answer: No');
  });
});

describe('review session', () => {
  it('applies edits, keeps the draft valid on a rejected edit, and resets', () => {
    let s = initReview(tailor);
    s = reviewReducer(s, { type: 'edit', edit: { kind: 'renameApp', name: 'Raju Tailors' } });
    expect(s).toMatchObject({ edits: 1, error: undefined });
    expect(s.spec.name).toBe('Raju Tailors');
    const before = s.spec;
    s = reviewReducer(s, { type: 'edit', edit: { kind: 'renameApp', name: '' } });
    expect(s.spec).toBe(before);
    expect(s.error).toMatch(/name/);
    s = reviewReducer(s, { type: 'clearError' });
    expect(s.error).toBeUndefined();
    s = reviewReducer(s, { type: 'reset' });
    expect(s).toEqual(initReview(tailor));
  });

  it('remembers answered items and collects rebuild answers', () => {
    const source: ReviewSource = {
      route: 'cloud', spec: tailor, warnings: [], clarifications: ['Should finished orders stay in the list?'],
      understanding: describeSpec(tailor),
    };
    let s = initReview(tailor);
    const [untested, question] = listUncertainItems(s.spec, source, s.resolved);
    s = reviewReducer(s, { type: 'resolve', item: untested!, action: 'accept' });
    s = reviewReducer(s, { type: 'resolve', item: question!, action: 'change', answer: 'Yes, for a month' });
    expect(s.resolved).toEqual([untested!.id, question!.id]);
    expect(s.rebuild).toEqual(['Should finished orders stay in the list? Answer: Yes, for a month']);
    expect(s.edits).toBe(0);
    expect(listUncertainItems(s.spec, source, s.resolved)).toEqual([]);
  });

  it('Continue validates the corrected app and names the part to fix when it fails', () => {
    const done = finalizeReview(reviewReducer(initReview(tailor), { type: 'edit', edit: { kind: 'renameScreen', screenId: 'home', title: 'Today' } }));
    if (!done.ok) throw new Error(done.error);
    expect(done.spec.screens[0]?.title).toBe('Today');
    expect(done.rebuild).toEqual([]);
    const broken: KalamSpec = {
      ...tailor,
      screens: tailor.screens.map((sc) => ({
        ...sc, children: sc.children.map((c) => (c.id === 'save_order_button' && c.type === 'bigButton' ? { ...c, action: 'gone' } : c)),
      })),
    };
    const bad = finalizeReview(initReview(broken));
    if (bad.ok) throw new Error('expected a failure');
    expect(bad.error).not.toMatch(/screens\[|children/);
    expect(bad.target).toEqual({ type: 'component', id: 'save_order_button' });
  });

  it('a change that changes nothing is not counted, and the same answer is kept once', () => {
    let s = reviewReducer(initReview(tailor), { type: 'edit', edit: { kind: 'moveScreen', screenId: 'home', toIndex: 0 } });
    s = reviewReducer(s, { type: 'edit', edit: { kind: 'renameApp', name: tailor.name } });
    expect(s.edits).toBe(0);
    expect(s.spec).toBe(tailor);
    const [question] = listUncertainItems(tailor, { route: 'cloud', spec: tailor, warnings: [], understanding: describeSpec(tailor), clarifications: ['Keep old orders?'] })
      .filter((i) => i.kind === 'question');
    s = reviewReducer(s, { type: 'resolve', item: question!, action: 'change', answer: 'Yes' });
    s = reviewReducer(s, { type: 'resolve', item: question!, action: 'change', answer: 'Yes' });
    expect(s.rebuild).toEqual(['Keep old orders? Answer: Yes']);
    // Continue passes the answers on, so the screen can ask before saving without them.
    const done = finalizeReview(s);
    expect(done.ok && done.rebuild).toEqual(['Keep old orders? Answer: Yes']);
  });

  it('keeps the words on the screen controls in the translated catalogues, not in core copy', () => {
    const en = (JSON.parse(readFileSync(new URL('../../i18n/locales/en.json', import.meta.url), 'utf8')) as { review: Record<string, Record<string, string> | string> }).review;
    const names = (k: string) => Object.keys(en[k] as Record<string, string>).sort();
    expect(names('action')).toEqual(['accept', 'change', 'remove']);
    expect(names('fallback')).toEqual(['cloud', 'none']);
    expect(names('onError')).toEqual(['keep_input', 'manual_entry']);
    // Every kind of component and field has a plain name, so a new kind cannot ship without one.
    expect(names('componentType')).toEqual([...COMPONENT_TYPES].sort());
    expect(names('fieldType')).toEqual([...FIELD_TYPES].sort());
    // The screen reader label of an item button says which item it answers.
    expect(en.actionFor).toContain('{action}');
    expect(en.actionFor).toContain('{message}');
    const kinds = en.componentType as Record<string, string>;
    for (const c of reviewModel(tailor).screens.flatMap((x) => x.components)) expect(kinds[c.type]).toMatch(/^[A-Z][a-z ]+$/);
    for (const moved of ['actions', 'actionLabel', 'componentTypes', 'fallback', 'onError', 'fieldTypes']) expect(REVIEW_COPY).not.toHaveProperty(moved);
  });
});
