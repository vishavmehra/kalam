/**
 * Semantic checks for KalamSpec 1.1 constructs (docs/05 §13.3-13.4). Runs after the Zod layer in
 * validate.ts, on a structurally valid spec. Reports through the caller's issue collector.
 */
import { chartComponentSchema as r1ChartSchema } from '../reports/chart-component';
import { chartToReport, reportDefinitionSchema } from '../reports/definition';
import { schemaErrors, validateReport } from '../reports/engine';
import { V11_MESSAGES as M } from './copy';
import {
  INPUT_COMPONENT_TYPES, LIMITS, type ComponentOf, type KalamCollection, type KalamLayoutNode, type KalamScreen, type KalamSpec,
} from './schema';
import { importanceOf, isMachineField, relationOf, requiredPermissions } from './v11';


const INPUT_TYPES: ReadonlySet<string> = new Set(INPUT_COMPONENT_TYPES);

type Path = ReadonlyArray<PropertyKey>;
export interface V11Reporter {
  error(code: string, path: Path, message: string): void;
  warn(code: string, path: Path, message: string): void;
}

const own = (o: object, k: string | undefined): boolean => k !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const fieldOf = (col: KalamCollection | undefined, id: string | undefined) =>
  col && own(col.fields, id) ? col.fields[id as string] : undefined;
const collectionOf = (spec: KalamSpec, id: string | undefined) => (own(spec.collections, id) ? spec.collections[id as string] : undefined);

function checkRelations(spec: KalamSpec, r: V11Reporter): void {
  for (const [cid, col] of Object.entries(spec.collections)) {
    for (const [fid, f] of Object.entries(col.fields)) {
      if (f.type !== 'text' || !f.ref) continue;
      const base = ['collections', cid, 'fields', fid, 'ref'];
      const target = collectionOf(spec, f.ref.collection);
      if (!target) {
        r.error('UNKNOWN_COLLECTION', [...base, 'collection'], M.refUnknownCollection(f.ref.collection));
        continue;
      }
      // Clearing a required link would leave an entry that can no longer be saved.
      if (f.required && f.ref.onDelete === 'clear') r.error('INVALID_RELATION', [...base, 'onDelete'], M.refClearRequired(fid));
      // A link holds a record id: a length cap would refuse every pick, a default names no real entry.
      const fieldPath = ['collections', cid, 'fields', fid];
      if (f.maxLength !== undefined) r.error('INVALID_RELATION', [...fieldPath, 'maxLength'], M.refProperty(fid, 'a length limit'));
      if (f.defaultValue !== undefined) r.error('INVALID_RELATION', [...fieldPath, 'defaultValue'], M.refProperty(fid, 'a default value'));
      if (f.multiline !== undefined) r.error('INVALID_RELATION', [...fieldPath, 'multiline'], M.refProperty(fid, 'several lines'));
      if (f.placeholder !== undefined) r.warn('IGNORED_PROPERTY', [...fieldPath, 'placeholder'], M.refPlaceholder(fid));
      if (f.ref.display === undefined) continue;
      const shown = fieldOf(target, f.ref.display);
      if (!shown) r.error('UNKNOWN_FIELD', [...base, 'display'], M.refUnknownDisplay(f.ref.collection, f.ref.display));
      else if (shown.type === 'boolean' || (shown.type === 'text' && shown.ref)) {
        r.error('FIELD_TYPE_MISMATCH', [...base, 'display'], M.refDisplayType(f.ref.display));
      }
    }
  }
}

function checkChart(spec: KalamSpec, c: ComponentOf<'chart'>, path: Path, r: V11Reporter): void {
  // R1's schema carries the cross-field rules; `style` is ours, so it is left out of that check.
  const { style: _style, importance: _importance, ...plain } = c;
  const shape = r1ChartSchema.safeParse(plain);
  if (!shape.success) {
    for (const i of shape.error.issues) r.error('INVALID_CHART', [...path, ...i.path], i.message);
    return;
  }
  const parsed = reportDefinitionSchema.safeParse(chartToReport(shape.data));
  const problems = parsed.success ? validateReport(spec, parsed.data) : schemaErrors(parsed.error.issues);
  for (const msg of problems) r.error('INVALID_CHART', path, msg);
}

/**
 * Simple mode levels (docs/10 §4.3): "essential functionality must never disappear" there. A level that folds a
 * needed answer away is flagged as a warning, so a stored app still opens; the compiler treats it as an error. A helper button
 * ("Suggest a category") may be secondary; a screen whose every saving button is secondary may not.
 */
function checkImportance(spec: KalamSpec, screen: KalamScreen, c: KalamScreen['children'][number], path: Path, r: V11Reporter): void {
  if (c.importance && c.importance !== 'secondary' && c.secondary === true) {
    r.warn('IMPORTANCE_CONFLICT', [...path, 'importance'], M.importanceConflict(c.id, c.importance));
  }
  if (importanceOf(c) !== 'secondary') return;
  const field = (c as { field?: string }).field;
  const form = collectionOf(spec, screen.form);
  const def = form && field ? fieldOf(form, field) : undefined;
  if (INPUT_TYPES.has(c.type) && def && 'required' in def && def.required) {
    r.warn('SIMPLE_MODE_HIDES_ESSENTIAL', path, M.foldedRequired(c.id));
  }
}

function checkSavingButtons(spec: KalamSpec, screen: KalamScreen, si: number, r: V11Reporter): void {
  const saves = screen.children.flatMap((c, ci) => {
    if (c.type !== 'bigButton') return [];
    const action = own(spec.actions, c.action) ? spec.actions[c.action] : undefined;
    return action && (action.type === 'insert' || action.type === 'update' || action.type === 'delete') ? [{ c, ci }] : [];
  });
  if (saves.length && saves.every(({ c }) => importanceOf(c) === 'secondary')) {
    r.warn('SIMPLE_MODE_HIDES_ESSENTIAL', ['screens', si, 'children', saves[0].ci], M.foldedSaves(screen.title));
  }
}

function checkComponent(spec: KalamSpec, screen: KalamScreen, c: KalamScreen['children'][number], path: Path, r: V11Reporter): void {
  const form = collectionOf(spec, screen.form);
  checkImportance(spec, screen, c, path, r);
  switch (c.type) {
    case 'chart':
      checkChart(spec, c, path, r);
      break;
    case 'timer': {
      if (c.mode === 'countdown' && c.durationSec === undefined) r.error('MISSING_DURATION', [...path, 'durationSec'], M.timerNeedsDuration);
      if (c.mode === 'stopwatch' && c.durationSec !== undefined) r.warn('IGNORED_PROPERTY', [...path, 'durationSec'], M.timerNoDuration);
      if (c.unit && !c.field) r.warn('IGNORED_PROPERTY', [...path, 'unit'], M.unitNeedsField);
      const def = form && c.field ? fieldOf(form, c.field) : undefined;
      if (form && c.field && !def) r.error('UNKNOWN_FIELD', [...path, 'field'], M.reminderUnknownField(screen.form as string, c.field));
      else if (def && def.type !== 'number') r.error('FIELD_TYPE_MISMATCH', [...path, 'field'], M.timerNeedsNumber(c.field as string));
      break;
    }
    case 'reminder': {
      const src = collectionOf(spec, c.source);
      if (!src) {
        r.error('UNKNOWN_COLLECTION', [...path, 'source'], M.refUnknownCollection(c.source));
        break;
      }
      const need = (key: 'dateField' | 'doneField' | 'titleField', type: string | undefined, wrong: (f: string) => string) => {
        const id = c[key];
        if (id === undefined) return;
        const def = fieldOf(src, id);
        if (!def) r.error('UNKNOWN_FIELD', [...path, key], M.reminderUnknownField(c.source, id));
        else if (type && def.type !== type) r.error('FIELD_TYPE_MISMATCH', [...path, key], wrong(id));
      };
      need('dateField', 'date', M.reminderNeedsDate);
      need('doneField', 'boolean', M.reminderNeedsYesNo);
      need('titleField', undefined, M.reminderTitleType);
      // The name in a notification is printed as is: a link would show a hidden code, a signature numbers.
      const title = c.titleField ? fieldOf(src, c.titleField) : undefined;
      if (title && ((title.type !== 'text' && title.type !== 'enum') || isMachineField(spec, c.source, c.titleField as string))) {
        r.error('FIELD_TYPE_MISMATCH', [...path, 'titleField'], M.reminderTitleType(c.titleField as string));
      }
      break;
    }
    case 'list': {
      if (c.sort && relationOf(spec, c.source, c.sort.field)) r.warn('SORT_BY_LINK', [...path, 'sort', 'field'], M.sortByLink(c.sort.field));
      break;
    }
    case 'signature': {
      const def = form ? fieldOf(form, c.field) : undefined;
      if (form && !def) r.error('UNKNOWN_FIELD', [...path, 'field'], M.reminderUnknownField(screen.form as string, c.field));
      else if (def && def.type !== 'text') r.error('FIELD_TYPE_MISMATCH', [...path, 'field'], M.signatureNeedsText(c.field));
      else if (def?.type === 'text' && def.ref) r.error('FIELD_TYPE_MISMATCH', [...path, 'field'], M.signatureOnRelation(c.field));
      else if (def?.type === 'text' && def.maxLength !== undefined && def.maxLength < LIMITS.signatureLength) {
        r.error('FIELD_TYPE_MISMATCH', [...path, 'field'], M.signatureTooShort(c.field, LIMITS.signatureLength));
      }
      break;
    }
    default:
      break;
  }
}

/** Model output must never land in a link or a signature (docs/05 §13.4: AI output is untrusted). */
function checkAIOutputs(spec: KalamSpec, r: V11Reporter): void {
  const machineAnywhere = (field: string) =>
    Object.keys(spec.collections).some((cid) => isMachineField(spec, cid, field)) ||
    spec.screens.some((s) => s.children.some((c) => c.type === 'signature' && c.field === field));
  for (const [id, block] of Object.entries(spec.aiBlocks)) {
    if (block.kind === 'extractFromPhoto') {
      block.fields?.forEach((f, i) => {
        if (isMachineField(spec, block.target, f)) r.error('FIELD_TYPE_MISMATCH', ['aiBlocks', id, 'fields', i], M.aiIntoMachineField(f));
      });
    } else if (machineAnywhere(block.outputField)) {
      r.error('FIELD_TYPE_MISMATCH', ['aiBlocks', id, 'outputField'], M.aiIntoMachineField(block.outputField));
    }
  }
}

function checkLayout(screen: KalamScreen, si: number, r: V11Reporter): void {
  if (!screen.layout) return;
  const ids = new Set(screen.children.map((c) => c.id));
  const placed = new Set<string>();
  let nodes = 0;
  let tooDeep = false;
  const walk = (node: KalamLayoutNode, path: PropertyKey[], depth: number) => {
    nodes++;
    if (depth > LIMITS.layoutDepth) {
      tooDeep = true;
      return; // never descend further: a hostile tree stops here
    }
    if (node.columns !== undefined && node.type !== 'grid') r.error('INVALID_LAYOUT', [...path, 'columns'], M.layoutColumns);
    if (node.title !== undefined && node.type !== 'card') r.error('INVALID_LAYOUT', [...path, 'title'], M.layoutTitle);
    node.children.forEach((child, i) => {
      const at = [...path, 'children', i];
      if (typeof child !== 'string') return walk(child, at, depth + 1);
      if (!ids.has(child)) r.error('INVALID_LAYOUT', at, M.layoutUnknown(child));
      else if (placed.has(child)) r.error('INVALID_LAYOUT', at, M.layoutTwice(child));
      placed.add(child);
    });
  };
  screen.layout.forEach((n, i) => walk(n, ['screens', si, 'layout', i], 1));
  if (tooDeep) r.error('INVALID_LAYOUT', ['screens', si, 'layout'], M.layoutTooDeep(LIMITS.layoutDepth));
  if (nodes > LIMITS.layoutNodesPerScreen) r.error('RESOURCE_LIMIT', ['screens', si, 'layout'], M.layoutTooMany(LIMITS.layoutNodesPerScreen));
}

function checkSections(spec: KalamSpec, r: V11Reporter): void {
  if (spec.permissions) {
    const needed = new Set(requiredPermissions(spec));
    const seen = new Set<string>();
    spec.permissions.forEach((p, i) => {
      if (seen.has(p.kind)) r.error('DUPLICATE_ID', ['permissions', i, 'kind'], M.permissionTwice(p.kind));
      seen.add(p.kind);
      if (!needed.has(p.kind)) r.warn('PERMISSION_UNUSED', ['permissions', i], M.permissionUnused(p.kind));
    });
    for (const k of needed) if (!seen.has(k)) r.warn('PERMISSION_MISSING', ['permissions'], M.permissionMissing(k));
  }
  const terms = new Set<string>();
  spec.localization?.terminology?.forEach((t, i) => {
    const path = ['localization', 'terminology', i];
    const key = t.term.toLocaleLowerCase();
    if (terms.has(key)) r.error('DUPLICATE_ID', [...path, 'term'], M.termTwice(t.term));
    terms.add(key);
    const langs = t.translations ? Object.keys(t.translations).length : 0;
    if (t.keep && langs) r.error('INVALID_TERM', path, M.termKeepAndTranslate(t.term));
    else if (!t.keep && !langs) r.error('INVALID_TERM', path, M.termNoRule(t.term));
    if (langs > 12) r.error('RESOURCE_LIMIT', [...path, 'translations'], M.termTooManyLanguages(t.term));
  });
}

/** Every 1.1 rule. Safe on 1.0 documents (they simply have nothing to check). */
export function checkV11(spec: KalamSpec, r: V11Reporter): void {
  checkRelations(spec, r);
  let reminders = 0;
  spec.screens.forEach((screen, si) => {
    screen.children.forEach((c, ci) => {
      if (c.type === 'reminder') reminders++;
      checkComponent(spec, screen, c, ['screens', si, 'children', ci], r);
    });
    checkLayout(screen, si, r);
    checkSavingButtons(spec, screen, si, r);
  });
  if (reminders > LIMITS.reminders) r.error('RESOURCE_LIMIT', ['screens'], M.tooManyReminders(LIMITS.reminders));
  checkAIOutputs(spec, r);
  checkSections(spec, r);
}

/** Collections 1.1 constructs read, for the "nothing uses this" warning. */
export function v11CollectionsUsed(spec: KalamSpec): string[] {
  const out: string[] = [];
  for (const col of Object.values(spec.collections)) {
    for (const f of Object.values(col.fields)) if (f.type === 'text' && f.ref) out.push(f.ref.collection);
  }
  for (const s of spec.screens) {
    for (const c of s.children) if (c.type === 'chart' || c.type === 'reminder') out.push(c.source);
  }
  return out;
}
