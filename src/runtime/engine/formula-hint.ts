/**
 * Formula error diagnostics (docs/09 §8.7). A formula that cannot be worked out shows a dash, never a crash;
 * this adds the plain reason and the way out ("Open Edit and fix the formula"), in the app's language.
 * It reads the evaluator's error text only. No entry values, no formula text and no names reach the message,
 * so it is safe to show, speak and log. Pure TypeScript.
 */
import type { FormulaResult } from '@/core/contracts';
import { engineText, type EngineKey } from '@/i18n/engine-messages';

export type FormulaProblemKind = 'too_complex' | 'unknown_name' | 'invalid';

export interface FormulaHint {
  /** Safe to log: a fixed word, never the formula or any value. */
  kind: FormulaProblemKind;
  /** One or two sentences: what is wrong and how to fix it. */
  message: string;
}

const KEY: Record<FormulaProblemKind, EngineKey> = {
  too_complex: 'formulaHintComplex',
  unknown_name: 'formulaHintName',
  invalid: 'formulaHintInvalid',
};

/** Sorts an evaluator or validator error into one of three causes a person can act on. */
export function formulaProblemKind(error: string): FormulaProblemKind {
  if (/too complex|nested too deeply/i.test(error)) return 'too_complex';
  if (/^Unknown name|is not a collection|has no field|Unknown form field|Unknown counter|needs a collection/i.test(error)) return 'unknown_name';
  return 'invalid';
}

/** The hint for a failed result, or undefined when the formula worked (an empty answer is not a failure). */
export function formulaHint(result: FormulaResult, lang?: string | null): FormulaHint | undefined {
  if (result.ok) return undefined;
  const kind = formulaProblemKind(result.error);
  return { kind, message: engineText(lang, KEY[kind]) };
}
