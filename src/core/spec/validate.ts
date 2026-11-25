/**
 * KalamSpec validation pipeline (docs/05 §13). Layers, in order:
 * JSON → security scan → schema-version compatibility → resource limits → Zod structure →
 * reserved/unique ids → reference integrity → component semantics → formulas → warnings.
 * Every untrusted spec (compiler output, import, marketplace, restore, edit) goes through here.
 */
import type { FormulaScope, SpecIssue, ValidationResult } from '../contracts';
import { formulaDependencies, validateFormula } from '../formula';
import {
  INPUT_COMPONENT_TYPES, LIMITS, RESERVED_IDS, SCHEMA_VERSION, kalamSpecSchema,
  type KalamComponent, type KalamFieldType, type KalamSpec,
} from './schema';

type Path = ReadonlyArray<PropertyKey>;
/** A spec is at most 100 KB of UTF-8 JSON (docs/11 §11.1, ADR-024). Same cap as a Bazaar listing. */
export const MAX_SPEC_BYTES = 100_000;
const MAX_DEPTH = 24;
/** UTF-16 length is a floor for UTF-8 bytes (one unit is at least one byte), so a long string is too large without encoding it. */
const tooLarge = (text: string): boolean => text.length > MAX_SPEC_BYTES || new TextEncoder().encode(text).length > MAX_SPEC_BYTES;
const LONG_LABEL = 48;
const SECURITY_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/<\s*script/i, '<script'], [/javascript\s*:/i, 'javascript:'], [/data\s*:\s*text\/html/i, 'data:text/html'],
];
const RESERVED: ReadonlySet<string> = new Set(RESERVED_IDS);
const INPUT_TYPES: ReadonlySet<string> = new Set(INPUT_COMPONENT_TYPES);
/** Field type each input component must bind to (docs/05 §13.4). */
const INPUT_FIELD_TYPE: Record<string, KalamFieldType> = {
  number: 'number', textInput: 'text', date: 'date', choice: 'enum', toggle: 'boolean',
};

/** `['screens', 0, 'children', 2, 'action']` → `screens[0].children[2].action`. */
export function formatPath(path: Path): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}

class Issues {
  readonly errors: SpecIssue[] = [];
  readonly warnings: SpecIssue[] = [];
  error(code: string, path: Path | string, message: string, recoverable = true): void {
    this.errors.push({ code, path: typeof path === 'string' ? path : formatPath(path), message, severity: 'error', recoverable });
  }
  warn(code: string, path: Path | string, message: string): void {
    this.warnings.push({ code, path: typeof path === 'string' ? path : formatPath(path), message, severity: 'warning', recoverable: true });
  }
  result(spec?: KalamSpec): ValidationResult {
    const ok = this.errors.length === 0;
    return { ok, spec: ok ? spec : undefined, errors: this.errors, warnings: this.warnings };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Own-property lookup: ids like "constructor" must never resolve to Object.prototype members. */
const get = <T>(rec: Readonly<Record<string, T>>, key: string | undefined): T | undefined =>
  key !== undefined && Object.hasOwn(rec, key) ? rec[key] : undefined;

// ─── Pre-schema layers (operate on untrusted unknown) ─────────────────────────
function scanSecurity(value: unknown, path: PropertyKey[], issues: Issues, depth = 0): void {
  if (depth > MAX_DEPTH) {
    issues.error('SPEC_TOO_DEEP', path, 'The app description is nested too deeply.', false);
    return;
  }
  const check = (s: string, at: PropertyKey[]) => {
    for (const [re, label] of SECURITY_PATTERNS) {
      if (re.test(s)) issues.error('SECURITY_CONTENT', at, `Contains blocked content "${label}".`, false);
    }
  };
  if (typeof value === 'string') { check(value, path); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => scanSecurity(v, [...path, i], issues, depth + 1)); return; }
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      check(key, [...path, key]);
      scanSecurity(value[key], [...path, key], issues, depth + 1);
    }
  }
}

function checkSchemaVersion(raw: Record<string, unknown>, issues: Issues): 'stop' | 'continue' {
  const v = raw.schemaVersion;
  if (typeof v !== 'string') return 'continue'; // Zod reports the missing/invalid field
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return 'continue';
  const [major, minor] = [Number(m[1]), Number(m[2])];
  const [curMajor, curMinor] = SCHEMA_VERSION.split('.').map(Number) as [number, number];
  // A newer major or minor is rejected, never loaded with fields ignored (ADR-024). Patches only
  // clarify the format, so they always pass. Older minors are migrated before they get here.
  if (major > curMajor || (major === curMajor && minor > curMinor)) {
    issues.error(
      'UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion',
      `This app needs a newer version of Kalam (format ${v}). Update Kalam to open it.`,
      false,
    );
    return 'stop';
  }
  if (major < curMajor) {
    issues.error('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion', `This app uses an old format (${v}) that must be migrated first.`, false);
    return 'stop';
  }
  return 'continue';
}

function checkLimits(raw: Record<string, unknown>, issues: Issues): void {
  const limit = (path: Path, count: number, max: number, what: string) => {
    if (count > max) issues.error('RESOURCE_LIMIT', path, `Too many ${what}: ${count} (maximum ${max}).`);
  };
  const keys = (v: unknown) => (isObject(v) ? Object.keys(v).length : 0);
  if (Array.isArray(raw.screens)) {
    limit(['screens'], raw.screens.length, LIMITS.screens, 'screens');
    raw.screens.forEach((s, i) => {
      if (isObject(s) && Array.isArray(s.children)) {
        limit(['screens', i, 'children'], s.children.length, LIMITS.componentsPerScreen, 'components on this screen');
      }
    });
  }
  limit(['collections'], keys(raw.collections), LIMITS.collections, 'collections');
  if (isObject(raw.collections)) {
    for (const [id, c] of Object.entries(raw.collections)) {
      if (isObject(c)) limit(['collections', id, 'fields'], keys(c.fields), LIMITS.fieldsPerCollection, 'fields');
    }
  }
  limit(['aiBlocks'], keys(raw.aiBlocks), LIMITS.aiBlocks, 'AI blocks');
  limit(['actions'], keys(raw.actions), LIMITS.actions, 'actions');
}

interface ZodIssueLike { code: string; path: Path; message: string; note?: unknown }

function zodIssueCode(issue: ZodIssueLike): string {
  const p = issue.path;
  if (issue.code === 'invalid_union' && issue.note === 'No matching discriminator') {
    if (p.includes('children')) return 'UNKNOWN_COMPONENT_TYPE';
    if (p[0] === 'actions') return 'UNKNOWN_ACTION_TYPE';
    if (p[0] === 'aiBlocks') return 'UNKNOWN_AI_BLOCK_KIND';
    if (p.includes('fields')) return 'UNKNOWN_FIELD_TYPE';
  }
  if (issue.code === 'unrecognized_keys') return 'UNKNOWN_PROPERTY';
  if (issue.code === 'invalid_key') return 'INVALID_ID';
  return 'SCHEMA_INVALID';
}

// ─── Post-schema semantic layers ──────────────────────────────────────────────
interface Index {
  screens: Map<string, number>;
  /** component id → location */
  components: Map<string, { screen: number; child: number; component: KalamComponent }>;
  /** Field ids bound on each screen (inputs + counter.field + form collection fields). */
  formFields: Map<string, string[]>;
  counterIds: string[];
  allFormFields: Set<string>;
}

function buildIndex(spec: KalamSpec, issues: Issues): Index {
  const screens = new Map<string, number>();
  const components: Index['components'] = new Map();
  const formFields = new Map<string, string[]>();
  const counterIds: string[] = [];
  const allFormFields = new Set<string>();
  spec.screens.forEach((screen, si) => {
    if (screens.has(screen.id)) issues.error('DUPLICATE_ID', ['screens', si, 'id'], `Screen id "${screen.id}" is used twice.`);
    else screens.set(screen.id, si);
    const fields = new Set<string>();
    const formCollection = get(spec.collections, screen.form);
    if (formCollection) Object.keys(formCollection.fields).forEach((f) => fields.add(f));
    screen.children.forEach((c, ci) => {
      if (components.has(c.id)) {
        issues.error('DUPLICATE_ID', ['screens', si, 'children', ci, 'id'], `Component id "${c.id}" is used twice.`);
      } else components.set(c.id, { screen: si, child: ci, component: c });
      if (INPUT_TYPES.has(c.type) || c.type === 'counter') {
        const f = (c as { field?: string }).field;
        if (f) fields.add(f);
      }
      if (c.type === 'counter') counterIds.push(c.id);
    });
    formFields.set(screen.id, [...fields]);
    fields.forEach((f) => allFormFields.add(f));
  });
  return { screens, components, formFields, counterIds, allFormFields };
}

function checkReservedIds(spec: KalamSpec, issues: Issues): void {
  const reserved = (id: string, path: Path, what: string) => {
    if (RESERVED.has(id)) issues.error('RESERVED_ID', path, `"${id}" cannot be used as a ${what} id.`);
  };
  for (const [cid, col] of Object.entries(spec.collections)) {
    reserved(cid, ['collections', cid], 'collection');
    for (const fid of Object.keys(col.fields)) reserved(fid, ['collections', cid, 'fields', fid], 'field');
  }
  spec.screens.forEach((s, si) => {
    reserved(s.id, ['screens', si, 'id'], 'screen');
    s.children.forEach((c, ci) => reserved(c.id, ['screens', si, 'children', ci, 'id'], 'component'));
  });
}

function checkActions(spec: KalamSpec, ix: Index, issues: Issues): void {
  const screenExists = (id: string, path: Path) => {
    if (!ix.screens.has(id)) issues.error('UNKNOWN_SCREEN', path, `Screen "${id}" does not exist.`);
  };
  const collectionExists = (id: string, path: Path) => {
    if (!Object.hasOwn(spec.collections, id)) issues.error('UNKNOWN_COLLECTION', path, `Collection "${id}" does not exist.`);
  };
  const numericFormField = (id: string) =>
    spec.screens.some((s) => {
      if (!ix.formFields.get(s.id)?.includes(id)) return false;
      const fields = get(spec.collections, s.form)?.fields;
      const field = fields ? get(fields, id) : undefined;
      if (field) return field.type === 'number';
      return s.children.some((c) => (c.type === 'number' || c.type === 'counter') && c.field === id);
    });

  for (const [id, action] of Object.entries(spec.actions)) {
    const base = ['actions', id];
    switch (action.type) {
      case 'navigate': screenExists(action.screen, [...base, 'screen']); break;
      case 'insert': case 'update': case 'delete': collectionExists(action.collection, [...base, 'collection']); break;
      case 'increment': case 'decrement': case 'reset': {
        const target = ix.components.get(action.target)?.component;
        if (target?.type !== 'counter' && !numericFormField(action.target)) {
          issues.error('UNKNOWN_TARGET', [...base, 'target'], `"${action.target}" is not a counter or number field.`);
        }
        break;
      }
      case 'runAI':
        if (!Object.hasOwn(spec.aiBlocks, action.aiBlock)) {
          issues.error('UNKNOWN_AI_BLOCK', [...base, 'aiBlock'], `AI block "${action.aiBlock}" does not exist.`);
        }
        break;
      default: break;
    }
    if ('then' in action && action.then?.navigate) screenExists(action.then.navigate, [...base, 'then', 'navigate']);
  }
  for (const id of Object.keys(spec.intents)) {
    if (!Object.hasOwn(spec.actions, id)) issues.error('UNKNOWN_ACTION', ['intents', id], `Voice phrases point to missing action "${id}".`);
  }
}

function checkAIBlocks(spec: KalamSpec, ix: Index, issues: Issues): void {
  const allFields = new Set<string>(ix.allFormFields);
  for (const col of Object.values(spec.collections)) Object.keys(col.fields).forEach((f) => allFields.add(f));
  for (const [id, block] of Object.entries(spec.aiBlocks)) {
    const base = ['aiBlocks', id];
    if (block.kind === 'extractFromPhoto') {
      const target = get(spec.collections, block.target);
      if (!target) {
        issues.error('UNKNOWN_COLLECTION', [...base, 'target'], `Collection "${block.target}" does not exist.`);
      } else {
        block.fields?.forEach((f, i) => {
          if (!Object.hasOwn(target.fields, f)) issues.error('UNKNOWN_FIELD', [...base, 'fields', i], `"${block.target}" has no field "${f}".`);
        });
      }
    } else {
      for (const key of ['inputField', 'outputField'] as const) {
        if (!allFields.has(block[key])) issues.error('UNKNOWN_FIELD', [...base, key], `Field "${block[key]}" is not on any screen or collection.`);
      }
    }
    if (block.verified === 'unverified') {
      issues.warn('UNVERIFIED_AI_BLOCK', [...base, 'verified'], 'This AI feature has not been checked on this device yet.');
    }
  }
}

function checkComponents(spec: KalamSpec, ix: Index, issues: Issues): void {
  const collectionIds = Object.fromEntries(Object.entries(spec.collections).map(([id, c]) => [id, Object.keys(c.fields)]));
  const detailScreens = new Set<string>();
  spec.screens.forEach((s) => s.children.forEach((c) => { if (c.type === 'list' && c.detailScreen) detailScreens.add(c.detailScreen); }));

  spec.screens.forEach((screen, si) => {
    const sp = ['screens', si];
    const form = get(spec.collections, screen.form);
    if (screen.form && !Object.hasOwn(spec.collections, screen.form)) {
      issues.error('UNKNOWN_COLLECTION', [...sp, 'form'], `Collection "${screen.form}" does not exist.`);
    }
    const scope: FormulaScope = {
      collections: collectionIds, formFields: ix.formFields.get(screen.id) ?? [], stateKeys: ix.counterIds,
    };
    screen.children.forEach((c, ci) => {
      const cp = [...sp, 'children', ci];
      if ('label' in c && typeof c.label === 'string' && c.label.length > LONG_LABEL) {
        issues.warn('LONG_LABEL', [...cp, 'label'], 'This label is long; short labels are easier to read.');
      }
      if (INPUT_TYPES.has(c.type) && form) {
        const field = (c as { field: string }).field;
        const def = get(form.fields, field);
        if (!def) {
          issues.error('UNKNOWN_FIELD', [...cp, 'field'], `"${screen.form}" has no field "${field}".`);
        } else if (def.type !== INPUT_FIELD_TYPE[c.type]) {
          issues.error('FIELD_TYPE_MISMATCH', [...cp, 'field'], `A ${c.type} input cannot edit the ${def.type} field "${field}".`);
        } else if (c.type === 'choice' && c.options && def.type === 'enum') {
          const bad = c.options.filter((o) => !def.options.includes(o));
          if (bad.length) issues.error('INVALID_OPTIONS', [...cp, 'options'], `Options not allowed by the field: ${bad.join(', ')}.`);
        }
      }
      switch (c.type) {
        case 'choice':
          if (!form && !c.options) issues.error('MISSING_OPTIONS', cp, 'A choice needs options when the screen has no collection form.');
          break;
        case 'counter':
          if (c.field && form) {
            const def = get(form.fields, c.field);
            if (!def) issues.error('UNKNOWN_FIELD', [...cp, 'field'], `"${screen.form}" has no field "${c.field}".`);
            else if (def.type !== 'number') issues.error('FIELD_TYPE_MISMATCH', [...cp, 'field'], `A counter needs a number field, "${c.field}" is ${def.type}.`);
          }
          break;
        case 'bigButton': {
          const action = get(spec.actions, c.action);
          if (!action) { issues.error('UNKNOWN_ACTION', [...cp, 'action'], `Action "${c.action}" does not exist.`); break; }
          if ((action.type === 'update' || action.type === 'delete') && !detailScreens.has(screen.id)) {
            issues.warn('NO_SELECTED_RECORD', [...cp, 'action'], 'This button changes a selected record, but no list opens this screen.');
          }
          if (action.type === 'insert' && screen.form && screen.form !== action.collection) {
            issues.warn('FORM_MISMATCH', [...cp, 'action'], `This screen's form is "${screen.form}" but the button saves to "${action.collection}".`);
          }
          break;
        }
        case 'list': {
          const fields = get(spec.collections, c.source)?.fields;
          if (!fields) { issues.error('UNKNOWN_COLLECTION', [...cp, 'source'], `Collection "${c.source}" does not exist.`); break; }
          const fieldRef = (f: string | undefined, path: PropertyKey[]) => {
            if (f && !Object.hasOwn(fields, f)) issues.error('UNKNOWN_FIELD', [...cp, ...path], `"${c.source}" has no field "${f}".`);
          };
          fieldRef(c.primary, ['primary']);
          fieldRef(c.secondary, ['secondary']);
          fieldRef(c.sort?.field, ['sort', 'field']);
          fieldRef(c.toggleField, ['toggleField']);
          const toggle = get(fields, c.toggleField);
          if (toggle && toggle.type !== 'boolean') {
            issues.error('FIELD_TYPE_MISMATCH', [...cp, 'toggleField'], `"${c.toggleField}" must be a yes/no field.`);
          }
          if (c.detailScreen && !ix.screens.has(c.detailScreen)) {
            issues.error('UNKNOWN_SCREEN', [...cp, 'detailScreen'], `Screen "${c.detailScreen}" does not exist.`);
          }
          if (c.filter) {
            for (const msg of validateFormula(c.filter, { ...scope, recordFields: Object.keys(fields) })) {
              issues.error('INVALID_FORMULA', [...cp, 'filter'], msg);
            }
          }
          break;
        }
        case 'stat':
          for (const msg of validateFormula(c.expr, scope)) issues.error('INVALID_FORMULA', [...cp, 'expr'], msg);
          break;
        case 'photo':
          if (c.aiBlock) {
            const block = get(spec.aiBlocks, c.aiBlock);
            if (!block) issues.error('UNKNOWN_AI_BLOCK', [...cp, 'aiBlock'], `AI block "${c.aiBlock}" does not exist.`);
            else if (block.kind !== 'extractFromPhoto') {
              issues.error('INCOMPATIBLE_AI_BLOCK', [...cp, 'aiBlock'], `A photo needs a "read from photo" AI block, not "${block.kind}".`);
            }
          }
          break;
        default: break;
      }
    });
  });
}

function checkReachability(spec: KalamSpec, ix: Index, issues: Issues): void {
  if (!ix.screens.has(spec.initialScreen)) {
    issues.error('UNKNOWN_SCREEN', 'initialScreen', `Start screen "${spec.initialScreen}" does not exist.`);
    return;
  }
  const targets = (actionId: string): string[] => {
    const a = get(spec.actions, actionId);
    if (!a) return [];
    const out: string[] = [];
    if (a.type === 'navigate') out.push(a.screen);
    if ('then' in a && a.then?.navigate) out.push(a.then.navigate);
    return out;
  };
  // Voice intents can fire from any screen.
  const global = Object.keys(spec.intents).flatMap(targets);
  const seen = new Set<string>([spec.initialScreen, ...global]);
  const queue = [...seen];
  while (queue.length) {
    const id = queue.shift() as string;
    const screen = spec.screens[ix.screens.get(id) ?? -1];
    if (!screen) continue;
    for (const c of screen.children) {
      const next = c.type === 'bigButton' ? targets(c.action) : c.type === 'list' && c.detailScreen ? [c.detailScreen] : [];
      for (const n of next) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  spec.screens.forEach((s, i) => {
    if (!seen.has(s.id)) issues.warn('UNREACHABLE_SCREEN', ['screens', i], `No button or list leads to "${s.title}".`);
  });
}

function checkUnusedCollections(spec: KalamSpec, issues: Issues): void {
  const used = new Set<string>();
  for (const s of spec.screens) {
    if (s.form) used.add(s.form);
    for (const c of s.children) {
      if (c.type === 'list') used.add(c.source);
      if (c.type === 'stat') formulaDependencies(c.expr).collections.forEach((id) => used.add(id));
    }
  }
  for (const a of Object.values(spec.actions)) if ('collection' in a) used.add(a.collection);
  for (const b of Object.values(spec.aiBlocks)) if (b.kind === 'extractFromPhoto') used.add(b.target);
  for (const id of Object.keys(spec.collections)) {
    if (!used.has(id)) issues.warn('UNUSED_COLLECTION', ['collections', id], `Nothing in the app uses "${get(spec.collections, id)?.label ?? id}".`);
  }
}

/** Validates untrusted input (JSON text or object). Returns the parsed spec only when ok. */
export function validateSpec(input: unknown): ValidationResult {
  const issues = new Issues();
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (tooLarge(input)) {
      issues.error('SPEC_TOO_LARGE', '', 'The app description is too large. An app can be at most 100 KB.', false);
      return issues.result();
    }
    try {
      raw = JSON.parse(input);
    } catch (e) {
      issues.error('INVALID_JSON', '', `Not valid JSON: ${e instanceof Error ? e.message : 'parse error'}.`);
      return issues.result();
    }
  }
  if (!isObject(raw)) {
    issues.error('SCHEMA_INVALID', '', 'An app description must be a JSON object.');
    return issues.result();
  }
  // Objects come from the compiler, edits, restore and the Bazaar, so they get the same size cap as text.
  // A string was measured above, and parsing it cannot make it bigger.
  if (typeof input !== 'string') {
    let text: string | undefined;
    try {
      text = JSON.stringify(raw);
    } catch {
      // A cycle or a BigInt. The depth scan below reports a cycle as too deep.
    }
    if (text !== undefined && tooLarge(text)) {
      issues.error('SPEC_TOO_LARGE', '', 'The app description is too large. An app can be at most 100 KB.', false);
      return issues.result();
    }
  }

  scanSecurity(raw, [], issues);
  if (checkSchemaVersion(raw, issues) === 'stop') return issues.result();
  checkLimits(raw, issues);
  if (issues.errors.some((e) => !e.recoverable)) return issues.result();

  const parsed = kalamSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const limitPaths = new Set(issues.errors.filter((e) => e.code === 'RESOURCE_LIMIT').map((e) => e.path));
    for (const issue of parsed.error.issues as readonly ZodIssueLike[]) {
      const path = formatPath(issue.path);
      if (issue.code === 'too_big' && limitPaths.has(path)) continue; // already reported as RESOURCE_LIMIT
      issues.error(zodIssueCode(issue), path, issue.message);
    }
    return issues.result();
  }
  if (issues.errors.length) return issues.result();

  const spec = parsed.data;
  checkReservedIds(spec, issues);
  const ix = buildIndex(spec, issues);
  checkActions(spec, ix, issues);
  checkAIBlocks(spec, ix, issues);
  checkComponents(spec, ix, issues);
  checkReachability(spec, ix, issues);
  checkUnusedCollections(spec, issues);
  return issues.result(spec);
}
