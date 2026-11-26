/**
 * Builds a register-style app from a short description: one or more lists of entries, a home page with totals,
 * an add page and an entry page for each list, and (when one list links to another) the parent's page showing
 * its own entries. Everything it makes is plain KalamSpec data, validated by the same validator as any other app.
 */
import { PERMISSION_REASON } from '../../spec/copy';
import {
  LIMITS,
  type IconGlyph, type KalamAction, type KalamComponent, type KalamField, type KalamScreen, type KalamSpec,
  type OnDeleteRule, type ThemePreset,
} from '../../spec/schema';
import { requiredPermissions } from '../../spec/v11';
import { PHRASES, assembleSpec, phrases, type BuildOpts } from '../base';
import type { CatalogAccessibility } from './types';

// ─── Field shorthands ─────────────────────────────────────────────────────────
export const fld = {
  text: (label: string, o: { required?: boolean; multiline?: boolean; placeholder?: string; maxLength?: number } = {}): KalamField =>
    ({ type: 'text', label, ...o }),
  num: (label: string, o: { required?: boolean; min?: number; max?: number; unit?: string; decimals?: number; defaultValue?: number } = {}): KalamField =>
    ({ type: 'number', label, min: 0, ...o }),
  date: (label: string, o: { required?: boolean; today?: boolean } = {}): KalamField => ({
    type: 'date', label, ...(o.required ? { required: true } : {}), ...(o.today ? { defaultValue: 'today' as const } : {}),
  }),
  pick: (label: string, options: string[], o: { required?: boolean; defaultValue?: string } = {}): KalamField =>
    ({ type: 'enum', label, options, ...o }),
  yes: (label: string, defaultValue = false): KalamField => ({ type: 'boolean', label, defaultValue }),
  /** The entry of another list this one belongs to. `restrict` (the default) refuses to delete a parent that still has entries. */
  link: (label: string, collection: string, display: string, o: { onDelete?: OnDeleteRule; required?: boolean } = {}): KalamField => ({
    type: 'text', label, required: o.required ?? true, ref: { collection, display, onDelete: o.onDelete ?? 'restrict' },
  }),
};

// ─── Description ──────────────────────────────────────────────────────────────
type StatFormat = 'number' | 'integer' | 'currency' | 'percent' | 'text';
export interface StatDef { id: string; label: string; expr: string; format?: StatFormat; secondary?: boolean }
export interface SortDef { field: string; direction: 'asc' | 'desc' }
export interface ListDef {
  id?: string;
  label?: string;
  filter?: string;
  sort?: SortDef;
  limit?: number;
  emptyText?: string;
  /** A yes/no field the list turns on and off with one tap. */
  toggleField?: string;
}

export interface TableDef {
  /** Collection id, plural: `entries`. */
  id: string;
  /** Plural, as people say it: `Entries`. */
  label: string;
  /** Singular, lower case: `entry`. */
  noun: string;
  fields: Record<string, KalamField>;
  primary: string;
  secondary?: string;
  sort?: SortDef;
  /** Lists on the home page. Default: one list of every entry. An empty array shows none. */
  lists?: ListDef[];
  /** Totals on this entry's own page. They can use `selected`, the entry that is open. */
  stats?: StatDef[];
  /** What a list of these entries shows on its parent's page, when it links to one. */
  under?: { primary: string; secondary?: string; sort?: SortDef; label?: string };
  /** A button on the entry's page that sets one value in one tap ("Mark delivered"). */
  setTo?: { field: string; value: string | number | boolean; label: string; feedback: string };
  /** Replaces the usual "Delete this entry?" question. */
  deleteConfirm?: string;
  addLabel?: string;
  /** Extra words for the voice commands, English first, then Hinglish or Hindi. */
  voice?: { add?: string[]; save?: string[] };
}

export interface TableAppDef {
  /** Gallery id, also `meta.templateId`. */
  id: string;
  name: string;
  description: string;
  glyph: IconGlyph;
  theme: ThemePreset;
  currency?: string;
  tags: string[];
  author: string;
  accessibility: CatalogAccessibility;
  tables: TableDef[];
  /** Totals at the top of the home page. */
  stats: StatDef[];
  /** Short plain lines under the totals (privacy or safety), each under 48 characters so it reads at a glance. */
  note?: string | string[];
  /** Charts and reminders, shown under the totals. */
  extras?: KalamComponent[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function inputFor(prefix: string, fid: string, f: KalamField): KalamComponent | undefined {
  const id = `${prefix}_${fid}`.slice(0, 48);
  const base = { id, label: f.label, field: fid };
  switch (f.type) {
    case 'text': return { ...base, type: 'textInput', ...(f.required ? { required: true } : {}), ...(f.multiline ? { multiline: true } : {}) };
    case 'number': return { ...base, type: 'number', ...(f.required ? { required: true } : {}), placeholder: '0' };
    case 'date': return { ...base, type: 'date', ...(f.required ? { required: true } : {}) };
    case 'enum': return { ...base, type: 'choice', ...(f.required ? { required: true } : {}) };
    case 'boolean': return { ...base, type: 'toggle' };
    default: return undefined;
  }
}

const stat = (s: StatDef, currency: string): KalamComponent => ({
  id: s.id, type: 'stat', label: s.label, expr: s.expr,
  ...(s.format ? { format: s.format } : {}),
  ...(s.format === 'currency' ? { currency } : {}),
  ...(s.secondary ? { secondary: true } : {}),
});

const button = (id: string, label: string, action: string, tone: 'primary' | 'secondary' | 'danger' = 'primary'): KalamComponent =>
  ({ id, type: 'bigButton', label, action, tone });

/** Links from `child` to `parent`: the field that holds the parent's entry. */
function linkField(child: TableDef, parent: TableDef): string | undefined {
  return Object.entries(child.fields).find(([, f]) => f.type === 'text' && f.ref?.collection === parent.id)?.[0];
}

export function buildTableApp(def: TableAppDef, opts: BuildOpts): KalamSpec {
  const currency = def.currency ?? 'INR';
  const many = def.tables.length > 1;
  const collections = Object.fromEntries(def.tables.map((t) => [t.id, { label: t.label, fields: t.fields }]));
  const kidsOf = (parent: TableDef) =>
    def.tables.filter((c) => c !== parent && linkField(c, parent)).map((c) => ({ table: c, field: linkField(c, parent) as string }));

  const actions: Record<string, KalamAction> = { go_home: { type: 'navigate', screen: 'home' } };
  const intents: Record<string, string[]> = { go_home: [...PHRASES.home] };
  const screens: KalamScreen[] = [];
  const home: KalamComponent[] = def.stats.map((s) => stat(s, currency));
  [def.note ?? []].flat().forEach((line, i) => home.push({ id: i ? `home_note_${i + 1}` : 'home_note', type: 'text', label: line, secondary: true }));
  home.push(...(def.extras ?? []));

  def.tables.forEach((t, index) => {
    const Noun = cap(t.noun);
    const addScreen = `add_${t.id}`;
    const detailScreen = `${t.id}_detail`;
    actions[`go_add_${t.id}`] = { type: 'navigate', screen: addScreen };
    actions[`save_${t.id}`] = { type: 'insert', collection: t.id, then: { feedback: `${Noun} saved`, navigate: 'home' } };
    actions[`update_${t.id}`] = { type: 'update', collection: t.id, record: 'selected', then: { feedback: `${Noun} updated`, navigate: 'home' } };
    actions[`delete_${t.id}`] = {
      type: 'delete', collection: t.id, record: 'selected',
      confirm: t.deleteConfirm ?? `Delete this ${t.noun}? This cannot be undone.`,
      then: { feedback: `${Noun} deleted`, navigate: 'home' },
    };
    intents[`go_add_${t.id}`] = phrases([`add ${t.noun}`, `new ${t.noun}`], t.voice?.add ?? []);
    intents[`save_${t.id}`] = many ? phrases([`save ${t.noun}`], t.voice?.save ?? []) : [...PHRASES.save];
    intents[`update_${t.id}`] = many ? [`update ${t.noun}`, `save ${t.noun} changes`] : [...PHRASES.update];
    intents[`delete_${t.id}`] = many ? [`delete ${t.noun}`, `remove ${t.noun}`] : [...PHRASES.remove];

    const inputs = (prefix: string): KalamComponent[] =>
      Object.entries(t.fields).map(([fid, f]) => inputFor(`${prefix}_${t.id}`, fid, f)).filter((c): c is KalamComponent => !!c);

    // Home: button, then lists.
    home.push(button(`add_${t.id}_button`, t.addLabel ?? `Add ${t.noun}`, `go_add_${t.id}`, index === 0 ? 'primary' : 'secondary'));
    const lists: ListDef[] = t.lists ?? [{}];
    lists.forEach((l, i) => {
      home.push({
        id: l.id ?? (lists.length > 1 ? `${t.id}_list_${i + 1}` : `${t.id}_list`),
        type: 'list', label: l.label ?? t.label, source: t.id, primary: t.primary,
        ...(t.secondary ? { secondary: t.secondary } : {}),
        ...(l.filter ? { filter: l.filter } : {}),
        ...((l.sort ?? t.sort) ? { sort: l.sort ?? t.sort } : {}),
        limit: l.limit ?? 100,
        ...(l.toggleField ? { toggleField: l.toggleField } : {}),
        detailScreen,
        emptyText: l.emptyText ?? `No ${t.label.toLowerCase()} yet. Tap “${t.addLabel ?? `Add ${t.noun}`}” to start.`,
      });
    });

    // Add page.
    screens.push({
      id: addScreen, title: `Add ${t.noun}`.slice(0, LIMITS.nameLength), form: t.id,
      children: [
        ...inputs('add'),
        button(`save_${t.id}_button`, `Save ${t.noun}`, `save_${t.id}`),
        button(`add_${t.id}_back`, 'Back', 'go_home', 'secondary'),
      ],
    });

    // Entry page: its own details, totals, the entries that belong to it, then the buttons.
    const page: KalamComponent[] = [...inputs('edit'), ...(t.stats ?? []).map((s) => stat(s, currency))];
    for (const { table: kid, field } of kidsOf(t)) {
      const under = kid.under ?? { primary: kid.primary, secondary: kid.secondary };
      page.push(
        button(`add_${kid.id}_for_${t.id}`, kid.addLabel ?? `Add ${kid.noun}`, `go_add_${kid.id}`, 'secondary'),
        {
          id: `${kid.id}_under_${t.id}`.slice(0, 48), type: 'list', label: under.label ?? kid.label, source: kid.id,
          primary: under.primary, ...(under.secondary ? { secondary: under.secondary } : {}),
          filter: `${field} == selected`, ...((under.sort ?? kid.sort) ? { sort: under.sort ?? kid.sort } : {}),
          limit: 100, detailScreen: `${kid.id}_detail`,
          emptyText: `No ${kid.label.toLowerCase()} for this ${t.noun} yet.`,
        },
      );
    }
    if (t.setTo) {
      actions[`mark_${t.id}`] = {
        type: 'update', collection: t.id, record: 'selected', set: { [t.setTo.field]: t.setTo.value },
        then: { feedback: t.setTo.feedback, navigate: 'home' },
      };
      page.push(button(`mark_${t.id}_button`, t.setTo.label, `mark_${t.id}`));
    }
    page.push(
      button(`update_${t.id}_button`, 'Save changes', `update_${t.id}`, t.setTo ? 'secondary' : 'primary'),
      button(`delete_${t.id}_button`, `Delete ${t.noun}`, `delete_${t.id}`, 'danger'),
      button(`${t.id}_detail_back`, 'Back', 'go_home', 'secondary'),
    );
    screens.push({ id: detailScreen, title: Noun.slice(0, LIMITS.nameLength), form: t.id, children: page });
  });

  screens.unshift({ id: 'home', title: def.name.slice(0, LIMITS.nameLength), children: home });

  const spec = assembleSpec(
    {
      templateId: def.id, name: def.name, description: def.description, glyph: def.glyph, theme: def.theme,
      collections, screens, actions, intents, tags: def.tags,
    },
    opts,
  );
  const permissions = requiredPermissions(spec).map((kind) => ({ kind, reason: PERMISSION_REASON[kind] }));
  return {
    ...spec,
    meta: { ...spec.meta, author: def.author },
    accessibility: { summary: def.accessibility.summary, suggestedModes: def.accessibility.suggestedModes },
    settings: { currency },
    ...(permissions.length ? { permissions } : {}),
  };
}
