/** Words for the Visual App Studio: catalogue keys per option, and the sentence a change leaves in the version history. */
import type { DirectFailure, DirectKind, DirectResult, FieldKind, StyleSize } from '@/core/edit/direct';
import { findPart } from '@/core/edit/visual-edit';
import type { KalamSpec } from '@/core/spec/schema';
import type { TranslationKey } from '@/i18n/keys';
import type { TFunction } from '@/i18n/translator';
import { nameOf, nounOf, type Noun } from './model';

export const NOUN_KEY: Record<Noun, TranslationKey> = {
  button: 'visualStudio.kind.button', field: 'visualStudio.kind.field', list: 'visualStudio.kind.list',
  words: 'visualStudio.kind.words', part: 'visualStudio.kind.part',
};
export const SIZE_KEY: Record<StyleSize, TranslationKey> = {
  small: 'visualStudio.size.small', medium: 'visualStudio.size.medium', large: 'visualStudio.size.large',
};
export const FIELD_KEY: Record<FieldKind, TranslationKey> = {
  text: 'visualStudio.field.text', longText: 'visualStudio.field.longText', number: 'visualStudio.field.number',
  date: 'visualStudio.field.date', yesNo: 'visualStudio.field.yesNo',
};
/** "Nothing would change" is not an error, so it has no words. */
export const FAIL_KEY: Record<Exclude<DirectFailure, 'same'>, TranslationKey> = {
  missing: 'visualStudio.fail.missing', stays: 'visualStudio.fail.stays', hasEntries: 'visualStudio.fail.hasEntries',
  unsupported: 'visualStudio.fail.unsupported', invalid: 'visualStudio.fail.invalid',
};
export const SUMMARY_KEY: Record<DirectKind, TranslationKey> = {
  moved: 'visualStudio.summary.moved', movedToScreen: 'visualStudio.summary.movedToScreen', resized: 'visualStudio.summary.resized',
  widened: 'visualStudio.summary.widened', renamed: 'visualStudio.summary.renamed', required: 'visualStudio.summary.required',
  optional: 'visualStudio.summary.optional', retyped: 'visualStudio.summary.retyped', duplicated: 'visualStudio.summary.duplicated',
};

/** The part's own name, or its noun when it has none ("Button"). Reads the spec the change produced. */
export function partLabel(t: TFunction, spec: KalamSpec, id: string): string {
  const c = findPart(spec, id)?.component;
  return c ? nameOf(c) || t(NOUN_KEY[nounOf(c)]) : t(NOUN_KEY.part);
}

/** One plain sentence for the version history, e.g. "Moved Save to Home". */
export function summaryOf(t: TFunction, r: Extract<DirectResult, { ok: true }>): string {
  const name = partLabel(t, r.spec, r.component);
  const screen = r.screen ? r.spec.screens.find((s) => s.id === r.screen)?.title ?? r.screen : '';
  return t(SUMMARY_KEY[r.kind], { name, screen });
}
