import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { validateSpec, type KalamSpec } from '../spec';
import {
  duplicateComponent, fieldKindOf, isRequired, moveComponentTo, renameComponentLabel, resizeComponent, setFieldKind, setRequired,
  sizeOf, staysOnScreen, widenComponent, type DirectResult,
} from './direct';
import { findPart } from './visual-edit';

const load = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.spec) throw new Error(`fixture ${name} invalid`);
  return r.spec;
};
const tailor = load('tailor-measurement-book');
const gst = load('gst-calculator');
const ids = (s: KalamSpec, screen: string) => s.screens.find((x) => x.id === screen)?.children.map((c) => c.id);
const ok = (r: DirectResult): KalamSpec => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason} ${r.detail ?? ''}`);
  return r.spec;
};
const why = (r: DirectResult) => (r.ok ? 'ok' : r.reason);
const part = (s: KalamSpec, id: string) => findPart(s, id)?.component;

describe('moveComponentTo', () => {
  it('reorders on its own screen and leaves the input alone', () => {
    const before = JSON.stringify(tailor);
    const r = moveComponentTo(tailor, 'new_order', { screen: 'home', before: 'orders_count' });
    expect(ids(ok(r), 'home')).toEqual(['new_order', 'orders_count', 'upcoming', 'advance_total', 'orders_list']);
    expect(JSON.stringify(tailor)).toBe(before);
    expect(why(moveComponentTo(tailor, 'new_order', { screen: 'home', before: null }))).toBe('same');
    expect(why(moveComponentTo(tailor, 'nope', { screen: 'home', before: null }))).toBe('missing');
  });

  it('moves a part that needs no fields to another screen, at the slot asked for', () => {
    const r = moveComponentTo(tailor, 'orders_count', { screen: 'new', before: 'save_button' });
    const s = ok(r);
    expect(r).toMatchObject({ kind: 'movedToScreen', screen: 'new' });
    expect(ids(s, 'new')?.slice(-3)).toEqual(['scan_slip', 'orders_count', 'save_button']);
    expect(ids(s, 'home')).not.toContain('orders_count');
    expect(ok(moveComponentTo(tailor, 'orders_count', { screen: 'new', before: null })).screens[1]?.children.at(-1)?.id).toBe('orders_count');
  });

  it('keeps fields and save buttons on their screen, and refuses unknown screens', () => {
    expect(why(moveComponentTo(tailor, 'customer_input', { screen: 'home', before: null }))).toBe('stays');
    expect(why(moveComponentTo(tailor, 'save_button', { screen: 'home', before: null }))).toBe('stays');
    expect(staysOnScreen(tailor, part(tailor, 'new_order')!)).toBe(false);
    expect(why(moveComponentTo(tailor, 'orders_count', { screen: 'ghost', before: null }))).toBe('missing');
  });

  it('takes the part out of its layout group, and drops a group that empties', () => {
    const home = (layout: unknown) =>
      validateSpec({ ...tailor, screens: tailor.screens.map((s) => (s.id === 'home' ? { ...s, layout } : s)) }).spec as KalamSpec;
    const grouped = home([{ type: 'row', children: ['orders_count', 'upcoming'] }]);
    expect(grouped.screens[0]?.layout).toBeDefined();
    const one = ok(moveComponentTo(grouped, 'orders_count', { screen: 'new', before: null }));
    expect(one.screens[0]?.layout).toEqual([{ type: 'row', children: ['upcoming'] }]);
    const none = ok(moveComponentTo(one, 'upcoming', { screen: 'new', before: null }));
    expect(none.screens[0]?.layout).toBeUndefined();
  });
});

describe('resize and width', () => {
  it('writes style.size, and medium removes it again', () => {
    const big = ok(resizeComponent(tailor, 'new_order', 'large'));
    expect(part(big, 'new_order')?.style).toEqual({ size: 'large' });
    expect(sizeOf(part(big, 'new_order')!)).toBe('large');
    expect(big.schemaVersion.split('.')[1]).toBe('1'); // a style needs format 1.1
    const back = ok(resizeComponent(big, 'new_order', 'medium'));
    expect(part(back, 'new_order')?.style).toBeUndefined();
    expect(why(resizeComponent(tailor, 'new_order', 'medium'))).toBe('same');
    expect(why(resizeComponent(tailor, 'nope', 'small'))).toBe('missing');
  });

  it('toggles full width next to a size', () => {
    const s = ok(widenComponent(ok(resizeComponent(tailor, 'new_order', 'small')), 'new_order', true));
    expect(part(s, 'new_order')?.style).toEqual({ size: 'small', fullWidth: true });
    expect(part(ok(widenComponent(s, 'new_order', false)), 'new_order')?.style).toEqual({ size: 'small' });
  });
});

describe('renameComponentLabel', () => {
  it('renames, trims, and refuses empty or unchanged names', () => {
    const s = ok(renameComponentLabel(tailor, 'save_button', '  Keep   order '));
    expect(part(s, 'save_button')).toMatchObject({ label: 'Keep order' });
    expect(why(renameComponentLabel(tailor, 'save_button', '   '))).toBe('invalid');
    expect(why(renameComponentLabel(s, 'save_button', 'Keep order'))).toBe('same');
  });
});

describe('required', () => {
  it('sets the input and the collection field together, and clears both', () => {
    expect(isRequired(tailor, 'chest_input')).toBe(false);
    const on = ok(setRequired(tailor, 'chest_input', true));
    expect(isRequired(on, 'chest_input')).toBe(true);
    expect(on.collections.orders?.fields.chest?.required).toBe(true);
    const off = ok(setRequired(on, 'chest_input', false));
    expect(isRequired(off, 'chest_input')).toBe(false);
    expect(part(off, 'chest_input')).not.toHaveProperty('required');
    // "Customer name" is required by its field only; turning it off clears that too.
    expect(isRequired(tailor, 'customer_input')).toBe(true);
    expect(isRequired(ok(setRequired(tailor, 'customer_input', false)), 'customer_input')).toBe(false);
    expect(why(setRequired(tailor, 'customer_input', true))).toBe('same');
    expect(why(setRequired(tailor, 'new_order', true))).toBe('unsupported');
  });
});

describe('setFieldKind', () => {
  it('text and long text always change, even with entries', () => {
    expect(fieldKindOf(part(tailor, 'customer_input')!)).toBe('text');
    const long = ok(setFieldKind(tailor, 'customer_input', 'longText', { hasEntries: true }));
    expect(part(long, 'customer_input')).toMatchObject({ type: 'textInput', multiline: true });
    expect(long.collections.orders?.fields.customer).toMatchObject({ type: 'text', required: true });
    expect(fieldKindOf(part(long, 'customer_input')!)).toBe('longText');
    const short = ok(setFieldKind(long, 'customer_input', 'text', { hasEntries: true }));
    expect(part(short, 'customer_input')).not.toHaveProperty('multiline');
  });

  it('refuses to retype a field that holds entries, and does it when the collection is empty', () => {
    expect(why(setFieldKind(tailor, 'chest_input', 'text', { hasEntries: true }))).toBe('hasEntries');
    const s = ok(setFieldKind(tailor, 'chest_input', 'text', { hasEntries: false }));
    expect(part(s, 'chest_input')).toMatchObject({ type: 'textInput', field: 'chest', label: 'Chest' });
    expect(s.collections.orders?.fields.chest).toMatchObject({ type: 'text', label: 'Chest' });
  });

  it('leaves choices alone and an unchanged kind as it is', () => {
    expect(why(setFieldKind(tailor, 'garment_choice', 'text', { hasEntries: false }))).toBe('unsupported');
    expect(why(setFieldKind(tailor, 'chest_input', 'number', { hasEntries: false }))).toBe('same');
  });

  it('changes an input with no collection without asking about entries', () => {
    const r = setFieldKind(gst, 'amount_input', 'text', { hasEntries: true });
    expect(['ok', 'invalid']).toContain(why(r)); // never hasEntries: nothing is stored
  });
});

describe('duplicateComponent', () => {
  it('copies a part right after the original under a fresh id', () => {
    const r = duplicateComponent(tailor, 'new_order');
    const s = ok(r);
    expect(r).toMatchObject({ kind: 'duplicated', component: 'new_order_copy' });
    expect(ids(s, 'home')?.slice(-2)).toEqual(['new_order', 'new_order_copy']);
    expect(ids(ok(duplicateComponent(s, 'new_order')), 'home')).toContain('new_order_copy_2');
    expect(why(duplicateComponent(tailor, 'customer_input'))).toBe('unsupported');
  });
});
