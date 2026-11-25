/**
 * docs/10 §15.5: translations of medical, money or legal wording need extra review. This is a plain
 * keyword check over the app's own text, so it works offline and never calls a model. It only decides
 * whether to ask the person to read the translation themselves.
 */
import type { KalamSpec } from '../spec/schema';
import { collectTranslatableLabels } from './labels';

export type SensitiveKind = 'health' | 'money' | 'legal';

const PATTERNS: ReadonlyArray<readonly [SensitiveKind, RegExp]> = [
  ['health', /\b(medicine|medication|dose|dosage|tablet|pill|prescription|symptom|doctor|allerg\w*|injection|blood|diabet\w*|insulin)\b|दवा|दवाई|खुराक|गोली/iu],
  ['money', /\b(loan|interest|emi|tax|gst|vat|credit|debit|debt|owe[ds]?|payable|balance due|installment)\b|कर्ज|ब्याज|उधार|बकाया|उधारी/iu],
  ['legal', /\b(legal|contract|agreement|lawyer|court|notice|terms and conditions|consent)\b|अनुबंध|कानूनी/iu],
];

/** Kinds of sensitive wording found in the app, in a fixed order. Empty when there is none. */
export function sensitiveKinds(spec: KalamSpec): SensitiveKind[] {
  const text = [spec.name, spec.description ?? '', ...(spec.meta.tags ?? []), ...collectTranslatableLabels(spec).map((l) => l.text)].join('\n');
  return PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

/** One plain sentence for the language sheet, or undefined when nothing needs extra care. */
export function sensitiveNotice(kinds: readonly SensitiveKind[]): string | undefined {
  if (!kinds.length) return undefined;
  const what = kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}` : kinds[0];
  return `This app has ${what} wording. Read the translation yourself before you rely on it, and change anything that is not right.`;
}
