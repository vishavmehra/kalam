/**
 * Plural categories. Uses `Intl.PluralRules` when the runtime has data for the language, and a built-in
 * copy of the CLDR cardinal rules for Kalam's ten languages when it does not (some Hermes builds on
 * Android ship without PluralRules). Never builds plurals by appending "s" (docs/10 §13.4).
 * Pure TypeScript.
 */
import type { PluralCategory } from './types';

type Rule = (n: number) => PluralCategory;

const one = (cond: boolean): PluralCategory => (cond ? 'one' : 'other');

/** CLDR cardinal rules for the ten shipped languages. `n` is already an absolute value. */
const RULES: Record<string, Rule> = {
  // English: 1 is singular (and 1.0, which JS cannot tell apart).
  en: (n) => one(n === 1),
  // Hindi, Bengali, Gujarati, Kannada: "i = 0 or n = 1", so 0 and 0.5 are singular as well.
  hi: (n) => one(Math.trunc(n) === 0 || n === 1),
  bn: (n) => one(Math.trunc(n) === 0 || n === 1),
  gu: (n) => one(Math.trunc(n) === 0 || n === 1),
  kn: (n) => one(Math.trunc(n) === 0 || n === 1),
  // Punjabi: "n = 0..1" (whole 0 or 1 only).
  pa: (n) => one(n === 0 || n === 1),
  // Marathi, Tamil, Telugu, Malayalam: only 1 is singular.
  mr: (n) => one(n === 1),
  ta: (n) => one(n === 1),
  te: (n) => one(n === 1),
  ml: (n) => one(n === 1),
};

/** Fallback rule for a language, exposed for tests. Languages we have no rule for use English. */
export function fallbackPluralCategory(language: string, count: number): PluralCategory {
  const rule = RULES[language.split(/[-_]/)[0]!.toLowerCase()] ?? RULES.en!;
  return rule(Math.abs(count));
}

const intlCache = new Map<string, Intl.PluralRules | null>();

function intlRules(language: string): Intl.PluralRules | null {
  const cached = intlCache.get(language);
  if (cached !== undefined) return cached;
  let rules: Intl.PluralRules | null = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function' && Intl.PluralRules.supportedLocalesOf([language]).length > 0) {
      rules = new Intl.PluralRules(language);
    }
  } catch {
    rules = null;
  }
  intlCache.set(language, rules);
  return rules;
}

/** Plural category of `count` in `language`. Non-finite counts use `other`. */
export function pluralCategory(language: string, count: number): PluralCategory {
  if (!Number.isFinite(count)) return 'other';
  const rules = intlRules(language);
  if (rules) {
    try {
      return rules.select(count) as PluralCategory;
    } catch {
      /* fall through to the built-in rule */
    }
  }
  return fallbackPluralCategory(language, count);
}

/** Clears cached Intl objects. For tests only. */
export function resetPluralCache(): void {
  intlCache.clear();
}
