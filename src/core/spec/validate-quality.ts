/**
 * Checks that a valid app also works for the person (eval 2026-11-25): buttons that change an entry
 * really change something, fixed values fit their fields, photos land in image fields, and every saved
 * field can be seen again. Runs after the Zod layer in validate.ts, on a structurally valid spec.
 */
import type { KalamComponent, KalamField, KalamScreen, KalamSpec } from './schema';
import type { V11Reporter } from './validate-v11';

const own = (o: object, k: string | undefined): boolean => k !== undefined && Object.prototype.hasOwnProperty.call(o, k);

/** The form field a component writes, for every component that writes one. */
export function writtenField(c: KalamComponent): string | undefined {
  switch (c.type) {
    case 'number': case 'textInput': case 'date': case 'choice': case 'toggle': case 'signature':
      return c.field;
    case 'counter': case 'timer': case 'photo':
      return c.field;
    default:
      return undefined;
  }
}

/** True when `value` is a valid fixed value for `field`. */
export function setValueFits(field: KalamField, value: unknown): boolean {
  switch (field.type) {
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'enum': return typeof value === 'string' && field.options.includes(value);
    case 'date': return value === 'today' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
    // A link or a photo needs a real entry or picture, never a fixed value.
    case 'text': return typeof value === 'string' && !field.ref;
    case 'image': return false;
  }
}

function checkActions(spec: KalamSpec, r: V11Reporter): void {
  for (const [id, a] of Object.entries(spec.actions)) {
    if (a.type !== 'update' || !own(spec.collections, a.collection)) continue;
    const fields = spec.collections[a.collection].fields;
    for (const [f, v] of Object.entries(a.set ?? {})) {
      const def = own(fields, f) ? fields[f] : undefined;
      if (!def) r.error('UNKNOWN_FIELD', ['actions', id, 'set', f], `"${a.collection}" has no field "${f}".`);
      else if (!setValueFits(def, v)) r.error('FIELD_TYPE_MISMATCH', ['actions', id, 'set', f], `${JSON.stringify(v)} does not fit the ${def.type} field "${f}".`);
    }
    if (a.set && Object.keys(a.set).length) continue;
    // Without fixed values the update writes the screen's inputs. A button on a screen with no input for this
    // collection saves nothing yet still says it worked (s20 "Mark done"). A warning here, so a stored app with
    // one dead button still opens; the compiler treats it as an error (compile.ts BLOCKING_WARNINGS).
    spec.screens.forEach((s, si) => {
      const edits = s.form === a.collection && s.children.some((c) => !!writtenField(c));
      if (edits) return;
      s.children.forEach((c, ci) => {
        if (c.type === 'bigButton' && c.action === id) {
          r.warn('NO_OP_UPDATE', ['screens', si, 'children', ci, 'action'],
            `"${c.label}" changes nothing: its screen has no inputs for "${a.collection}". Add inputs, or a fixed value with "set".`);
        }
      });
    });
  }
}

function checkPhotos(spec: KalamSpec, r: V11Reporter): void {
  spec.screens.forEach((s, si) => {
    const form = own(spec.collections, s.form) ? spec.collections[s.form as string] : undefined;
    s.children.forEach((c, ci) => {
      if (c.type !== 'photo' || !c.field) return;
      const path = ['screens', si, 'children', ci, 'field'];
      if (!form) r.error('MISSING_FORM', path, 'A photo kept with an entry needs a screen that saves to a collection.');
      else if (!own(form.fields, c.field)) r.error('UNKNOWN_FIELD', path, `"${s.form}" has no field "${c.field}".`);
      else if (form.fields[c.field].type !== 'image') r.error('FIELD_TYPE_MISMATCH', path, `A photo needs an image field, "${c.field}" is ${form.fields[c.field].type}.`);
    });
  });
}

/** Screens a list opens with one of its entries selected, by the list's collection. */
function detailScreens(spec: KalamSpec): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of spec.screens) {
    for (const c of s.children) {
      if (c.type !== 'list' || !c.detailScreen) continue;
      const set = out.get(c.source) ?? new Set<string>();
      set.add(c.detailScreen);
      out.set(c.source, set);
    }
  }
  return out;
}

type ListComponent = Extract<KalamComponent, { type: 'list' }>;

/** Fields a list's row shows: primary, secondary, the tick, and a link it is filtered on (`link == selected`). */
export function rowFields(spec: KalamSpec, list: ListComponent): Set<string> {
  const out = new Set<string>([list.primary, list.secondary, list.toggleField].filter((f): f is string => !!f));
  // Entries listed on their parent's page show the link by where they appear.
  if (list.filter && /\bselected\b/.test(list.filter)) {
    const fields = own(spec.collections, list.source) ? spec.collections[list.source].fields : {};
    for (const [f, def] of Object.entries(fields)) {
      if (def.type === 'text' && def.ref && new RegExp(`\\b${f}\\b`).test(list.filter)) out.add(f);
    }
  }
  return out;
}

/**
 * Fields the screen a list opens does not show. Once an entry is open its row is gone, so the screen shows every
 * field; only the parent link a page's list is filtered on (`link == selected`) is implied by where it is.
 */
export function detailMissing(spec: KalamSpec, list: ListComponent, detail: KalamScreen): string[] {
  if (detail.form !== list.source || !own(spec.collections, list.source)) return [];
  const fields = spec.collections[list.source].fields;
  const implied = (f: string) => {
    const def = fields[f];
    return def.type === 'text' && !!def.ref && !!list.filter && /\bselected\b/.test(list.filter) && new RegExp(`\\b${f}\\b`).test(list.filter);
  };
  const written = new Set(detail.children.map(writtenField));
  return Object.keys(fields).filter((f) => !implied(f) && !written.has(f));
}

/** Fields of each collection a person can see again after saving: list rows, or a detail screen. */
export function shownFields(spec: KalamSpec): Map<string, Set<string>> {
  const shown = new Map<string, Set<string>>();
  const add = (col: string, f: string | undefined) => {
    if (!f) return;
    const set = shown.get(col) ?? new Set<string>();
    set.add(f);
    shown.set(col, set);
  };
  const details = detailScreens(spec);
  const byId = new Map<string, KalamScreen>(spec.screens.map((s) => [s.id, s]));
  for (const s of spec.screens) {
    for (const c of s.children) {
      if (c.type === 'list') for (const f of rowFields(spec, c)) add(c.source, f);
    }
  }
  for (const [col, ids] of details) {
    for (const id of ids) {
      const s = byId.get(id);
      if (s?.form === col) for (const c of s.children) add(col, writtenField(c));
    }
  }
  return shown;
}

function checkFieldsShown(spec: KalamSpec, r: V11Reporter): void {
  const shown = shownFields(spec);
  const entered = new Set(spec.screens.filter((s) => s.form).map((s) => s.form as string));
  for (const [cid, col] of Object.entries(spec.collections)) {
    if (!entered.has(cid)) continue; // never filled in: UNUSED_COLLECTION or a stat-only collection says enough
    for (const [fid, f] of Object.entries(col.fields)) {
      if (shown.get(cid)?.has(fid)) continue;
      r.warn('FIELD_NOT_SHOWN', ['collections', cid, 'fields', fid],
        `"${f.label}" is saved but never shown again. Show it in the list or on a detail screen.`);
    }
  }
  // An entry opened from a list shows all of itself: a field another list shows elsewhere does not count (s20).
  const reported = new Set<string>();
  for (const s of spec.screens) {
    for (const c of s.children) {
      if (c.type !== 'list' || !c.detailScreen) continue;
      const di = spec.screens.findIndex((x) => x.id === c.detailScreen);
      const missing = di < 0 ? [] : detailMissing(spec, c, spec.screens[di]).filter((f) => shown.get(c.source)?.has(f));
      const key = `${di}:${missing.join(',')}`;
      if (!missing.length || reported.has(key)) continue;
      reported.add(key);
      const labels = missing.map((f) => `"${spec.collections[c.source].fields[f].label}"`).join(', ');
      r.warn('FIELD_NOT_SHOWN', ['screens', di],
        `"${spec.screens[di].title}" opens an entry of "${c.source}" but does not show ${labels}. Add them to that screen.`);
    }
  }
}

export function checkQuality(spec: KalamSpec, r: V11Reporter): void {
  checkActions(spec, r);
  checkPhotos(spec, r);
  checkFieldsShown(spec, r);
}
