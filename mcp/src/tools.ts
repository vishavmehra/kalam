/**
 * Tool handlers. Each one is a plain function over validated input, so tests call them directly and
 * through an MCP client. Everything here is deterministic: no model call, no network, no file access.
 * Specs are data: they are validated with src/core/spec and never executed.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { exportAppJson, exportFileName } from '@/core/backup/exports';
import { stripImportedClaims } from '@/core/backup/sanitize';
import { classifyRequest } from '@/core/classifier';
import type { FormulaScope, KalamRecord, NormalizedInput, SpecIssue, TemplateId } from '@/core/contracts';
import { compileFormula, evaluateFormula, formulaDependencies, validateFormula } from '@/core/formula';
import { DEFAULT_IMPORT_BASE, encodeImportLink } from '@/core/import-link';
import { describeSpec, kalamSpecSchema, LIMITS, type KalamSpec } from '@/core/spec';
import { MAX_SPEC_BYTES, validateSpec } from '@/core/spec/validate';
import { instantiateTemplate, listTemplates, matchTemplates } from '@/core/templates';
import { hintFor, specCatalogue, specJsonSchema } from './catalogue';
import { NOT_IN_BUILD, optional, runReport } from './optional';

// ─── Results ─────────────────────────────────────────────────────────────────
export function ok(data: Record<string, unknown>, text?: string): CallToolResult {
  return { content: [{ type: 'text', text: text ?? JSON.stringify(data, null, 2) }], structuredContent: data };
}
export function fail(message: string, data: Record<string, unknown> = {}): CallToolResult {
  return {
    content: [{ type: 'text', text: Object.keys(data).length ? `${message}\n${JSON.stringify(data, null, 2)}` : message }],
    structuredContent: { ok: false, message, ...data },
    isError: true,
  };
}
export const isResult = (v: object): v is CallToolResult => 'content' in v;

export const withHints = (issues: readonly SpecIssue[]) =>
  issues.map(({ code, path, message, severity }) => ({ code, path, message, severity, hint: hintFor(code) }));

export function needValid(input: unknown): { spec: KalamSpec; warnings: SpecIssue[] } | CallToolResult {
  const r = validateSpec(input);
  if (r.ok && r.spec) return { spec: r.spec, warnings: r.warnings };
  return fail('This spec is not valid yet. Fix the errors (kalam_validate_spec shows them), then try again.', {
    errors: withHints(r.errors),
  });
}

/** Structure only (the formula checks need scope, not a fully valid app). */
function needStructure(input: unknown): KalamSpec | CallToolResult {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > MAX_SPEC_BYTES) return fail('The spec is larger than 100 KB.');
    try { raw = JSON.parse(raw); } catch { return fail('The spec is not valid JSON.'); }
  }
  const parsed = kalamSpecSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return fail('The spec does not match the schema yet, so formula names cannot be checked against it.', {
    errors: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

// ─── Inputs ──────────────────────────────────────────────────────────────────
export const specInput = z
  .union([z.record(z.string(), z.unknown()), z.string().max(MAX_SPEC_BYTES * 2)])
  .describe('A KalamSpec as a JSON object, or the same object as JSON text. At most 100 KB.');
const TEMPLATE_IDS = listTemplates().map((t) => t.id) as [TemplateId, ...TemplateId[]];
const appIdInput = z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/, 'Lowercase letters, digits, _ and -, 3 to 64 characters.');
const langInput = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'A language code such as en or hi.');
const requestInput = z.string().min(1).max(4000);
const idInput = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, 'An id: lowercase letters, digits and underscores.');
const recordValue = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()]);
const valueMap = z.record(z.string().max(48), recordValue);
const formulaInput = z.string().min(1).max(LIMITS.formulaLength);

export const shapes = {
  schema: { section: z.enum(['all', 'catalogue', 'json_schema']).default('all') },
  validate: { spec: specInput },
  listTemplates: { request: z.string().max(4000).optional().describe('Optional: rank templates for this request.') },
  buildTemplate: {
    templateId: z.enum(TEMPLATE_IDS),
    request: z.string().max(4000).optional().describe('The person\'s words. Names, currency and list items are read from it.'),
    params: z.record(z.string(), z.unknown()).optional().describe("Overrides, checked against the template's own parameter schema."),
    appId: appIdInput.optional(),
    lang: langInput.optional(),
  },
  classify: { request: requestInput, existingSpec: specInput.optional().describe('Pass the current app to classify an edit.') },
  explain: { spec: specInput },
  diff: { before: specInput, after: specInput },
  formula: {
    formula: formulaInput,
    spec: specInput.optional().describe('The app, so names are checked against its collections, fields and counters.'),
    screenId: idInput.optional().describe('The screen the formula is on (its form fields are in scope).'),
    listCollection: idInput.optional().describe('Set for a list filter: bare names are fields of this collection.'),
    sample: z
      .object({
        collections: z.record(z.string().max(48), z.array(valueMap).max(2000)).optional(),
        form: valueMap.optional(),
        state: valueMap.optional(),
        record: valueMap.optional(),
        now: z.string().max(40).optional().describe('ISO date and time used for today and now.'),
      })
      .strict()
      .optional()
      .describe('Example data to calculate the formula on. Use made-up values, not real personal data.'),
  },
  explainFormula: { formula: formulaInput, spec: specInput, screenId: idInput.optional(), listCollection: idInput.optional() },
  report: {
    spec: specInput,
    collection: idInput,
    records: z
      .array(z.object({ values: valueMap, createdAt: z.number().int().nonnegative().optional() }).strict())
      .max(5000)
      .describe('Records of that collection. Each has values (field id to value) and optionally createdAt in epoch ms.'),
    report: z.record(z.string(), z.unknown()).optional().describe('A report definition. Leave out to get the suggested reports.'),
    now: z.string().max(40).optional(),
  },
  packageApp: { spec: specInput },
};
type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

// ─── Handlers ────────────────────────────────────────────────────────────────
export function specSchemaTool({ section = 'all' }: Partial<Args<typeof shapes.schema>>): CallToolResult {
  const data: Record<string, unknown> = {};
  if (section !== 'json_schema') data.catalogue = specCatalogue();
  if (section !== 'catalogue') data.jsonSchema = specJsonSchema();
  return ok(data);
}

export function validateSpecTool({ spec }: Args<typeof shapes.validate>): CallToolResult {
  const r = validateSpec(spec);
  const next = r.ok
    ? 'Valid. Show the person kalam_explain_spec, then use kalam_package_app.'
    : `Not valid: fix the ${r.errors.length} error(s) using each hint, then validate again.`;
  return ok({ ok: r.ok, errors: withHints(r.errors), warnings: withHints(r.warnings), next });
}

export function listTemplatesTool({ request }: Args<typeof shapes.listTemplates>): CallToolResult {
  const scores = new Map(request ? matchTemplates(request).map((m) => [m.templateId, m]) : []);
  const templates = listTemplates()
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      examples: t.examples.slice(0, 5),
      defaults: t.defaults,
      params: z.toJSONSchema(t.paramsSchema as z.ZodType, { io: 'input', unrepresentable: 'any' }),
      score: scores.get(t.id)?.score,
      matchedKeywords: scores.get(t.id)?.matchedKeywords,
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return ok({ templates });
}

export const newAppId = (): string => `app_${randomUUID().slice(0, 8)}`;

export function buildFromTemplateTool(args: Args<typeof shapes.buildTemplate>): CallToolResult {
  const opts = { appId: args.appId ?? newAppId(), now: Date.now(), lang: args.lang ?? 'en' };
  const built = instantiateTemplate(args.templateId, args.request ?? '', opts, args.params ?? {});
  if (!built.ok) return fail(`The template could not be built: ${built.error}`);
  const checked = validateSpec(built.value.spec);
  if (!checked.ok || !checked.spec) return fail('The template produced an invalid app. This is a Kalam bug.', { errors: withHints(checked.errors) });
  return ok({
    spec: checked.spec,
    params: built.value.params,
    warnings: withHints(checked.warnings),
    source: 'template',
    next: 'Adjust the spec if needed, validate it, then use kalam_package_app.',
  });
}

export function classifyRequestTool({ request, existingSpec }: Args<typeof shapes.classify>): CallToolResult {
  const input: NormalizedInput = { text: request, modalities: ['text'], images: [] };
  if (existingSpec !== undefined) {
    const v = needValid(existingSpec);
    if (isResult(v)) return v;
    input.existingSpec = v.spec;
  }
  const classification = classifyRequest(input);
  const templates = existingSpec === undefined ? matchTemplates(request).slice(0, 3) : [];
  const useTemplate = !input.existingSpec && classification.matchingTemplate && classification.complexity === 'simple';
  const next = useTemplate
    ? `Call kalam_build_from_template with templateId "${classification.matchingTemplate}" and the request.`
    : input.existingSpec
      ? 'Change the spec yourself, then validate it and compare it with kalam_diff_specs.'
      : 'No template fits well. Write a spec yourself using kalam_spec_schema, then validate it in a loop.';
  return ok({ classification, templates, next, method: 'deterministic', modelCalls: 0 });
}

function summaryText(spec: KalamSpec): { summary: ReturnType<typeof describeSpec>; text: string } {
  const s = describeSpec(spec);
  const lines = [`${s.appName}: ${s.purpose}`];
  if (s.screens.length) lines.push('', 'Screens:', ...s.screens.map((x) => `- ${x.title}: ${x.items.join(', ') || 'empty'}`));
  if (s.collections.length) {
    lines.push('', 'Saved lists:', ...s.collections.map((c) =>
      `- ${c.name}: ${c.fields.map((f) => `${f.label} (${f.type}${f.required ? ', required' : ''})`).join(', ')}`));
  }
  if (s.actions.length) lines.push('', 'Buttons do:', ...s.actions.map((a) => `- ${a}`));
  if (s.aiFeatures.length) lines.push('', 'AI features:', ...s.aiFeatures.map((a) => `- ${a.description} (${a.verified})`));
  if (s.assumptions.length) lines.push('', 'Assumptions:', ...s.assumptions.map((a) => `- ${a}`));
  return { summary: s, text: lines.join('\n') };
}

export function explainSpecTool({ spec }: Args<typeof shapes.explain>): CallToolResult {
  const v = needValid(spec);
  if (isResult(v)) return v;
  const { summary, text } = summaryText(v.spec);
  return ok({ summary, text }, text);
}

/** Plain JSON only: whatever a sibling module returns, the result is data and has a size cap. */
function plain(value: unknown, maxChars = 200_000): unknown {
  const text = JSON.stringify(value);
  if (text === undefined) return null;
  if (text.length > maxChars) throw new Error('result too large');
  return JSON.parse(text);
}

export function diffSpecsTool({ before, after }: Args<typeof shapes.diff>): CallToolResult {
  const a = needValid(before);
  if (isResult(a)) return a;
  const b = needValid(after);
  if (isResult(b)) return b;
  if (!optional.describeSpecChanges) return fail(NOT_IN_BUILD('Comparing two versions'));
  try {
    const changes = optional.describeSpecChanges(a.spec, b.spec);
    const summary = optional.summarizeChanges?.(changes);
    return ok({ changes: plain(changes), summary: typeof summary === 'string' ? summary : undefined });
  } catch {
    return fail('Kalam could not compare these two versions.');
  }
}

function scopeFor(spec: KalamSpec, screenId?: string, listCollection?: string): FormulaScope | string {
  const collections = Object.fromEntries(Object.entries(spec.collections).map(([id, c]) => [id, Object.keys(c.fields)]));
  const stateKeys = spec.screens.flatMap((s) => s.children.filter((c) => c.type === 'counter').map((c) => c.id));
  const screens = screenId ? spec.screens.filter((s) => s.id === screenId) : spec.screens;
  if (!screens.length) return `Screen "${screenId}" does not exist.`;
  const formFields = new Set<string>();
  for (const s of screens) {
    if (s.form && Object.hasOwn(spec.collections, s.form)) Object.keys(spec.collections[s.form].fields).forEach((f) => formFields.add(f));
    for (const c of s.children) if ('field' in c && c.field) formFields.add(c.field);
  }
  const scope: FormulaScope = { collections, formFields: [...formFields], stateKeys };
  if (listCollection === undefined) return scope;
  if (!Object.hasOwn(spec.collections, listCollection)) return `Collection "${listCollection}" does not exist.`;
  return { ...scope, recordFields: Object.keys(spec.collections[listCollection].fields) };
}

type FormulaCheck = { valid: boolean; errors: string[]; dependencies?: ReturnType<typeof formulaDependencies>; note?: string };

function checkFormula(formula: string, spec?: KalamSpec, screenId?: string, listCollection?: string): FormulaCheck | CallToolResult {
  const compiled = compileFormula(formula);
  if (!compiled.ok) return { valid: false, errors: compiled.errors };
  const dependencies = formulaDependencies(formula);
  if (!spec) return { valid: true, errors: [], dependencies, note: 'Only the syntax was checked. Pass the spec to check names too.' };
  const scope = scopeFor(spec, screenId, listCollection);
  if (typeof scope === 'string') return fail(scope);
  const errors = validateFormula(formula, scope);
  return {
    valid: errors.length === 0, errors, dependencies,
    note: screenId ? undefined : 'No screenId given: form fields from every screen were allowed.',
  };
}

export function checkFormulaTool(args: Args<typeof shapes.formula>): CallToolResult {
  let spec: KalamSpec | undefined;
  if (args.spec !== undefined) {
    const s = needStructure(args.spec);
    if (isResult(s)) return s;
    spec = s;
  }
  const check = checkFormula(args.formula, spec, args.screenId, args.listCollection);
  if (isResult(check)) return check;
  if (!check.valid || !args.sample) return ok({ ...check });
  const now = args.sample.now ? new Date(args.sample.now) : new Date();
  if (Number.isNaN(now.getTime())) return fail('sample.now is not a date and time.');
  const result = evaluateFormula(args.formula, {
    collections: args.sample.collections ?? {}, form: args.sample.form ?? {}, state: args.sample.state ?? {},
    record: args.sample.record, now,
  });
  return ok({ ...check, result: result.ok ? { value: result.value } : { error: result.error } });
}

export function explainFormulaTool(args: Args<typeof shapes.explainFormula>): CallToolResult {
  const v = needStructure(args.spec);
  if (isResult(v)) return v;
  const check = checkFormula(args.formula, v, args.screenId, args.listCollection);
  if (isResult(check)) return check;
  if (!optional.explainFormula) return ok({ ...check, explanation: null, note: NOT_IN_BUILD('Formula explanations') });
  try {
    const explanation = optional.explainFormula(args.formula, v);
    return ok({ ...check, explanation: plain(explanation, 5_000) });
  } catch {
    return ok({ ...check, explanation: null, note: 'Kalam could not explain this formula.' });
  }
}

export function computeReportTool(args: Args<typeof shapes.report>): CallToolResult {
  const v = needValid(args.spec);
  if (isResult(v)) return v;
  const collection = Object.hasOwn(v.spec.collections, args.collection) ? v.spec.collections[args.collection] : undefined;
  if (!collection) return fail(`Collection "${args.collection}" does not exist in this app.`);
  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) return fail('now is not a date and time.');
  const fields = new Set(Object.keys(collection.fields));
  // Only fields the collection defines; anything else in the input is dropped.
  const records: KalamRecord[] = args.records.map((r, i) => ({
    id: `r${i + 1}`, appId: v.spec.id, collectionId: args.collection,
    createdAt: r.createdAt ?? now.getTime(), updatedAt: r.createdAt ?? now.getTime(),
    values: Object.fromEntries(Object.entries(r.values).filter(([k]) => fields.has(k))),
  }));
  if (!optional.computeReport) return fail(NOT_IN_BUILD('Reports'));
  try {
    return ok({ report: plain(runReport({ spec: v.spec, collectionId: args.collection, records, definition: args.report, now })) });
  } catch {
    return fail('Kalam could not compute this report. Check the report definition against the suggested ones.');
  }
}

export interface PackageOptions { webBase?: string; now?: () => number }

/** The importable file for a validated spec. Claims of on-device verification are reset first. */
export function appFile(spec: KalamSpec, now: number): { spec: KalamSpec; file: string } {
  const clean = stripImportedClaims(spec);
  const backup = exportAppJson({ id: clean.id, spec: clean, createdAt: now, updatedAt: now, origin: { route: 'import' } }, { now });
  return { spec: clean, file: JSON.stringify(backup, null, 2) };
}

/**
 * The same file "Export design" makes in the app (a one-app kalam-backup, no records), plus an
 * "Open in Kalam" link. Claims of on-device verification are reset: only Kalam can verify AI blocks.
 */
export function packageAppTool({ spec }: Args<typeof shapes.packageApp>, opts: PackageOptions = {}): CallToolResult {
  const v = needValid(spec);
  if (isResult(v)) return v;
  const { spec: clean, file } = appFile(v.spec, (opts.now ?? Date.now)());
  const link = encodeImportLink(clean, DEFAULT_IMPORT_BASE);
  const web = opts.webBase ? encodeImportLink(clean, `${opts.webBase}/import`) : undefined;
  if (!link.ok) return fail('Kalam could not make a link for this app.', { errors: withHints(link.errors) });
  return ok({
    fileName: exportFileName(clean.name, '', 'kalam.json'),
    file,
    fileBytes: file.length,
    openInKalam: link.url,
    webLink: web?.ok ? web.url : undefined,
    linkChars: link.linkChars,
    warnings: withHints(v.warnings),
    howToOpen: [
      'Save the file and open Kalam: Settings, Storage, Import. Kalam checks it and asks before saving.',
      'Or open the link on a phone or computer with Kalam. The app travels inside the link after the # sign, which is never sent to a server.',
      ...(link.linkChars > 8_000 ? ['This link is long. Some chat apps cut long links, so send the file instead.'] : []),
    ],
  });
}

// ─── Registration ────────────────────────────────────────────────────────────
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export function registerCoreTools(server: McpServer, opts: PackageOptions = {}): void {
  server.registerTool('kalam_spec_schema', {
    title: 'KalamSpec schema',
    description: 'The KalamSpec v1 format: JSON Schema, limits, and a catalogue of components, actions, fields, AI blocks, themes, icons and formula functions. Read it before writing a spec.',
    inputSchema: shapes.schema, annotations: READ_ONLY,
  }, (a) => specSchemaTool(a));
  server.registerTool('kalam_validate_spec', {
    title: 'Validate a spec',
    description: 'Checks a KalamSpec exactly as the Kalam app does. Returns errors and warnings with their path and a repair hint. Call it after every change until ok is true.',
    inputSchema: shapes.validate, annotations: READ_ONLY,
  }, (a) => validateSpecTool(a));
  server.registerTool('kalam_list_templates', {
    title: 'List templates',
    description: 'The ready-made Kalam app templates with their parameters. Pass the request to rank them.',
    inputSchema: shapes.listTemplates, annotations: READ_ONLY,
  }, (a) => listTemplatesTool(a));
  server.registerTool('kalam_build_from_template', {
    title: 'Build from a template',
    description: 'Builds a complete, valid spec from a template without any AI. Use it when kalam_classify_request names a template.',
    inputSchema: shapes.buildTemplate, annotations: READ_ONLY,
  }, (a) => buildFromTemplateTool(a));
  server.registerTool('kalam_classify_request', {
    title: 'Classify a request',
    description: "Says how complex an app request is and whether a template fits, using Kalam's rule-based classifier. No model is called.",
    inputSchema: shapes.classify, annotations: READ_ONLY,
  }, (a) => classifyRequestTool(a));
  server.registerTool('kalam_explain_spec', {
    title: 'Explain a spec',
    description: 'A plain-English summary of what an app does: screens, saved lists, buttons and AI features. Show it to the person before packaging.',
    inputSchema: shapes.explain, annotations: READ_ONLY,
  }, (a) => explainSpecTool(a));
  server.registerTool('kalam_diff_specs', {
    title: 'Compare two versions',
    description: 'Lists in plain English what changed between two versions of an app.',
    inputSchema: shapes.diff, annotations: READ_ONLY,
  }, (a) => diffSpecsTool(a));
  server.registerTool('kalam_check_formula', {
    title: 'Check a formula',
    description: 'Checks a Kalam formula (for stat components and list filters) and, given sample data, calculates it. Formulas are parsed and evaluated by a fixed set of functions, never run as code.',
    inputSchema: shapes.formula, annotations: READ_ONLY,
  }, (a) => checkFormulaTool(a));
  server.registerTool('kalam_explain_formula', {
    title: 'Explain a formula',
    description: 'Checks a formula against an app and explains it in plain English using the field names people see.',
    inputSchema: shapes.explainFormula, annotations: READ_ONLY,
  }, (a) => explainFormulaTool(a));
  server.registerTool('kalam_compute_report', {
    title: 'Compute a report',
    description: 'Computes report numbers (counts, totals, groups, trends) for one collection over records passed in the call. Use made-up or shared records only; nothing is stored.',
    inputSchema: shapes.report, annotations: READ_ONLY,
  }, (a) => computeReportTool(a));
  server.registerTool('kalam_package_app', {
    title: 'Package an app',
    description: 'Makes the importable app file (the same format as "Export design" in Kalam) and an "Open in Kalam" link for a valid spec.',
    inputSchema: shapes.packageApp, annotations: READ_ONLY,
  }, (a) => packageAppTool(a, opts));
}
