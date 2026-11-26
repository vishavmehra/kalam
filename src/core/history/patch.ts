/**
 * describePatch(ops): plain-English lines for the RFC 6902 patch that src/core/versioning stores for a version.
 *
 * A patch alone only has paths and new values, so names that live elsewhere in the spec are not known: removed
 * screens read "Removed screen 2". Pass the spec the patch applies to as `base` and the result is the same
 * precise list describeSpecChanges gives. If the patch does not apply cleanly the path-based lines are used.
 *
 * Path-based lines are approximate where list items shift position (see shiftedArrays): the patch writer matches
 * screens and items by index, so an item that moved can look like an edit. Those cases give one generic line.
 */
import { applyPatch, type Operation } from 'fast-json-patch';
import type { KalamSpec } from '../spec/schema';
import { cloneSpec } from '../versioning';
import { describeSpecChanges } from './describe';
import { clip, COMPONENT_NOUN, humanize, languageLabel, NOTE_COLLECTION_ENTRIES, NOTE_FIELD_VALUES } from './names';
import type { ChangeCategory, ChangeEntry, ChangeImpact, ChangeKind } from './types';

type Draft = Omit<ChangeEntry, 'key'>;
type Val = Record<string, unknown>;

const BOOKKEEPING = new Set(['version', 'id']);
const META_BOOKKEEPING = new Set(['updatedAt', 'createdAt', 'source', 'basedOn', 'templateId', 'generator']);
const THEME_WORDS: Record<string, string> = {
  primary: 'main colour', secondary: 'second colour', background: 'background colour', surface: 'card colour',
  text: 'text colour', preset: 'ready-made look', radius: 'corner roundness', fontScale: 'text size',
  spacing: 'spacing', fontFamily: 'font',
};
const unescapePointer = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');
const asObject = (v: unknown): Val | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Val) : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function make(kind: ChangeKind, category: ChangeCategory, impact: ChangeImpact, ids: string[], line: string, note?: string): Draft {
  return note ? { kind, category, impact, ids, text: line, note } : { kind, category, impact, ids, text: line };
}

function describeOp(op: Operation): Draft | undefined {
  const parts = op.path.split('/').slice(1).map(unescapePointer);
  const [area, k1, k2, k3, k4] = parts;
  const value: unknown = 'value' in op ? op.value : undefined;
  const kind: ChangeKind = op.op === 'add' ? 'added' : op.op === 'remove' ? 'removed' : 'changed';
  const verb = kind === 'added' ? 'Added' : kind === 'removed' ? 'Removed' : 'Changed';
  if (!area || BOOKKEEPING.has(area)) return undefined;

  switch (area) {
    case 'name': return make('renamed', 'text', 'cosmetic', ['name'], `Renamed the app${text(value) ? ` to ${clip(text(value) as string)}` : ''}`);
    case 'description': return make('changed', 'text', 'cosmetic', ['description'], 'Changed the app description');
    case 'lang': return make('changed', 'settings', 'behaviour', ['lang'], `Changed the app language${text(value) ? ` to ${languageLabel(text(value) as string)}` : ''}`);
    case 'schemaVersion': return make('changed', 'settings', 'cosmetic', ['schemaVersion'], 'Updated the app format');
    case 'initialScreen': return make('changed', 'structure', 'behaviour', ['initialScreen'], 'Changed the first screen');
    case 'icon': return make('changed', 'look', 'cosmetic', ['icon'], 'Changed the app icon');
    case 'theme': return make('changed', 'look', 'cosmetic', ['theme', ...(k1 ? [k1] : [])], `Changed the ${THEME_WORDS[k1 ?? ''] ?? 'look'}`);
    case 'meta': {
      if (k1 && META_BOOKKEEPING.has(k1)) return undefined;
      return k1 === 'description'
        ? make('changed', 'text', 'cosmetic', ['description'], 'Changed the short description')
        : make('changed', 'settings', 'cosmetic', ['meta', ...(k1 ? [k1] : [])], 'Changed the app details');
    }
    case 'screens': {
      const n = Number(k1) + 1;
      const label = Number.isFinite(n) ? `screen ${n}` : 'a screen';
      if (parts.length === 2) {
        const title = text(asObject(value)?.title);
        if (kind === 'added') return make('added', 'structure', 'behaviour', [], `Added the ${title ?? 'new'} screen`);
        return make(kind, 'structure', 'behaviour', [], `${verb} ${label}`);
      }
      if (k2 === 'title') return make('renamed', 'text', 'cosmetic', [], `Renamed ${label}${text(value) ? ` to ${clip(text(value) as string)}` : ''}`);
      if (k2 !== 'children') return make('changed', 'structure', 'behaviour', [], `Changed ${label}`);
      if (parts.length === 3) return make('changed', 'structure', 'behaviour', [], `Changed the items on ${label}`);
      if (parts.length === 4) {
        const c = asObject(value);
        const noun = COMPONENT_NOUN[(text(c?.type) ?? '') as keyof typeof COMPONENT_NOUN];
        const name = text(c?.label);
        const ref = name && noun ? (c?.type === 'text' || c?.type === 'heading' ? `“${clip(name)}” ${noun}` : `${name} ${noun}`) : 'item';
        if (kind === 'added') return make('added', 'structure', 'behaviour', [], `Added the ${ref} to ${label}`);
        return make(kind, 'structure', 'behaviour', [], `${verb} an item ${kind === 'removed' ? 'from' : 'on'} ${label}`);
      }
      if (k4 === 'label') return make('renamed', 'text', 'cosmetic', [], `Renamed an item on ${label}${text(value) ? ` to ${clip(text(value) as string)}` : ''}`);
      if (k4 === 'visible') return make('changed', 'structure', 'behaviour', [], `${value === false ? 'Hid' : 'Showed'} an item on ${label}`);
      if (k4 === 'expr' || k4 === 'filter') return make('changed', 'logic', 'behaviour', [], `Changed a calculation on ${label}`);
      return make('changed', 'structure', 'behaviour', [], `Changed an item on ${label}`);
    }
    case 'collections': {
      if (!k1) return make('changed', 'data', 'data', [], 'Changed what this app keeps');
      const place = text(asObject(value)?.label) ?? humanize(k1);
      if (parts.length === 2) {
        if (kind === 'added') return make('added', 'data', 'behaviour', [k1], `Started keeping ${place}`);
        if (kind === 'removed') {
          return make('removed', 'data', 'data', [k1], `Stopped keeping ${humanize(k1)} in the design`, NOTE_COLLECTION_ENTRIES);
        }
        return make('changed', 'data', 'data', [k1], `Changed how ${humanize(k1)} is set up`);
      }
      if (k2 === 'label') return make('renamed', 'text', 'cosmetic', [k1], `Renamed ${humanize(k1)}${text(value) ? ` to ${clip(text(value) as string)}` : ''}`);
      if (k2 !== 'fields' || !k3) return make('changed', 'data', 'behaviour', [k1], `Changed how ${humanize(k1)} is set up`);
      const field = text(asObject(value)?.label) ?? humanize(k3);
      if (parts.length === 4) {
        if (kind === 'added') return make('added', 'data', 'behaviour', [k1, k3], `Added the ${field} field to ${humanize(k1)}`);
        if (kind === 'removed') {
          return make('removed', 'data', 'data', [k1, k3], `Removed the ${humanize(k3)} field from ${humanize(k1)}`, NOTE_FIELD_VALUES);
        }
        return make('changed', 'data', 'data', [k1, k3], `Changed the ${field} field in ${humanize(k1)}`);
      }
      if (k4 === 'type') return make('changed', 'data', 'data', [k1, k3], `Changed the type of the ${humanize(k3)} field in ${humanize(k1)}`);
      if (k4 === 'label') return make('renamed', 'text', 'cosmetic', [k1, k3], `Renamed the ${humanize(k3)} field${text(value) ? ` to ${clip(text(value) as string)}` : ''}`);
      return make('changed', 'data', 'behaviour', [k1, k3], `Changed the ${humanize(k4 ?? 'settings').toLowerCase()} of the ${humanize(k3)} field in ${humanize(k1)}`);
    }
    case 'actions':
      return k1 ? make(kind, 'logic', 'behaviour', [k1], `${verb} the ${humanize(k1)} action`) : make('changed', 'logic', 'behaviour', [], 'Changed the actions');
    case 'aiBlocks':
      return k1 ? make(kind, 'ai', 'behaviour', [k1], `${verb} the ${humanize(k1)} AI step`) : make('changed', 'ai', 'behaviour', [], 'Changed the AI steps');
    case 'intents':
      return make('changed', 'logic', 'behaviour', k1 ? [k1] : [], `Changed the voice phrases${k1 ? ` for ${humanize(k1)}` : ''}`);
    default:
      return undefined;
  }
}

function applied(base: KalamSpec, ops: readonly Operation[]): KalamSpec | undefined {
  try {
    const doc = cloneSpec(base);
    const copy = JSON.parse(JSON.stringify(ops)) as Operation[];
    return applyPatch(doc, copy, false, true).newDocument;
  } catch {
    return undefined; // a patch that does not apply is described by its paths instead
  }
}

/**
 * Arrays whose elements were added or removed while elements of the same array were also edited. The patch writer
 * (fast-json-patch compare) matches array items by position, so removing the first of two screens is stored as
 * "remove screen 2" plus edits that turn screen 1 into the old screen 2. Those lines would misreport, so the
 * affected array is reported as one generic line instead. Only the specs can tell which item really went.
 */
function shiftedArrays(ops: readonly Operation[]): Map<string, string> {
  const structural = new Set<string>();
  const inner = new Set<string>();
  for (const op of ops) {
    const parts = op.path.split('/').slice(1).map(unescapePointer);
    if (parts[0] !== 'screens') continue;
    const whole = op.op === 'add' || op.op === 'remove';
    (parts.length === 2 && whole ? structural : inner).add('screens');
    if (parts[2] === 'children' && parts.length >= 4) {
      (parts.length === 4 && whole ? structural : inner).add(`screens/${parts[1]}/children`);
    }
  }
  const lines = new Map<string, string>();
  for (const key of structural) {
    if (!inner.has(key)) continue;
    lines.set(key, key === 'screens' ? 'Changed the screens' : `Changed the items on screen ${Number(key.split('/')[1]) + 1}`);
  }
  return lines;
}

/** Plain-English lines for a stored JSON Patch. Pass `base` (the spec the patch applies to) for names and detail. */
export function describePatch(ops: readonly Operation[], base?: KalamSpec): ChangeEntry[] {
  if (base) {
    const after = applied(base, ops);
    if (after) return describeSpecChanges(base, after);
  }
  const shifted = shiftedArrays(ops);
  const seen = new Set<string>();
  const out: ChangeEntry[] = [];
  for (const [key, line] of shifted) {
    if (key !== 'screens' && shifted.has('screens')) continue;
    out.push({ ...make('changed', 'structure', 'behaviour', [], line), key: `patch:${out.length}` });
    seen.add(`structure:${line}`);
  }
  const insideShifted = (path: string): boolean => {
    const parts = path.split('/').slice(1).map(unescapePointer);
    if (parts[0] !== 'screens' || parts.length < 2) return false;
    return shifted.has('screens') || (parts[2] === 'children' && parts.length >= 4 && shifted.has(`screens/${parts[1]}/children`));
  };
  for (const op of ops) {
    if (insideShifted(op.path)) continue;
    const d = describeOp(op);
    if (!d) continue;
    const id = `${d.category}:${d.text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...d, key: `patch:${out.length}` });
  }
  return out;
}
