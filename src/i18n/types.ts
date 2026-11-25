/** Shared i18n types. Pure TypeScript: no React, no React Native, no Expo. */

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A message that changes with a count. `other` is required; the rest follow the language's CLDR rules. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | PluralForms;

/** `$meta` block at the top of every locale file. */
export interface CatalogueMeta {
  /** True until a native speaker has reviewed the file. Shown to the person in Settings. */
  draft: boolean;
  note?: string;
}

/** Values you can pass to `t(key, params)`. Numbers are formatted for the active locale. */
export type TranslateParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface TranslateOptions {
  /** Used only when the key is missing in every language. Never a raw key. */
  defaultValue?: string;
}

export type MissingKind = 'missing' | 'fallback' | 'param';

export interface MissingEvent {
  kind: MissingKind;
  key: string;
  language: string;
  /** Name of the placeholder when `kind` is `param`. */
  param?: string;
}

/** Flat, validated view of one locale file. */
export interface ParsedCatalogue {
  meta: CatalogueMeta;
  messages: ReadonlyMap<string, Message>;
  /** Structural problems found while flattening. Empty for a well-formed file. */
  problems: readonly string[];
}
