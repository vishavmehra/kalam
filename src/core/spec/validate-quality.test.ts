/**
 * The "does it work" checks (eval 2026-11-25): buttons that change an entry really change something (s20), fixed
 * values fit their field, a photo lands in an image field (s19), and every saved field is shown somewhere (s24).
 */
import { describe, expect, it } from 'vitest';
import { irToSpec } from '../compiler/convert';
import { EXAMPLE_IR } from '../compiler/prompt';
import type { KalamSpec } from './schema';
import { validateSpec } from './validate';

/** The compiler's prompt example: waterings with a list, an add screen and a details screen. */
const base = (): KalamSpec => structuredClone(validateSpec(irToSpec(EXAMPLE_IR, { appId: 'app_quality1', now: 1 })).spec!);
const codes = (spec: KalamSpec) => {
  const v = validateSpec(spec);
  return { errors: v.errors.map((e) => `${e.code} ${e.path}`), warnings: v.warnings.map((w) => `${w.code} ${w.path}`) };
};
const home = (s: KalamSpec) => s.screens.find((x) => x.id === 'home')!;

describe('update actions must change something', () => {
  it('flags a "Mark done" that has no inputs and no fixed value (s20), as a warning so a stored app still opens', () => {
    const s = base();
    s.actions.mark = { type: 'update', collection: 'waterings', record: 'selected' };
    home(s).children.push({ id: 'mark_button', type: 'bigButton', label: 'Mark done', action: 'mark' });
    const { errors, warnings } = codes(s);
    expect(warnings.some((w) => w.startsWith('NO_OP_UPDATE screens[0].children'))).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts the same button when it writes a fixed value that fits the field', () => {
    const s = base();
    s.actions.mark = { type: 'update', collection: 'waterings', record: 'selected', set: { spot: 'Balcony' } };
    home(s).children.push({ id: 'mark_button', type: 'bigButton', label: 'Move to balcony', action: 'mark' });
    expect(codes(s).errors).toEqual([]);
  });

  it('rejects a fixed value that does not fit, or names a missing field', () => {
    const s = base();
    s.actions.mark = { type: 'update', collection: 'waterings', record: 'selected', set: { spot: 'Garden', amount: 'lots', nope: true } };
    home(s).children.push({ id: 'mark_button', type: 'bigButton', label: 'Mark', action: 'mark' });
    const { errors } = codes(s);
    expect(errors).toContain('FIELD_TYPE_MISMATCH actions.mark.set.spot');
    expect(errors).toContain('FIELD_TYPE_MISMATCH actions.mark.set.amount');
    expect(errors).toContain('UNKNOWN_FIELD actions.mark.set.nope');
  });
});

describe('photos and saved fields', () => {
  it('keeps a photo only in an image field (s19)', () => {
    const s = base();
    const add = s.screens.find((x) => x.id === 'add')!;
    add.children.unshift({ id: 'photo_input', type: 'photo', label: 'Plant photo', field: 'plant' });
    expect(codes(s).errors).toContain('FIELD_TYPE_MISMATCH screens[1].children[0].field');
    s.collections.waterings.fields.photo = { type: 'image', label: 'Plant photo' };
    (add.children[0] as { field: string }).field = 'photo';
    s.screens.find((x) => x.id === 'details')!.children.unshift({ id: 'photo_edit', type: 'photo', label: 'Plant photo', field: 'photo' });
    expect(codes(s)).toEqual({ errors: [], warnings: [] });
  });

  it('warns about every field that is saved but never shown again (s24)', () => {
    const s = base();
    const list = home(s).children.find((c) => c.type === 'list') as { detailScreen?: string };
    delete list.detailScreen;
    expect(codes(s).warnings.filter((w) => w.startsWith('FIELD_NOT_SHOWN'))).toEqual([
      'FIELD_NOT_SHOWN collections.waterings.fields.amount', 'FIELD_NOT_SHOWN collections.waterings.fields.spot',
    ]);
  });

  it('wants the screen a list opens to show the whole entry, even fields another list shows (s20 Details)', () => {
    const s = base();
    const details = s.screens.find((x) => x.id === 'details')!;
    const kept = details.children.filter((c) => !('field' in c) || c.field !== 'spot');
    expect(kept.length).toBeLessThan(details.children.length);
    details.children = kept;
    // Another list shows "spot" in its row, which used to count as shown.
    home(s).children.push({ id: 'by_spot', type: 'list', source: 'waterings', primary: 'spot' });
    const i = s.screens.indexOf(details);
    expect(codes(s).warnings).toContain(`FIELD_NOT_SHOWN screens[${i}]`);
  });
});
