/**
 * The compiler metrics the golden set could not measure before (docs/13 §6.6, D13-021): component precision, hallucinated
 * components, action accuracy and a first-answer reference integrity. Together with the metrics scores.ts already
 * computes, they make the twelve of the table, each reported on its own (never one blended number).
 *
 * These are deterministic proxies, and the report says so. The golden set lists the controls that must exist, not every
 * control that is allowed, so "appropriate" here means wired and asked for, not "a person would have chosen it":
 *  - a component is appropriate when what it points at exists (a button's action, a list's collection, an input's field)
 *    and, for the advanced kinds (chart, timer, reminder, signature, photo), the request or the golden case asked for it;
 *  - a hallucinated component is an advanced one nobody asked for;
 *  - an action is correct when its button label and the action's kind agree (a Delete button deletes, a Save button saves,
 *    and a delete is never hidden behind another word);
 *  - a reference is dangling when the model's FIRST answer named a screen, collection, action, field, AI step or target that
 *    did not exist (the validator's UNKNOWN_* codes in the pass log), over all references in the app that came out.
 * Pure: no I/O and no src imports beyond types, like expectations.ts.
 */
import type { KalamAction, KalamComponent, KalamSpec } from '@/core/spec/schema';
import type { CaseResult, GoldenExpected, Rate } from './types';
import { rate } from './stats';

export interface SpecStructure {
  components: { total: number; appropriate: number; hallucinated: string[] };
  actions: { total: number; correct: number; wrong: string[] };
  references: { total: number; danglingFirstPass: number };
}

/** Kinds a person must ask for. A heading, a list or a button is structure; a chart or a timer is a choice. */
const ADVANCED = ['chart', 'timer', 'reminder', 'signature', 'photo'] as const;
type Advanced = (typeof ADVANCED)[number];
const ASKED: Record<Advanced, RegExp> = {
  chart: /\b(?:charts?|graphs?|trends?|plots?|reports?|breakdown|by (?:month|week|day|category)|pie|bar)\b|चार्ट|ग्राफ/i,
  timer: /\b(?:timers?|countdown|stop ?watch|minutes?|seconds?|time (?:it|the|each|spent)|duration)\b|टाइमर/i,
  reminder: /\b(?:remind\w*|alerts?|notif\w*|due dates?|follow.?ups?|deadlines?)\b|याद/i,
  signature: /\b(?:sign\w*|signature|consent|approval|acknowledg\w*)\b|हस्ताक्षर|दस्तखत/i,
  photo: /\b(?:photos?|pictures?|scan\w*|camera|image|slip|receipt|bill|snap|handwrit\w*)\b|फोटो|तस्वीर/i,
};

const DELETE_WORD = /\b(?:delete|remove|discard|erase)\b|हटा|मिटा/i;
const SAVE_WORD = /^\s*(?:save|submit|update|confirm|done|record|store)\b|सेव/i;
const SAVES: ReadonlySet<string> = new Set(['insert', 'update', 'increment', 'decrement', 'runAI', 'clearForm', 'feedback', 'speak']);

const UNKNOWN_REF = new Set([
  'UNKNOWN_SCREEN', 'UNKNOWN_COLLECTION', 'UNKNOWN_TARGET', 'UNKNOWN_AI_BLOCK', 'UNKNOWN_ACTION', 'UNKNOWN_FIELD',
]);

const has = (o: Record<string, unknown>, id: unknown): boolean => typeof id === 'string' && Object.hasOwn(o, id);

/** Every id the app points at: screens, collections, actions, fields, AI steps and counters or number fields. */
function countReferences(spec: KalamSpec): number {
  let n = 0;
  if (spec.initialScreen) n += 1;
  for (const s of spec.screens) {
    if (s.form) n += 1;
    for (const c of s.children) {
      if (c.type === 'bigButton') n += 1;
      if (c.type === 'list') n += 2 + [c.secondary, c.sort?.field, c.toggleField, c.detailScreen].filter(Boolean).length;
      if (c.type === 'chart') n += 1 + [c.valueField, c.groupBy, c.dateField].filter(Boolean).length;
      if (c.type === 'reminder') n += 2 + [c.doneField, c.titleField].filter(Boolean).length;
      if ('field' in c && c.field) n += 1;
      if ('aiBlock' in c && c.aiBlock) n += 1;
    }
  }
  for (const a of Object.values(spec.actions) as KalamAction[]) {
    const x = a as unknown as Record<string, unknown>;
    n += ['screen', 'collection', 'target', 'aiBlock', 'thenNavigate'].filter((k) => typeof x[k] === 'string').length;
  }
  return n;
}

function appropriate(spec: KalamSpec, screenForm: string | undefined, c: KalamComponent): boolean {
  const fieldOf = (collection: string | undefined, field: unknown) =>
    !!collection && has(spec.collections, collection) && has(spec.collections[collection]!.fields, field);
  switch (c.type) {
    case 'bigButton': return has(spec.actions, c.action);
    case 'list': return has(spec.collections, c.source) && fieldOf(c.source, c.primary);
    case 'number': case 'textInput': case 'date': case 'choice': case 'toggle': return fieldOf(screenForm, c.field);
    case 'stat': return c.expr.trim().length > 0;
    case 'chart': return has(spec.collections, c.source);
    case 'reminder': return fieldOf(c.source, c.dateField);
    case 'signature': return fieldOf(screenForm, c.field);
    default: return true;
  }
}

/** What the model's first answer got wrong, and what it built, for one app. */
export function measureStructure(
  spec: KalamSpec,
  request: string,
  expected: Pick<GoldenExpected, 'requiredComponents'>,
  firstPassIssues: readonly string[] = [],
): SpecStructure {
  const required = new Set<string>(expected.requiredComponents);
  const hallucinated: string[] = [];
  let total = 0;
  let good = 0;
  for (const s of spec.screens) {
    for (const c of s.children) {
      total += 1;
      const advanced = (ADVANCED as readonly string[]).includes(c.type);
      const unrequested = advanced && !required.has(c.type) && !ASKED[c.type as Advanced].test(request);
      if (unrequested) hallucinated.push(`${s.id}.${c.id}:${c.type}`);
      if (!unrequested && appropriate(spec, s.form, c)) good += 1;
    }
  }
  let actions = 0;
  let correct = 0;
  const wrong: string[] = [];
  for (const s of spec.screens) {
    for (const c of s.children) {
      if (c.type !== 'bigButton') continue;
      const action = spec.actions[c.action];
      actions += 1;
      const kind = action?.type;
      const ok = !!kind
        && (kind === 'delete' ? DELETE_WORD.test(c.label) : true)
        && (DELETE_WORD.test(c.label) ? kind === 'delete' : true)
        && (SAVE_WORD.test(c.label) ? SAVES.has(kind) : true);
      if (ok) correct += 1;
      else wrong.push(`${s.id}.${c.id}`);
    }
  }
  const dangling = firstPassIssues.filter((i) => UNKNOWN_REF.has(i.split(' ')[0] ?? '')).length;
  return {
    components: { total, appropriate: good, hallucinated },
    actions: { total: actions, correct, wrong },
    references: { total: countReferences(spec), danglingFirstPass: dangling },
  };
}

/** The request in words, from what the scoring page stored about the input (never pixels). */
export function requestOf(c: CaseResult): string {
  const i = c.detail?.input;
  if (!i) return '';
  const sketch = i.sketch ? [i.sketch.title, ...i.sketch.pages.flatMap((p) => [p.title, ...p.items.map((x) => ('label' in x ? x.label : 'text' in x ? x.text : '') ?? '')])] : [];
  return [i.text, i.audioTranscript, i.video?.summary, ...sketch].filter(Boolean).join('\n');
}

export interface StructureTotals {
  componentPrecision: Rate;
  hallucinatedComponents: Rate;
  actionAccuracy: Rate;
  /** Share of references the model got right in its first answer. */
  referenceIntegrityFirstPass: Rate;
  /** Built apps that carried a spec to measure. */
  measured: number;
}

/** A stored report is a file on disk, so a spec in it is checked before it is walked. */
const isSpec = (v: unknown): v is KalamSpec => {
  const s = v as Partial<KalamSpec> | undefined;
  return !!s && Array.isArray(s.screens) && !!s.collections && typeof s.collections === 'object' && !!s.actions && typeof s.actions === 'object';
};

/** The structure metrics over the built apps of a dataset. Needs the stored spec (scoring detail). */
export function summarizeStructure(cases: readonly CaseResult[]): StructureTotals {
  const rows = cases
    .filter((c) => c.build.stage !== 'skipped' && c.build.ok && isSpec(c.detail?.spec))
    .map((c) => measureStructure(c.detail!.spec!, requestOf(c), c.detail!.expected, c.build.attempts?.[0]?.issues ?? []));
  const sum = (f: (r: SpecStructure) => number) => rows.reduce((a, r) => a + f(r), 0);
  const components = sum((r) => r.components.total);
  const refs = sum((r) => r.references.total);
  return {
    componentPrecision: rate(sum((r) => r.components.appropriate), components),
    hallucinatedComponents: rate(sum((r) => r.components.hallucinated.length), components),
    actionAccuracy: rate(sum((r) => r.actions.correct), sum((r) => r.actions.total)),
    referenceIntegrityFirstPass: rate(Math.max(0, refs - sum((r) => r.references.danglingFirstPass)), refs),
    measured: rows.length,
  };
}
