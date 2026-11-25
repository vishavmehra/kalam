/**
 * Pure checks that compare what Kalam produced with the human-reviewed expectations of a golden case.
 * No I/O and no src imports beyond types, so they run anywhere (Node, Vitest, the /lab screen).
 */
import type { DrawingSummary, TaskClassification } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import type {
  Check,
  ClassificationResult,
  ExtractionResult,
  FieldExpectation,
  GoldenExpected,
  Route,
  SemanticResult,
  StampName,
} from './types';

/**
 * Where the pipeline builds this request. Mirrors `templateIdFor` in src/core/pipeline/create-application.ts:
 * only a simple, single-modality request with a matching template takes the deterministic route.
 */
export function routeOf(c: TaskClassification): Route {
  return c.complexity === 'simple' &&
    !c.requiresCloudReasoning &&
    !c.requiresMultimodalReasoning &&
    !!c.matchingTemplate
    ? 'template'
    : 'cloud';
}

export function toClassificationResult(c: TaskClassification): ClassificationResult {
  return {
    complexity: c.complexity,
    taskType: c.taskType,
    route: routeOf(c),
    ...(c.matchingTemplate ? { template: c.matchingTemplate } : {}),
    confidence: c.confidence,
    multimodal: c.requiresMultimodalReasoning,
    requiresCloud: c.requiresCloudReasoning,
    method: c.method,
  };
}

const eq = (expected: unknown, actual: unknown): Check => ({ ok: expected === actual, expected, actual });

export const LOW_CONFIDENCE_BELOW = 0.5;

/** Classifier labels: complexity, task type, route, template, multimodal flag and low confidence. */
export function checkClassification(
  c: ClassificationResult,
  expected: GoldenExpected,
  dataset: 'text' | 'sketch',
): {
  complexity: Check;
  taskType: Check;
  route: Check;
  template?: Check;
  multimodal: Check;
  lowConfidence?: Check;
} {
  const wantMultimodal = expected.multimodal ?? dataset === 'sketch';
  return {
    complexity: eq(expected.complexity, c.complexity),
    taskType: eq(expected.taskType, c.taskType),
    route: eq(expected.route, c.route),
    ...(expected.template ? { template: eq(expected.template, c.template) } : {}),
    multimodal: eq(wantMultimodal, c.multimodal),
    ...(expected.lowConfidence
      ? {
          lowConfidence: {
            ok: c.confidence < LOW_CONFIDENCE_BELOW,
            expected: `< ${LOW_CONFIDENCE_BELOW}`,
            actual: c.confidence,
          },
        }
      : {}),
  };
}

// ─── Spec semantics ─────────────────────────────────────────────────────────────────────────
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ')
    .trim();

/** Word match with simple plurals: "item" matches "items", "customers" matches "customer". */
function hasWord(haystack: string, keyword: string): boolean {
  const kw = normalize(keyword);
  if (!kw) return false;
  if (kw.includes(' ')) return ` ${haystack} `.includes(` ${kw} `);
  return haystack.split(' ').some((t) => t === kw || t === `${kw}s` || `${t}s` === kw);
}

interface FlatField {
  collection: string;
  id: string;
  label: string;
  type: string;
}

export function flattenFields(spec: KalamSpec): FlatField[] {
  return Object.entries(spec.collections).flatMap(([collection, c]) =>
    Object.entries(c.fields).map(([id, f]) => ({ collection, id, label: f.label, type: f.type })),
  );
}

export function fieldMatches(field: FlatField, want: FieldExpectation): boolean {
  if (want.type && field.type !== want.type) return false;
  const text = `${normalize(field.label)} ${normalize(field.id.replace(/_/g, ' '))}`;
  return want.anyOf.some((k) => hasWord(text, k));
}

/** Screens, collections, required fields, required components and forbidden text for a generated spec. */
export function checkSpec(spec: KalamSpec, expected: GoldenExpected): SemanticResult {
  const screens = spec.screens.length;
  const collections = Object.keys(spec.collections).length;
  const fields = flattenFields(spec);
  const missingFields = expected.requiredFields.filter((want) => !fields.some((f) => fieldMatches(f, want)));
  const present = new Set(spec.screens.flatMap((s) => s.children.map((c) => c.type)));
  const missingComponents = expected.requiredComponents.filter((t) => !present.has(t));
  const json = JSON.stringify(spec).toLowerCase();
  const leaked = (expected.forbiddenText ?? []).filter((t) => json.includes(t.toLowerCase()));
  return {
    screens: { ok: screens >= expected.minScreens, expected: `>= ${expected.minScreens}`, actual: screens },
    collections: {
      ok: collections >= expected.minCollections,
      expected: `>= ${expected.minCollections}`,
      actual: collections,
    },
    fields: {
      found: expected.requiredFields.length - missingFields.length,
      total: expected.requiredFields.length,
      missing: missingFields.map((f) => `${f.anyOf[0] ?? '?'}${f.type ? `:${f.type}` : ''}`),
    },
    components: {
      found: expected.requiredComponents.length - missingComponents.length,
      total: expected.requiredComponents.length,
      missing: missingComponents,
    },
    forbiddenText: { ok: leaked.length === 0, expected: 'none', actual: leaked },
  };
}

/** True when every semantic check passes (used for failure listing, not for the headline numbers). */
export function semanticPassed(s: SemanticResult): boolean {
  return (
    s.screens.ok &&
    s.collections.ok &&
    s.fields.missing.length === 0 &&
    s.components.missing.length === 0 &&
    s.forbiddenText.ok
  );
}

// ─── Sketch extraction (deterministic drawing interpretation, docs/08 §15) ─────────────────
export function checkExtraction(
  summary: DrawingSummary,
  pagesInSketch: number,
  expected: { labels: string[]; stamps: Partial<Record<StampName, number>> },
): ExtractionResult {
  const seen = new Set(summary.texts.map((t) => t.toLowerCase()));
  const missingLabels = expected.labels.filter((l) => !seen.has(l.trim().replace(/\s+/g, ' ').toLowerCase()));

  const counts = new Map<string, number>();
  for (const el of summary.elements) counts.set(el.kind, (counts.get(el.kind) ?? 0) + 1);
  const wanted = Object.entries(expected.stamps);
  const missingStamps = wanted
    .filter(([name, n]) => (counts.get(`stamp:${name}`) ?? 0) !== n)
    .map(([name, n]) => `${name} x${n} (got ${counts.get(`stamp:${name}`) ?? 0})`);

  return {
    pageCount: eq(pagesInSketch, summary.pageCount),
    labels: {
      found: expected.labels.length - missingLabels.length,
      total: expected.labels.length,
      missing: missingLabels,
    },
    stamps: { found: wanted.length - missingStamps.length, total: wanted.length, missing: missingStamps },
  };
}
