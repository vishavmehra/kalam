/**
 * Deterministic template registry (docs/07 §4, CP2). Matching and parameter extraction are
 * pure keyword/regex work — a calculator, counter or checklist is created with zero model calls.
 */
import type { TemplateDefinition, TemplateId, TemplateMatch } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import type { BuildOpts, KalamTemplate } from './base';
import { containsPhrase, normalizeText } from './extract';
import { calculatorTemplate } from './apps/calculator';
import { checklistTemplate } from './apps/checklist';
import { contactBookTemplate } from './apps/contact-book';
import { counterTemplate } from './apps/counter';
import { expenseTrackerTemplate } from './apps/expense-tracker';
import { habitTrackerTemplate } from './apps/habit-tracker';
import { inventoryTemplate } from './apps/inventory';
import { measurementLogTemplate } from './apps/measurement-log';
import { notesTemplate } from './apps/notes';
import { reminderListTemplate } from './apps/reminder-list';
import { simpleFormTemplate } from './apps/simple-form';

export { THEME_PRESET_TOKENS, themeFromPreset } from './themes';
export { extractAppName, extractCurrency, extractList, extractUnit, normalizeText } from './extract';

type AnyTemplate = KalamTemplate<Record<string, unknown>>;

const TEMPLATES: readonly AnyTemplate[] = [
  calculatorTemplate, counterTemplate, checklistTemplate, notesTemplate, expenseTrackerTemplate,
  habitTrackerTemplate, contactBookTemplate, inventoryTemplate, simpleFormTemplate, measurementLogTemplate,
  reminderListTemplate,
] as readonly AnyTemplate[];

const BY_ID = new Map<TemplateId, AnyTemplate>(TEMPLATES.map((t) => [t.id, t]));

/** Keywords normalised once (matching runs on every keystroke-level request). */
const INDEX = TEMPLATES.map((t) => ({
  t,
  strong: t.strongKeywords.map((k) => [k, normalizeText(k)] as const),
  all: t.keywords.map((k) => [k, normalizeText(k)] as const),
}));

export function listTemplates(): TemplateDefinition[] {
  return [...TEMPLATES];
}

export function getTemplate(id: TemplateId): TemplateDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * Keyword scoring (English + Hindi/Hinglish). A "strong" keyword alone scores 0.7, each extra
 * matched keyword adds 0.1 (max 1). Weak keywords alone cap at 0.5, so they never pick a template
 * on their own. Sorted best first; zero-score templates are omitted.
 */
export function matchTemplates(text: string): TemplateMatch[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  const matches: TemplateMatch[] = [];
  for (const { t, strong: strongIndex, all: allIndex } of INDEX) {
    const hit = (pairs: ReadonlyArray<readonly [string, string]>) => pairs.filter(([, n]) => containsPhrase(norm, n)).map(([k]) => k);
    const strong = hit(strongIndex);
    const all = [...new Set([...strong, ...hit(allIndex)])];
    if (!all.length) continue;
    const score = strong.length ? Math.min(1, 0.7 + 0.1 * (all.length - 1)) : Math.min(0.5, 0.2 * all.length);
    matches.push({ templateId: t.id, score: Math.round(score * 100) / 100, matchedKeywords: all });
  }
  return matches.sort((a, b) => b.score - a.score || b.matchedKeywords.length - a.matchedKeywords.length);
}

export interface InstantiatedTemplate {
  spec: KalamSpec;
  params: Record<string, unknown>;
}

/**
 * defaults ← deterministic extraction ← `overrides` (e.g. Nano-filled params), validated with the
 * template's Zod schema before building. Invalid overrides are rejected, never partially applied.
 */
export function instantiateTemplate(
  id: TemplateId,
  text: string,
  opts: BuildOpts,
  overrides: Record<string, unknown> = {},
): { ok: true; value: InstantiatedTemplate } | { ok: false; error: string } {
  const t = BY_ID.get(id);
  if (!t) return { ok: false, error: `Unknown template "${id}"` };
  const parsed = t.paramsSchema.safeParse({ ...t.defaults, ...t.extractParams(text), ...overrides });
  if (!parsed.success) return { ok: false, error: `Template parameters are invalid: ${parsed.error.message}` };
  return { ok: true, value: { spec: t.build(parsed.data, opts), params: parsed.data } };
}
