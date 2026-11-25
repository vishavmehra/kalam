/**
 * `TranslationKey`: every key in the English catalogue as a union of dot-separated strings, so
 * `t('shelf.empty.title')` autocompletes and a typo is a compile error. English is the source of truth.
 */
import type en from './locales/en.json';

type EnglishCatalogue = Omit<typeof en, '$meta'>;

/** A plural leaf is an object with a string `other`; anything else that is an object is a namespace. */
type Flatten<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends { other: string }
      ? `${Prefix}${K}`
      : T[K] extends object
        ? Flatten<T[K], `${Prefix}${K}.`>
        : never;
}[keyof T & string];

export type TranslationKey = Flatten<EnglishCatalogue>;
