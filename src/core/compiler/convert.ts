/**
 * Deterministic IR → KalamSpec converter (docs/07 §11.5: "the compiler must convert it into a
 * validated KalamSpec"). Pure: no model calls, no clock reads (time is injected).
 *
 * - Every id is slugified to the KalamSpec identifier grammar and de-duplicated per namespace.
 * - References are remapped through the same id spaces, so `"Orders"` and `"orders"` resolve
 *   to one collection. Unresolvable references are kept (slugified) so `validateSpec` reports
 *   them precisely for the single repair pass — the converter never invents bindings.
 * - Only whitelisted properties are copied per component/action/block type (strict schema).
 * - AI blocks always start `unverified`; a model cannot claim verification.
 *
 * The output is a CANDIDATE spec: callers must run `validateSpec` before using it.
 */
import { PERMISSION_REASON } from '../spec/copy';
import {
  ICON_GLYPHS, LIMITS, RESERVED_IDS, SCHEMA_VERSION, THEME_PRESETS,
  type IconGlyph, type KalamAction, type KalamAIBlock, type KalamCollection, type KalamComponent,
  type KalamField, type KalamLayoutNode, type KalamScreen, type KalamSpec, type ThemePreset,
} from '../spec/schema';
import { isMachineField, removeFromLayout, requiredPermissions } from '../spec/v11';
import { themeFromPreset } from '../templates/themes';
import type {
  CompilerIR, IRAction, IRAIBlock, IRCollection, IRComponent, IRField, IRGroup, IRScreen,
} from './ir';

// ─── Identifiers ──────────────────────────────────────────────────────────────
const RESERVED = new Set<string>(RESERVED_IDS);

/** Converts any label/id into `^[a-z][a-z0-9_]{0,47}$`, avoiding reserved words. */
export function slugify(raw: string, fallback = 'entry'): string {
  let s = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  if (!/^[a-z]/.test(s)) s = `${fallback}_${s}`;
  s = s.slice(0, 48).replace(/_+$/, '');
  if (RESERVED.has(s)) s = `${s.slice(0, 44)}_val`;
  return s;
}

/** One id namespace: allocates unique slugs and resolves references written loosely. */
export class IdSpace {
  private readonly byRaw = new Map<string, string>();
  private readonly used = new Set<string>();
  constructor(private readonly fallback = 'entry') {}

  /** Registers an id that already exists (edit mode) under its own name. */
  register(id: string): void {
    this.used.add(id);
    this.byRaw.set(id, id);
  }
  alloc(raw: string): string {
    const base = slugify(raw, this.fallback);
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base.slice(0, 44)}_${n}`;
    this.used.add(id);
    if (!this.byRaw.has(raw)) this.byRaw.set(raw, id);
    if (!this.byRaw.has(base)) this.byRaw.set(base, id);
    return id;
  }
  lookup(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    return this.byRaw.get(raw) ?? this.byRaw.get(slugify(raw, this.fallback));
  }
  resolve(raw: string | undefined): string | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    return this.lookup(raw) ?? slugify(raw, this.fallback);
  }
  ids(): string[] {
    return [...this.used];
  }
}

export interface ConversionContext {
  collections: IdSpace;
  screens: IdSpace;
  actions: IdSpace;
  aiBlocks: IdSpace;
  /** Component ids are unique across the whole app. */
  components: IdSpace;
  /** Final collection id → field id space. */
  fields: Map<string, IdSpace>;
  /** Formula identifiers that were renamed (raw → final), for expr/filter remapping. */
  renamed: Map<string, string>;
  /** Final id per IR object, so repeated raw ids (two `note` components) stay distinct. */
  allocated: WeakMap<object, string>;
}

/** Fresh context; with `existing`, its ids are pre-registered (edit mode). */
export function createConversionContext(existing?: KalamSpec): ConversionContext {
  const ctx: ConversionContext = {
    collections: new IdSpace('data'),
    screens: new IdSpace('screen'),
    actions: new IdSpace('action'),
    aiBlocks: new IdSpace('ai'),
    components: new IdSpace('entry'),
    fields: new Map(),
    renamed: new Map(),
    allocated: new WeakMap(),
  };
  if (!existing) return ctx;
  for (const [cid, col] of Object.entries(existing.collections)) {
    ctx.collections.register(cid);
    const fs = new IdSpace('field');
    for (const fid of Object.keys(col.fields)) fs.register(fid);
    ctx.fields.set(cid, fs);
  }
  for (const s of existing.screens) {
    ctx.screens.register(s.id);
    for (const c of s.children) ctx.components.register(c.id);
  }
  for (const a of Object.keys(existing.actions)) ctx.actions.register(a);
  for (const b of Object.keys(existing.aiBlocks)) ctx.aiBlocks.register(b);
  return ctx;
}

function noteRename(ctx: ConversionContext, raw: string, id: string): void {
  if (raw !== id && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) ctx.renamed.set(raw, id);
}

/** Allocates a collection and its field ids. Returns the final collection id. */
export function allocCollection(ctx: ConversionContext, c: IRCollection): string {
  const id = ctx.collections.alloc(c.id);
  noteRename(ctx, c.id, id);
  const fs = ctx.fields.get(id) ?? new IdSpace('field');
  for (const f of c.fields) noteRename(ctx, f.id, fs.alloc(f.id));
  ctx.fields.set(id, fs);
  return id;
}

export function allocComponent(ctx: ConversionContext, c: IRComponent): string {
  const id = ctx.components.alloc(c.id);
  ctx.allocated.set(c, id);
  return id;
}

export function allocScreen(ctx: ConversionContext, s: IRScreen): string {
  const id = ctx.screens.alloc(s.id);
  ctx.allocated.set(s, id);
  for (const c of s.components) allocComponent(ctx, c);
  return id;
}

function resolveField(ctx: ConversionContext | undefined, collection: string | undefined, raw: string | undefined) {
  if (raw === undefined || raw.trim() === '') return undefined;
  const space = collection ? ctx?.fields.get(collection) : undefined;
  return space ? space.resolve(raw) : resolveAnyField(ctx, raw);
}

/** A field referenced without a collection (transient forms, AI-block inputs). */
function resolveAnyField(ctx: ConversionContext | undefined, raw: string | undefined) {
  if (raw === undefined || raw.trim() === '') return undefined;
  for (const space of ctx?.fields.values() ?? []) {
    const hit = space.lookup(raw);
    if (hit) return hit;
  }
  return slugify(raw, 'field');
}

/**
 * Re-points formula identifiers that the converter renamed (e.g. `Orders` → `orders`).
 * ponytail: plain word-boundary replace — also touches identical words inside string literals;
 * a jsep-based rewrite is the upgrade path if that ever matters.
 */
function remapFormula(ctx: ConversionContext, src: string | undefined): string | undefined {
  if (src === undefined) return undefined;
  let out = src.trim();
  for (const [raw, id] of ctx.renamed) out = out.replace(new RegExp(`\\b${raw}\\b`, 'g'), id);
  return out || undefined;
}

// ─── Small helpers ────────────────────────────────────────────────────────────
/** Drops undefined keys so strict schemas and JSON storage see clean objects. */
function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
const clip = (s: string | undefined, max: number) => {
  const t = s?.trim();
  return t ? t.slice(0, max) : undefined;
};
export function humanize(id: string): string {
  const s = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Item';
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

// ─── Icon ─────────────────────────────────────────────────────────────────────
const GLYPH_HINTS: Array<[IconGlyph, RegExp]> = [
  ['scissors', /tailor|stitch|sew|boutique|darzi|silai/],
  ['wallet', /expense|money|budget|spend|ledger|khata|payment|salary|loan|udhar/],
  ['package', /inventory|stock|product|warehouse|godown|item/],
  ['pill', /medicine|dose|pill|tablet|dawai/],
  ['calendar', /appointment|booking|schedule|event|attendance/],
  ['users', /customer|contact|client|member|people|student|patient|staff/],
  ['shopping_cart', /shop|grocery|order|sale|store|kirana/],
  ['dumbbell', /workout|gym|exercise|fitness/],
  ['book', /book|library|reading|lesson/],
  ['graduation_cap', /school|class|exam|course|homework/],
  ['heart', /health|habit|mood|care/],
  ['check', /todo|task|checklist/],
  ['calculator', /calculat|total|bill/],
  ['ruler', /measure/],
  ['bell', /remind/],
  ['notebook', /note|diary|journal|log/],
];

export function pickGlyph(text: string): IconGlyph {
  const t = text.toLowerCase();
  return GLYPH_HINTS.find(([, re]) => re.test(t))?.[0] ?? 'sparkles';
}

// ─── Entity converters (shared with structural edits) ─────────────────────────
/** `ctx` resolves a relation's collection and display field; without it they are slugified. */
export function convertField(f: IRField, ctx?: ConversionContext): KalamField {
  const label = clip(f.label, LIMITS.labelLength) ?? humanize(f.id);
  const required = f.required || undefined;
  const dv = f.defaultValue?.trim();
  switch (f.type) {
    case 'text': {
      // A relation stores a record id, so a default value or several lines make no sense there.
      const target = f.refCollection ? (ctx ? ctx.collections.resolve(f.refCollection) : slugify(f.refCollection, 'data')) : undefined;
      const ref = target
        ? clean({ collection: target, display: resolveField(ctx, target, f.refDisplay), onDelete: f.onDelete })
        : undefined;
      return clean<KalamField>({
        type: 'text', label, required, defaultValue: ref ? undefined : dv || undefined,
        multiline: ref ? undefined : f.multiline || undefined, ref,
      });
    }
    case 'number': {
      const n = dv !== undefined && dv !== '' ? Number(dv) : undefined;
      return clean<KalamField>({
        type: 'number', label, required,
        defaultValue: n !== undefined && Number.isFinite(n) ? n : undefined,
        min: f.min, max: f.max,
        unit: clip(f.unit, 12),
        decimals: f.decimals !== undefined ? clamp(f.decimals, 0, 6) : undefined,
      });
    }
    case 'date':
      return clean<KalamField>({ type: 'date', label, required, defaultValue: dv?.toLowerCase() === 'today' ? 'today' : undefined });
    case 'boolean':
      return clean<KalamField>({
        type: 'boolean', label, required,
        defaultValue: dv === 'true' ? true : dv === 'false' ? false : undefined,
      });
    case 'enum': {
      const options = dedupe(f.options ?? []).map((o) => o.slice(0, 60)).slice(0, LIMITS.enumOptions);
      return clean<KalamField>({ type: 'enum', label, required, options, defaultValue: dv && options.includes(dv) ? dv : undefined });
    }
    case 'image':
      return clean<KalamField>({ type: 'image', label, required });
  }
}

export function convertCollection(c: IRCollection, ctx: ConversionContext, id: string): KalamCollection {
  const fs = ctx.fields.get(id);
  const fields: Record<string, KalamField> = {};
  for (const f of c.fields) fields[fs?.resolve(f.id) ?? slugify(f.id, 'field')] = convertField(f, ctx);
  return clean<KalamCollection>({ label: clip(c.label, LIMITS.labelLength), fields });
}

/** `formCollection` is the final id of the screen's bound collection, if any. */
export function convertComponent(c: IRComponent, ctx: ConversionContext, formCollection?: string): KalamComponent {
  const id = ctx.allocated.get(c) ?? ctx.components.resolve(c.id) ?? slugify(c.id);
  const label = clip(c.label, LIMITS.labelLength) ?? humanize(c.id);
  const field = (raw?: string) => resolveField(ctx, formCollection, raw);
  // Candidate object: shape is whitelisted per type; value constraints are checked by validateSpec.
  let out: Record<string, unknown>;
  switch (c.type) {
    case 'text':
    case 'heading':
      out = { id, type: c.type, label };
      break;
    case 'number':
      out = { id, type: 'number', label, field: field(c.field), required: c.required || undefined, placeholder: clip(c.placeholder, LIMITS.labelLength) };
      break;
    case 'textInput':
      out = {
        id, type: 'textInput', label, field: field(c.field), required: c.required || undefined,
        placeholder: clip(c.placeholder, LIMITS.labelLength), multiline: c.multiline || undefined,
      };
      break;
    case 'date':
      out = { id, type: 'date', label, field: field(c.field), required: c.required || undefined };
      break;
    case 'choice': {
      const options = c.options ? dedupe(c.options).slice(0, LIMITS.enumOptions) : [];
      out = { id, type: 'choice', label, field: field(c.field), options: options.length ? options : undefined, required: c.required || undefined };
      break;
    }
    case 'toggle':
      out = { id, type: 'toggle', label, field: field(c.field) };
      break;
    case 'counter':
      out = {
        id, type: 'counter', label, field: field(c.field), min: c.min, max: c.max,
        step: c.step !== undefined && c.step > 0 ? c.step : undefined,
      };
      break;
    case 'bigButton':
      out = { id, type: 'bigButton', label, action: ctx.actions.resolve(c.action), tone: c.tone };
      break;
    case 'list': {
      const source = ctx.collections.resolve(c.source);
      const lf = (raw?: string) => resolveField(ctx, source, raw);
      const sortField = lf(c.sortField);
      out = {
        id, type: 'list', label: clip(c.label, LIMITS.labelLength), source,
        primary: lf(c.primary), secondary: lf(c.secondaryField),
        filter: remapFormula(ctx, c.filter),
        sort: sortField ? { field: sortField, direction: c.sortDirection ?? 'asc' } : undefined,
        limit: c.limit !== undefined ? clamp(Math.round(c.limit), 1, 500) : undefined,
        emptyText: clip(c.emptyText, LIMITS.labelLength), toggleField: lf(c.toggleField),
        detailScreen: ctx.screens.resolve(c.detailScreen), allowDelete: c.allowDelete || undefined,
      };
      break;
    }
    case 'stat': {
      const currency = c.currency?.trim().toUpperCase();
      out = {
        id, type: 'stat', label, expr: remapFormula(ctx, c.expr), format: c.format,
        currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
        prefix: clip(c.prefix, 8), suffix: clip(c.suffix, 12),
      };
      break;
    }
    case 'photo':
      out = { id, type: 'photo', label, aiBlock: ctx.aiBlocks.resolve(c.aiBlock), field: field(c.field) };
      break;
    case 'chart': {
      const source = ctx.collections.resolve(c.source);
      const lf = (raw?: string) => resolveField(ctx, source, raw);
      const metric = c.metric ?? 'count';
      // Safe defaults keep the chart valid: count needs no field, and a chart is split by exactly one thing.
      const groupBy = c.period ? undefined : lf(c.groupBy);
      const period = c.period ?? (groupBy ? undefined : 'week');
      // A line needs periods and a donut needs a field; a range is never shorter than one period.
      const kind = period ? (c.chart === 'donut' ? 'line' : c.chart ?? 'line') : c.chart === 'line' ? 'bar' : c.chart ?? 'bar';
      const rank = { day: 0, week: 1, month: 2 } as const;
      const asked = c.rangeUnit ?? period ?? 'month';
      const rangeUnit = period && rank[asked] < rank[period] ? period : asked;
      out = {
        id, type: 'chart', label, chart: kind, source, metric,
        valueField: metric === 'count' ? undefined : lf(c.valueField), groupBy, period, dateField: lf(c.dateField),
        range: c.rangeLast !== undefined ? { last: clamp(Math.round(c.rangeLast), 1, 60), unit: rangeUnit } : undefined,
      };
      break;
    }
    case 'timer': {
      const mode = c.mode ?? (c.durationSec !== undefined ? 'countdown' : 'stopwatch');
      out = {
        id, type: 'timer', label, mode,
        durationSec: mode === 'countdown' ? clamp(Math.round(c.durationSec ?? 60), 1, LIMITS.timerSeconds) : undefined,
        field: field(c.field), unit: c.field ? c.unit : undefined,
      };
      break;
    }
    case 'reminder': {
      const source = ctx.collections.resolve(c.source);
      const lf = (raw?: string) => resolveField(ctx, source, raw);
      const time = c.time?.trim();
      out = {
        id, type: 'reminder', label, source, dateField: lf(c.dateField),
        leadDays: c.leadDays !== undefined ? clamp(Math.round(c.leadDays), 0, 30) : undefined,
        time: time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : undefined,
        doneField: lf(c.doneField), titleField: lf(c.titleField), message: clip(c.message, 120),
      };
      break;
    }
    case 'signature':
      out = { id, type: 'signature', label, field: field(c.field), required: c.required || undefined };
      break;
  }
  const style = clean({ size: c.size, emphasis: c.emphasis, tone: c.colorTone, align: c.align, fullWidth: c.fullWidth || undefined });
  if (Object.keys(style).length) out.style = style;
  return clean(out) as KalamComponent;
}

/**
 * Flat IR groups → nested layout. Deterministic repair: unknown ids, repeats, cycles and anything
 * deeper than LIMITS.layoutDepth are dropped (layout is presentation; dropping it never loses data).
 */
export function convertLayout(groups: IRGroup[] | undefined, componentIds: ReadonlyMap<string, string>): KalamLayoutNode[] | undefined {
  if (!groups?.length) return undefined;
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  const nested = new Set(groups.flatMap((g) => g.items.filter((i) => byId.has(i) && i !== g.id)));
  const placed = new Set<string>();
  const used = new Set<string>();
  let budget = LIMITS.layoutNodesPerScreen;
  const build = (g: IRGroup, depth: number): KalamLayoutNode | undefined => {
    if (used.has(g.id) || depth > LIMITS.layoutDepth || budget <= 0) return undefined;
    used.add(g.id);
    budget--;
    const children: KalamLayoutNode['children'] = [];
    for (const item of g.items.slice(0, LIMITS.layoutChildren)) {
      const sub = byId.get(item);
      if (sub) {
        const node = build(sub, depth + 1);
        if (node) children.push(node);
        continue;
      }
      const id = componentIds.get(item) ?? componentIds.get(slugify(item));
      if (id && !placed.has(id)) {
        placed.add(id);
        children.push(id);
      }
    }
    if (!children.length) return undefined;
    return clean({
      type: g.type, children,
      title: g.type === 'card' ? clip(g.title, LIMITS.labelLength) : undefined,
      columns: g.type === 'grid' ? clamp(Math.round(g.columns ?? 2), 2, 4) : undefined,
    }) as KalamLayoutNode;
  };
  const roots: KalamLayoutNode[] = [];
  const add = (n: KalamLayoutNode | undefined) => n && roots.push(n);
  for (const g of groups) if (!nested.has(g.id)) add(build(g, 1));
  // Groups no surviving group reached (a cycle, or a level cut for depth) stand on their own.
  for (const g of groups) if (!used.has(g.id)) add(build(g, 1));
  return roots.length ? roots : undefined;
}

/**
 * A 1.1 part whose required source or field did not resolve. It holds no data, so it is dropped
 * rather than failing the whole app (the same repair convertLayout applies to groups).
 */
function unresolved(c: KalamComponent, ctx: ConversionContext, form: string | undefined): boolean {
  const known = (col: string | undefined) => !!col && ctx.collections.ids().includes(col);
  const knownField = (col: string | undefined, f: string | undefined) => !!f && known(col) && !!ctx.fields.get(col as string)?.ids().includes(f);
  switch (c.type) {
    case 'chart': return !known(c.source);
    case 'reminder': return !knownField(c.source, c.dateField);
    // On a screen without a form a signature fills a field of its own, so only a form's fields are checked.
    case 'signature': return !c.field || (known(form) && !knownField(form, c.field));
    default: return false;
  }
}

export function convertScreen(s: IRScreen, ctx: ConversionContext): KalamScreen {
  const form = ctx.collections.resolve(s.form);
  const converted = s.components.map((c) => [c, convertComponent(c, ctx, form)] as const).filter(([, out]) => !unresolved(out, ctx, form));
  const children = converted.map(([, out]) => out);
  // Raw IR id → final component id, for this screen only (dropped parts are not placed).
  const componentIds = new Map<string, string>();
  for (const [c, out] of converted) {
    componentIds.set(c.id, out.id);
    componentIds.set(slugify(c.id), out.id);
  }
  return clean<KalamScreen>({
    id: ctx.allocated.get(s) ?? ctx.screens.resolve(s.id) ?? slugify(s.id, 'screen'),
    title: clip(s.title, LIMITS.nameLength) ?? humanize(s.id),
    description: clip(s.description, LIMITS.labelLength),
    form,
    children,
    layout: convertLayout(s.groups, componentIds),
  });
}

/** Counter/state targets resolve to a component id first, then to a form field. */
function resolveTarget(ctx: ConversionContext, raw: string | undefined) {
  return ctx.components.lookup(raw) ?? resolveAnyField(ctx, raw);
}

export function convertAction(a: IRAction, ctx: ConversionContext): KalamAction {
  const then = clean({
    speak: clip(a.thenSpeak, 200),
    navigate: ctx.screens.resolve(a.thenNavigate),
    feedback: clip(a.thenFeedback, 120),
  });
  const thenOpt = Object.keys(then).length ? then : undefined;
  const collection = ctx.collections.resolve(a.collection);
  let out: Record<string, unknown>;
  switch (a.type) {
    case 'navigate':
      out = { type: 'navigate', screen: ctx.screens.resolve(a.screen ?? a.thenNavigate) };
      break;
    case 'insert':
      out = { type: 'insert', collection, then: thenOpt };
      break;
    case 'update': {
      // Raw text values; completeSpec turns each into its field's type (it knows the fields).
      const set: Record<string, string> = {};
      for (const p of a.set ?? []) {
        const f = resolveField(ctx, collection, p.field);
        if (f) set[f] = p.value;
      }
      out = { type: 'update', collection, record: 'selected', set: Object.keys(set).length ? set : undefined, then: thenOpt };
      break;
    }
    case 'delete':
      out = { type: 'delete', collection, record: 'selected', confirm: clip(a.confirm, 160) ?? 'Delete this record?', then: thenOpt };
      break;
    case 'increment':
    case 'decrement':
      out = { type: a.type, target: resolveTarget(ctx, a.target), by: a.by };
      break;
    case 'reset':
      out = { type: 'reset', target: resolveTarget(ctx, a.target) };
      break;
    case 'runAI':
      out = { type: 'runAI', aiBlock: ctx.aiBlocks.resolve(a.aiBlock), then: thenOpt };
      break;
    case 'speak':
      out = { type: 'speak', text: clip(a.text ?? a.message, 300) };
      break;
    case 'feedback':
      out = { type: 'feedback', message: clip(a.message ?? a.text, 160), tone: a.tone };
      break;
    case 'clearForm':
      out = { type: 'clearForm' };
      break;
  }
  return clean(out) as KalamAction;
}

const DEFAULT_BLOCK_PROMPT: Record<IRAIBlock['kind'], string> = {
  extractFromPhoto: 'Read the photo and extract the requested fields.',
  classify: 'Classify the text into one of the labels.',
  summarise: 'Summarise the text briefly.',
  translate: 'Translate the text.',
};

export function convertAIBlock(b: IRAIBlock, ctx: ConversionContext): KalamAIBlock {
  const prompt = clip(b.prompt, LIMITS.promptLength) ?? DEFAULT_BLOCK_PROMPT[b.kind];
  const verified = 'unverified' as const;
  let out: Record<string, unknown>;
  switch (b.kind) {
    case 'extractFromPhoto': {
      const target = ctx.collections.resolve(b.target);
      const fields = dedupe((b.fields ?? []).map((f) => resolveField(ctx, target, f) ?? ''));
      out = { kind: 'extractFromPhoto', prompt, verified, target, fields: fields.length ? fields : undefined };
      break;
    }
    case 'classify':
      out = {
        kind: 'classify', prompt, verified, labels: dedupe(b.labels ?? []).slice(0, LIMITS.classifyLabels),
        inputField: resolveAnyField(ctx, b.inputField), outputField: resolveAnyField(ctx, b.outputField),
      };
      break;
    case 'summarise':
      out = {
        kind: 'summarise', prompt, verified, inputField: resolveAnyField(ctx, b.inputField),
        outputField: resolveAnyField(ctx, b.outputField), maxWords: clamp(Math.round(b.maxWords ?? 60), 10, 200),
      };
      break;
    case 'translate': {
      const lang = b.targetLang?.trim();
      out = {
        kind: 'translate', prompt, verified, inputField: resolveAnyField(ctx, b.inputField),
        outputField: resolveAnyField(ctx, b.outputField), targetLang: lang && LANG_RE.test(lang) ? lang : 'en',
      };
      break;
    }
  }
  return clean(out) as KalamAIBlock;
}

// ─── Whole-app conversion ─────────────────────────────────────────────────────
export interface ConvertOptions {
  appId: string;
  now: number;
  /** Fallback language when the IR has none (input language). */
  lang?: string;
  /** User preference wins over the model's preset choice. */
  themePreset?: ThemePreset;
  /** The person's currency preference; used when the model gives none (v1.1 settings.currency). */
  currency?: string;
  generator?: { route: 'deterministic' | 'on_device' | 'cloud'; provider?: string; model?: string };
}

/** Converts IR into a candidate KalamSpec. Run `validateSpec` on the result. */
export function irToSpec(ir: CompilerIR, opts: ConvertOptions): KalamSpec {
  const ctx = createConversionContext();
  const collections = ir.collections ?? [];
  const colIds = collections.map((c) => allocCollection(ctx, c));
  const screenIds = ir.screens.map((s) => allocScreen(ctx, s));
  const actionIds = (ir.actions ?? []).map((a) => ctx.actions.alloc(a.id));
  const blockIds = (ir.aiBlocks ?? []).map((b) => ctx.aiBlocks.alloc(b.id));

  const specCollections: Record<string, KalamCollection> = {};
  collections.forEach((c, i) => (specCollections[colIds[i]] = convertCollection(c, ctx, colIds[i])));
  const actions: Record<string, KalamAction> = {};
  (ir.actions ?? []).forEach((a, i) => (actions[actionIds[i]] = convertAction(a, ctx)));
  const aiBlocks: Record<string, KalamAIBlock> = {};
  (ir.aiBlocks ?? []).forEach((b, i) => (aiBlocks[blockIds[i]] = convertAIBlock(b, ctx)));

  // Intents are voice phrases only; ones pointing at unknown actions are dropped (harmless).
  const intents: Record<string, string[]> = {};
  for (const it of ir.intents ?? []) {
    const action = ctx.actions.lookup(it.action);
    if (!action) continue;
    intents[action] = dedupe([...(intents[action] ?? []), ...it.phrases.map((p) => p.slice(0, 60))])
      .slice(0, LIMITS.intentPhrasesPerAction);
  }

  const requestedInitial = ctx.screens.lookup(ir.initialScreen);
  const initialScreen = requestedInitial && screenIds.includes(requestedInitial) ? requestedInitial : (screenIds[0] ?? 'home');
  const preset = opts.themePreset ?? (THEME_PRESETS.includes(ir.themePreset as ThemePreset) ? (ir.themePreset as ThemePreset) : 'calm_green');
  const name = clip(ir.name, LIMITS.nameLength) ?? 'My app';
  const description = clip(ir.description, LIMITS.descriptionLength);
  const irLang = ir.lang?.trim();
  const lang = irLang && LANG_RE.test(irLang) ? irLang : opts.lang && LANG_RE.test(opts.lang) ? opts.lang : 'en';
  const glyph = ir.icon && ICON_GLYPHS.includes(ir.icon) ? ir.icon : pickGlyph(`${name} ${description ?? ''}`);
  const theme = themeFromPreset(preset);
  const screens = ir.screens.map((s) => convertScreen(s, ctx));
  // At most LIMITS.reminders reminders (the prompt says so); later ones are dropped, as above.
  let reminders = 0;
  for (const s of screens) {
    for (const c of [...s.children]) {
      if (c.type !== 'reminder' || ++reminders <= LIMITS.reminders) continue;
      s.children.splice(s.children.indexOf(c), 1);
      removeFromLayout(s, c.id);
    }
  }

  const spec = clean<KalamSpec>({
    id: opts.appId,
    schemaVersion: SCHEMA_VERSION,
    version: 1,
    name,
    description,
    icon: { glyph, background: theme.primary, foreground: '#FFFFFF' },
    lang,
    theme,
    collections: specCollections,
    screens,
    initialScreen,
    actions,
    aiBlocks,
    intents,
    meta: clean<KalamSpec['meta']>({
      createdAt: opts.now,
      description,
      source: 'compiler',
      generator: opts.generator
        ? clean({ route: opts.generator.route, provider: clip(opts.generator.provider, 40), model: clip(opts.generator.model, 80) })
        : undefined,
    }),
    ...convertSections(ir, opts),
  });
  // Permissions come from the components, never from the model, with fixed plain reasons.
  const permissions = requiredPermissions(spec).map((kind) => ({ kind, reason: PERMISSION_REASON[kind] }));
  if (permissions.length) spec.permissions = permissions;
  // The app's currency fills money stats that name none, so the runtime never falls back to a guess.
  const currency = spec.settings?.currency;
  if (currency) {
    for (const s of spec.screens) for (const c of s.children) if (c.type === 'stat' && c.format === 'currency' && !c.currency) c.currency = currency;
  }
  // Links and signatures hold values only Kalam's own controls write: a reminder never names an
  // entry by one (it would print a hidden code) and an AI step never fills one.
  for (const s of spec.screens) {
    for (const c of s.children) {
      if (c.type !== 'reminder' || !c.titleField) continue;
      const fields = Object.hasOwn(spec.collections, c.source) ? spec.collections[c.source].fields : {};
      const f = Object.hasOwn(fields, c.titleField) ? fields[c.titleField] : undefined;
      if (!f || (f.type !== 'text' && f.type !== 'enum') || isMachineField(spec, c.source, c.titleField)) delete c.titleField;
    }
  }
  for (const b of Object.values(spec.aiBlocks)) {
    if (b.kind !== 'extractFromPhoto' || !b.fields) continue;
    const kept = b.fields.filter((f) => !isMachineField(spec, b.target, f));
    if (kept.length) b.fields = kept; // all of them machine fields: left for the validator to report
  }
  return spec;
}

/** v1.1 sections with safe defaults. A section with nothing valid left is left out. */
function convertSections(ir: CompilerIR, opts: ConvertOptions): Pick<KalamSpec, 'settings' | 'accessibility' | 'localization'> {
  const currency = (ir.settings?.currency ?? opts.currency)?.trim().toUpperCase();
  const settings = clean({
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    timeFormat: ir.settings?.timeFormat,
  });
  const modes = dedupe(ir.accessibility?.suggestedModes ?? []) as NonNullable<KalamSpec['accessibility']>['suggestedModes'];
  const accessibility = clean({ summary: clip(ir.accessibility?.summary, 300), suggestedModes: modes?.length ? modes : undefined });
  const seen = new Set<string>();
  const terminology: NonNullable<NonNullable<KalamSpec['localization']>['terminology']> = [];
  for (const t of ir.terminology ?? []) {
    const term = clip(t.term, 60);
    if (!term || seen.has(term.toLocaleLowerCase()) || terminology.length >= LIMITS.terminology) continue;
    const translations: Record<string, string> = {};
    for (const tr of t.translations ?? []) {
      const lang = tr.lang.trim();
      const text = clip(tr.text, 60);
      if (LANG_RE.test(lang) && text && Object.keys(translations).length < 12) translations[lang] = text;
    }
    const hasTr = Object.keys(translations).length > 0;
    // `keep` wins when the model gave both; a term with no rule says nothing and is dropped.
    if (!t.keep && !hasTr) continue;
    seen.add(term.toLocaleLowerCase());
    terminology.push(t.keep ? { term, keep: true } : { term, translations });
  }
  return clean({
    settings: Object.keys(settings).length ? settings : undefined,
    accessibility: Object.keys(accessibility).length ? accessibility : undefined,
    localization: terminology.length ? { terminology } : undefined,
  });
}
