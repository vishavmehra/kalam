/**
 * Deterministic repair of a compiled app (eval 2026-11-25). Runs on the candidate spec after
 * irToSpec and before validateSpec, with no model call, and fixes what made valid apps wrong:
 *
 * 1. Entries that belong to a person or thing (credit to a customer, fees to a student) get a link
 *    (KalamSpec 1.1 relation) and the parent's page lists and totals only its own entries (`selected`).
 *    Repayments subtract from the balance.
 * 2. Every saved field can be seen again: a list opens a detail screen that shows every field.
 * 3. A "Mark done" style button writes a fixed value instead of saving nothing.
 * 4. "This week", "this month", "today" and "streak" stats really look at that period.
 * 5. Unused collections and AI steps are removed. Money uses the person's currency, else INR.
 *
 * Each change is a plain note. The caller validates the result and keeps the unrepaired candidate
 * when the repair would make it worse, so this can never turn a valid app into an invalid one.
 */
import { formulaDependencies } from '../formula';
import {
  LIMITS, type KalamCollection, type KalamComponent, type KalamField, type KalamScreen, type KalamSpec,
} from '../spec/schema';
import { detailMissing, setValueFits, shownFields, writtenField } from '../spec/validate-quality';
import { CURRENCY_SYMBOLS, extractCurrency, type CurrencyCode } from '../templates/extract';
import { humanize, slugify } from './convert';

export interface CompleteOptions {
  /** Everything the person typed, said or wrote on the sketch. Used for currency, photos and periods. */
  request: string;
  /** The person's currency setting. */
  currency?: string;
}

export interface CompleteResult {
  spec: KalamSpec;
  notes: string[];
}

const own = (o: object, k: string | undefined): boolean => k !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const lc = (s: string | undefined) => (s ?? '').toLowerCase();

/**
 * People who own entries, with the words that name the same people. A field named after one
 * (attendance.worker_name) with no collection for them gets one only when the request asks for them
 * ("each customer", "employees", "monthly summary" of employees) or two collections name them, so a
 * booking's "Client name" stays text (s20). Things (goal, room) get one only when the person asks to add
 * them ("New goal", "Add room"); otherwise both link only to a collection that exists.
 */
const PEOPLE_GROUPS = [
  ['customer', 'client', 'grahak', 'party', 'buyer'], ['worker', 'employee', 'staff', 'labour', 'karigar'],
  ['student', 'pupil'], ['patient'], ['member'], ['supplier', 'vendor'], ['doctor'], ['teacher', 'tutor'], ['tenant'],
];
const PEOPLE = PEOPLE_GROUPS.flat();
const THINGS = [
  'goal', 'room', 'project', 'class', 'batch', 'course', 'subject', 'branch', 'site', 'vehicle', 'property', 'flat',
  'shop', 'store', 'plant', 'pet', 'account', 'event', 'trip', 'team', 'habit',
];
/** Words for per-person totals in a request ("monthly summary", "khata"). */
const PER_PERSON = /\b(?:summary|report|totals?|balance|hisa+b|khata|ledger)\b/;
/** Names a collection of payments or money in, for the "Paid" label. */
const PAYMENT_WORDS = /pay|paid|receiv|repa|return|wapas|jama|got|collected|deposit|settle/;
/** A field or option that marks a repayment entry: money coming back, taken off the balance. */
const REPAYMENT = /\bis_payment\b|\bpayment\b|receiv|repa(?:y|id)|\breturn|wapas|jama|\bgot\b|collected|deposit/;
/** A field or option that marks an entry as settled ("paid"): it is owed until then, never taken off. */
const SETTLED = /(?:\b|_)(?:paid|settled|cleared|chukaya)\b|payment[ _](?:done|made)/;
const CREDIT_WORDS = /credit|udhaar|udhar|given|gave|diya|lent|due|loan|sale|bill|charge|fee/;
/** A stat label about what is still owed. */
const OWED = /udhaar|udhar|balance|baaki|baki|bakaya|outstanding|pending|due|owed/;
const MONEY_FIELD = /amount|price|fee|paid|payment|cost|total|balance|udhaar|udhar|rupee|money|salary|rent|due/;

function singular(id: string): string {
  if (/ies$/.test(id)) return `${id.slice(0, -3)}y`;
  if (/(ss|us)$/.test(id)) return id;
  if (/(ch|sh|x|ss)es$/.test(id)) return id.slice(0, -2);
  return id.replace(/s$/, '');
}

class Ids {
  private readonly used: Set<string>;
  constructor(ids: Iterable<string>) {
    this.used = new Set(ids);
  }
  take(base: string): string {
    const b = base.slice(0, 44).replace(/_+$/, '') || 'item';
    let id = b;
    for (let n = 2; this.used.has(id); n++) id = `${b}_${n}`;
    this.used.add(id);
    return id;
  }
}

/** Replaces identifier `name` outside quoted strings. */
function replaceIdent(expr: string, name: string, by: string): string {
  return expr
    .split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/)
    .map((part, i) => (i % 2 ? part : part.replace(new RegExp(`\\b${name}\\b(?!\\s*\\()`, 'g'), by)))
    .join('');
}

const fits = (expr: string) => expr.length <= LIMITS.formulaLength;

export function completeSpec(input: KalamSpec, opts: CompleteOptions): CompleteResult {
  const spec = structuredClone(input) as KalamSpec;
  const notes: string[] = [];
  const request = lc(opts.request);
  const screens = () => spec.screens;
  const screenById = (id: string | undefined) => spec.screens.find((s) => s.id === id);
  const compIds = new Ids(spec.screens.flatMap((s) => s.children.map((c) => c.id)));
  const screenIds = new Ids(spec.screens.map((s) => s.id));
  const actionIds = new Ids(Object.keys(spec.actions));
  const col = (id: string | undefined): KalamCollection | undefined => (own(spec.collections, id) ? spec.collections[id as string] : undefined);
  const label = (cid: string) => col(cid)?.label || humanize(cid);
  const room = () => spec.screens.length < LIMITS.screens;

  // ── Shared builders ─────────────────────────────────────────────────────────
  const displayField = (cid: string): string | undefined => {
    const fields = Object.entries(col(cid)?.fields ?? {});
    return (
      fields.find(([id, f]) => f.type === 'text' && !f.ref && /name|title/.test(id))?.[0] ??
      fields.find(([, f]) => f.type === 'text' && !f.ref)?.[0] ??
      fields.find(([, f]) => f.type !== 'boolean' && f.type !== 'image' && !(f.type === 'text' && f.ref))?.[0]
    );
  };
  const inputFor = (fid: string, f: KalamField): KalamComponent => {
    const id = compIds.take(`${fid}_input`);
    const base = { id, label: f.label, field: fid };
    switch (f.type) {
      case 'number': return { ...base, type: 'number' };
      case 'date': return { ...base, type: 'date' };
      case 'enum': return { ...base, type: 'choice' };
      case 'boolean': return { ...base, type: 'toggle' };
      case 'image': return { id, type: 'photo', label: f.label, field: fid };
      case 'text': return { ...base, type: 'textInput', ...(f.multiline ? { multiline: true } : {}) };
    }
  };
  /** Inserts components above the first button, so Save stays at the bottom. */
  const insertAbove = (s: KalamScreen, comps: KalamComponent[]) => {
    const room2 = LIMITS.componentsPerScreen - s.children.length;
    const add = comps.slice(0, Math.max(0, room2));
    const at = s.children.findIndex((c) => c.type === 'bigButton');
    s.children.splice(at < 0 ? s.children.length : at, 0, ...add);
    return add.length;
  };
  /** Puts components at the top of a screen, below its leading heading and text, so the title stays first. */
  const atTop = (s: KalamScreen, comps: KalamComponent[]) => {
    let at = 0;
    while (at < s.children.length && (s.children[at].type === 'heading' || s.children[at].type === 'text')) at++;
    s.children.splice(at, 0, ...comps);
  };
  const addButton = (s: KalamScreen, text: string, action: string, tone?: 'primary' | 'secondary' | 'danger') => {
    if (s.children.length >= LIMITS.componentsPerScreen) return;
    s.children.push({ id: compIds.take(`${action}_button`), type: 'bigButton', label: text, action, ...(tone ? { tone } : {}) });
  };
  const navAction = (screen: string): string => {
    const hit = Object.entries(spec.actions).find(([, a]) => a.type === 'navigate' && a.screen === screen);
    if (hit) return hit[0];
    const id = actionIds.take(`go_${screen}`);
    spec.actions[id] = { type: 'navigate', screen };
    return id;
  };
  const crud = (cid: string, kind: 'insert' | 'update' | 'delete', back: string): string => {
    const hit = Object.entries(spec.actions).find(([, a]) => a.type === kind && a.collection === cid && !(a.type === 'update' && a.set));
    if (hit) return hit[0];
    const noun = singular(label(cid)).toLowerCase();
    const id = actionIds.take(`${kind}_${singular(cid)}`);
    if (kind === 'insert') spec.actions[id] = { type: 'insert', collection: cid, then: { feedback: 'Saved', navigate: back } };
    else if (kind === 'update') spec.actions[id] = { type: 'update', collection: cid, record: 'selected', then: { feedback: 'Changes saved', navigate: back } };
    else spec.actions[id] = { type: 'delete', collection: cid, record: 'selected', confirm: `Delete this ${noun}? This cannot be undone.`, then: { navigate: back } };
    return id;
  };
  const listsOf = (cid: string) => spec.screens.flatMap((s) => s.children.filter((c): c is Extract<KalamComponent, { type: 'list' }> => c.type === 'list' && c.source === cid).map((c) => ({ s, c })));
  /** Screen with form = cid and a Save (insert) button. */
  const addScreenOf = (cid: string) =>
    spec.screens.find((s) => s.form === cid && s.children.some((c) => c.type === 'bigButton' && spec.actions[c.action]?.type === 'insert'));
  /** A detail screen (form = cid) showing every field, with Save changes, Delete and Back. */
  const makeDetailScreen = (cid: string, back: string, skip: ReadonlySet<string> = new Set()): KalamScreen | undefined => {
    if (!room()) return undefined;
    const c = col(cid);
    if (!c) return undefined;
    const id = screenIds.take(`${singular(cid)}_details`);
    const s: KalamScreen = { id, title: singular(label(cid)).slice(0, LIMITS.nameLength), form: cid, children: [] };
    s.children.push(...Object.entries(c.fields).filter(([fid]) => !skip.has(fid)).map(([fid, f]) => inputFor(fid, f)));
    spec.screens.push(s);
    addButton(s, 'Save changes', crud(cid, 'update', back), 'primary');
    addButton(s, 'Delete', crud(cid, 'delete', back), 'danger');
    addButton(s, 'Back', navAction(back), 'secondary');
    return s;
  };
  const home = () => screenById(spec.initialScreen) ?? spec.screens[0];
  /** A button that saves what the screen's inputs changed (an update without fixed values). */
  const savesEdits = (s: KalamScreen) =>
    s.children.some((c) => c.type === 'bigButton' && [spec.actions[c.action]].some((a) => a?.type === 'update' && !a.set));

  // ── 0. Fixed values arrive as text: give each its field's type ───────────────
  for (const [aid, a] of Object.entries(spec.actions)) {
    if (a.type !== 'update' || !a.set) continue;
    const fields = col(a.collection)?.fields ?? {};
    const out: Record<string, string | number | boolean> = {};
    for (const [fid, raw] of Object.entries(a.set)) {
      const f = own(fields, fid) ? fields[fid] : undefined;
      const v = f ? coerceSet(f, raw) : undefined;
      if (v === undefined) notes.push(`actions.${aid}.set.${fid}: "${String(raw).slice(0, 40)}" does not fit, removed`);
      else out[fid] = v;
    }
    if (Object.keys(out).length) a.set = out;
    else delete a.set;
  }

  // ── 1. Links between entries and the people or things they belong to ────────
  const tick = habitHistory();
  const links = findLinks();
  let created = 0;
  for (const link of links) {
    if (link.createParent) {
      if (created >= 2 || !canLink(link) || Object.keys(spec.collections).length >= LIMITS.collections) continue;
      created++;
      spec.collections[link.parent] = { label: humanize(link.parent), fields: { name: { type: 'text', label: `${humanize(singular(link.parent))} name`, required: true } } };
      notes.push(`collections.${link.parent}: added so each ${singular(link.parent)} is typed once and has a page`);
    } else if (!canLink(link)) {
      // A link with no page to pick or add the parent on is worse than text (t18 at the 8-screen limit).
      notes.push(`collections.${link.child}.fields.${link.field}: kept as text, no room for a page per ${singular(label(link.parent)).toLowerCase()} (at most ${LIMITS.screens} screens)`);
      continue;
    }
    applyLink(link);
  }
  if (tick) addTick(tick.parent, tick.child);

  // ── 2. Buttons that would save nothing ──────────────────────────────────────
  fixNoOpButtons();

  // ── 3. Every saved field can be seen again, photos included ────────────────
  keepPhotos();
  showEveryField();

  // ── 4. Periods named in a stat's label, and a streak when one was asked for ─
  fixPeriods();
  addStreak();

  // ── 5. Dead parts and money ─────────────────────────────────────────────────
  removeUnused();
  fixCurrency();

  return { spec, notes };

  // ═══ Steps ══════════════════════════════════════════════════════════════════
  interface Link { child: string; parent: string; field: string; existing: boolean; createParent?: boolean }

  function findLinks(): Link[] {
    const out: Link[] = [];
    const seen = new Set<string>();
    const push = (l: Link) => {
      const key = `${l.child}>${l.parent}`;
      if (seen.has(key) || l.child === l.parent) return;
      seen.add(key);
      out.push(l);
    };
    const nounOf = (cid: string) => singular(cid).replace(/_list$/, '');
    // (a) A text field named after another collection: entries.customer_name → customers.
    for (const [cid, c] of Object.entries(spec.collections)) {
      for (const [fid, f] of Object.entries(c.fields)) {
        if (f.type !== 'text' || f.ref) continue;
        // An AI step that reads it from a photo can only write text, never pick a linked entry: keep it text.
        if (Object.values(spec.aiBlocks).some((b) => b.kind === 'extractFromPhoto' && b.target === cid && (!b.fields || b.fields.includes(fid)))) continue;
        const stem = fid.replace(/_(name|id|ka_naam)$/, '');
        const labelStem = lc(f.label).replace(/\s*(name|naam)$/, '').trim().replace(/\s+/g, '_');
        const parent = Object.keys(spec.collections).find((p) => p !== cid && [stem, labelStem].some((s) => s === nounOf(p) || s === p));
        if (parent) push({ child: cid, parent, field: fid, existing: true });
        else if ((PEOPLE.includes(stem) ? peopleAsked(stem) : THINGS.includes(stem) && new RegExp(`\\b(?:add|new|naya|nayi|create)\\s+(?:an?\\s+)?${stem}\\b`).test(request)) && Object.keys(c.fields).length > 2) {
          // No collection for them yet (attendance.worker_name, deposits.goal): make one, so names are typed once.
          const plural = /(s|sh|ch|x)$/.test(stem) ? `${stem}es` : `${stem}s`;
          push({ child: cid, parent: plural.replace(/ys$/, 'ies'), field: fid, existing: true, createParent: true });
        }
      }
    }
    // (b) A parent's page that lists or totals another collection's entries with no link at all (s07, s23).
    for (const s of spec.screens) {
      for (const c of s.children) {
        if (c.type !== 'list' || !c.detailScreen) continue;
        const detail = screenById(c.detailScreen);
        if (!detail || (detail.form && detail.form !== c.source)) continue;
        const used = new Set<string>();
        for (const k of detail.children) {
          if (k.type === 'list' && k.source !== c.source) used.add(k.source);
          if (k.type === 'stat') formulaDependencies(k.expr).collections.forEach((x) => x !== c.source && used.add(x));
        }
        for (const child of used) {
          const cc = col(child);
          if (!cc || Object.values(cc.fields).some((f) => f.type === 'text' && f.ref?.collection === c.source)) continue;
          if (out.some((l) => l.child === child && l.parent === c.source)) continue;
          const fid = singular(c.source);
          if (own(cc.fields, fid)) continue;
          push({ child, parent: c.source, field: fid, existing: false });
        }
      }
    }
    return out;
  }

  /** The request asks for a list of these people, totals per person, or two collections name them. */
  function peopleAsked(stem: string): boolean {
    const words = (PEOPLE_GROUPS.find((g) => g.includes(stem)) ?? [stem]).join('|');
    const listed = new RegExp(`\\b(?:(?:${words})e?s|(?:add|new|naya|nayi|create|each|every|per|har|all|list of)\\s+(?:an?\\s+)?(?:${words})|(?:${words})[- ]wise)\\b`);
    if (listed.test(request)) return true;
    if (new RegExp(`\\b(?:${words})\\b`).test(request) && PER_PERSON.test(request)) return true;
    const naming = Object.values(spec.collections).filter((c) => Object.keys(c.fields).some((f) => f.replace(/_(name|id|ka_naam)$/, '') === stem));
    return naming.length >= 2;
  }

  /** There is (or is room for) a list of the parents, a page per parent and a way to add one. */
  function canLink(l: Link): boolean {
    const exists = !!col(l.parent);
    const lists = exists ? listsOf(l.parent) : [];
    const page = lists.some(({ c }) => {
      const s = screenById(c.detailScreen);
      return !!s && (!s.form || s.form === l.parent);
    });
    const need = (page ? 0 : 1) + (exists && addScreenOf(l.parent) ? 0 : 1);
    if (spec.screens.length + need > LIMITS.screens) return false;
    return lists.length > 0 || ((!exists || !!displayField(l.parent)) && home().children.length < LIMITS.componentsPerScreen - 1);
  }

  /** One tap on a habit's page adds today's check-in, linked to that habit by the runtime (s21). */
  function addTick(parent: string, child: string): void {
    const page = listsOf(parent).map(({ c }) => screenById(c.detailScreen)).find((s): s is KalamScreen => !!s && s.form === parent);
    if (!page || page.children.length >= LIMITS.componentsPerScreen) return;
    const id = actionIds.take('done_today');
    spec.actions[id] = { type: 'insert', collection: child, then: { feedback: 'Done for today' } };
    const at = page.children.findIndex((c) => c.type === 'bigButton');
    page.children.splice(at < 0 ? page.children.length : at, 0, { id: compIds.take('done_today_button'), type: 'bigButton', label: 'Done today', action: id, tone: 'primary' });
    notes.push(`screens.${page.id}: "Done today" adds today's check-in in one tap`);
  }

  function applyLink(l: Link): void {
    const child = col(l.child);
    const parent = col(l.parent);
    if (!child || !parent) return;
    const display = displayField(l.parent);
    const parentNoun = singular(label(l.parent)).toLowerCase();
    if (l.existing) {
      const old = child.fields[l.field];
      child.fields[l.field] = { type: 'text', label: old.label, ...(old.required ? { required: true } : {}), ref: { collection: l.parent, ...(display ? { display } : {}) } };
      notes.push(`collections.${l.child}.fields.${l.field}: now links each entry to one of ${label(l.parent)} instead of free text`);
    } else {
      if (Object.keys(child.fields).length >= LIMITS.fieldsPerCollection) return;
      child.fields[l.field] = { type: 'text', label: humanize(l.field), ref: { collection: l.parent, ...(display ? { display } : {}) } };
      notes.push(`collections.${l.child}.fields.${l.field}: added so each entry belongs to one ${parentNoun}`);
    }
    // A link holds an entry's id, so sorting by it means nothing: newest first instead.
    for (const { c } of listsOf(l.child)) {
      if (c.sort?.field !== l.field) continue;
      const d = dateField(l.child);
      if (d) c.sort = { field: d, direction: 'desc' };
      else delete c.sort;
    }
    // Formulas that matched the parent by its name now match the opened entry.
    for (const s of screens()) {
      for (const c of s.children) {
        const fix = (e: string) => e
          .replace(new RegExp(`\\b${l.field}\\s*===?\\s*form\\.[a-z0-9_]+`, 'g'), `${l.field} == selected`)
          .replace(new RegExp(`form\\.[a-z0-9_]+\\s*===?\\s*${l.field}\\b`, 'g'), `${l.field} == selected`);
        if (c.type === 'stat') c.expr = fix(c.expr);
        if (c.type === 'list' && c.filter) c.filter = fix(c.filter);
      }
    }
    // A list of a parent's entries never shows a raw link: show the parent's name only where it adds something.
    const h = home();
    // The parent is typed once: an add screen and a list on the start screen.
    let add = addScreenOf(l.parent);
    if (!add && room()) {
      const id = screenIds.take(`new_${singular(l.parent)}`);
      add = { id, title: `New ${parentNoun}`.slice(0, LIMITS.nameLength), form: l.parent, children: Object.entries(parent.fields).map(([fid, f]) => inputFor(fid, f)) };
      spec.screens.push(add);
      addButton(add, 'Save', crud(l.parent, 'insert', h.id), 'primary');
      addButton(add, 'Back', navAction(h.id), 'secondary');
      relabelMisnamed(h, parentNoun, l.parent);
      addButton(h, `New ${parentNoun}`, navAction(id), 'secondary');
      notes.push(`screens.${id}: added so ${label(l.parent).toLowerCase()} can be added`);
    }
    let lists = listsOf(l.parent);
    if (!lists.length && display && h.children.length < LIMITS.componentsPerScreen) {
      const list: KalamComponent = { id: compIds.take(`${l.parent}_list`), type: 'list', label: label(l.parent), source: l.parent, primary: display, emptyText: `No ${label(l.parent).toLowerCase()} yet.` };
      insertAbove(h, [list]);
      notes.push(`screens.${h.id}: added a list of ${label(l.parent).toLowerCase()}`);
      lists = listsOf(l.parent);
    }
    // The parent's page.
    let page = lists.map(({ c }) => screenById(c.detailScreen)).find((s): s is KalamScreen => !!s && (!s.form || s.form === l.parent));
    if (page && !page.form) page.form = l.parent;
    if (!page) {
      page = makeDetailScreen(l.parent, lists[0]?.s.id ?? h.id);
      if (!page) {
        notes.push(`${label(l.parent)}: no room for a page per ${parentNoun} (at most ${LIMITS.screens} screens)`);
        return;
      }
      notes.push(`screens.${page.id}: added a page for each ${parentNoun}`);
    }
    for (const { c } of lists) if (!c.detailScreen) c.detailScreen = page.id;
    // The page shows who it is about (the inputs are filled from the opened entry) and can save changes to it.
    const pageRef = page;
    const missing = Object.entries(parent.fields).filter(([fid]) => !pageRef.children.some((c) => writtenField(c) === fid));
    if (missing.length) {
      const room3 = LIMITS.componentsPerScreen - page.children.length;
      atTop(page, missing.slice(0, Math.max(0, room3)).map(([fid, f]) => inputFor(fid, f)));
      if (!savesEdits(page)) {
        addButton(page, 'Save changes', crud(l.parent, 'update', lists[0]?.s.id ?? h.id), 'secondary');
      }
    }
    const where = `${l.field} == selected`;
    // Its own entries only.
    let childList = page.children.find((c) => c.type === 'list' && c.source === l.child);
    if (childList && childList.type === 'list') {
      if (!/\bselected\b/.test(childList.filter ?? '')) childList.filter = childList.filter ? `(${childList.filter}) && ${where}` : where;
    } else {
      const shownChild = Object.entries(child.fields).filter(([fid, f]) => fid !== l.field && f.type !== 'image' && !(f.type === 'text' && f.ref));
      const primary = shownChild.find(([, f]) => f.type === 'text')?.[0] ?? shownChild[0]?.[0];
      const second = shownChild.find(([fid, f]) => fid !== primary && (f.type === 'number' || f.type === 'date'))?.[0];
      if (primary) {
        childList = { id: compIds.take(`${l.child}_list`), type: 'list', label: label(l.child), source: l.child, primary, ...(second ? { secondary: second } : {}), filter: where, emptyText: 'Nothing yet.' };
        insertAbove(page, [childList]);
      }
    }
    if (childList?.type === 'list' && childList.filter && !fits(childList.filter)) childList.filter = where;
    // Totals on the page count this parent's entries only.
    for (const c of page.children) {
      if (c.type !== 'stat' || /\bselected\b/.test(c.expr) || !formulaDependencies(c.expr).collections.includes(l.child)) continue;
      const next = replaceIdent(c.expr, l.child, `filter(${l.child}, ${where})`);
      if (fits(next)) c.expr = next;
    }
    addBalance(l, page);
    // A way to add an entry from the parent's page; the runtime links it to the opened parent.
    const childAdd = addScreenOf(l.child);
    if (childAdd) {
      const reaches = page.children.some((c) => c.type === 'bigButton' && [spec.actions[c.action]].some((a) => a?.type === 'navigate' && a.screen === childAdd.id));
      if (!reaches) addButton(page, `Add ${singular(label(l.child)).toLowerCase()}`, navAction(childAdd.id), 'primary');
      if (!childAdd.children.some((c) => writtenField(c) === l.field)) {
        atTop(childAdd, [{ id: compIds.take(`${l.field}_input`), type: 'textInput', label: child.fields[l.field].label, field: l.field }]);
      }
      // Opened only from the parent's page: saving goes back there, not to the start screen.
      const ways = spec.screens.filter((s) => s.children.some((c) => c.type === 'bigButton' && spec.actions[c.action]?.type === 'navigate' && (spec.actions[c.action] as { screen: string }).screen === childAdd.id));
      if (ways.length && ways.every((s) => s.id === pageRef.id)) {
        for (const c of childAdd.children) {
          const a = c.type === 'bigButton' ? spec.actions[c.action] : undefined;
          if (a?.type === 'insert' && a.collection === l.child && a.then?.navigate !== pageRef.id) a.then = { ...(a.then ?? {}), navigate: pageRef.id };
        }
      }
    }
  }

  /**
   * The model's "New goal" button that opens the screen for adding money is renamed after the screen it opens
   * ("Add money"), or dropped when another button already opens that screen, so the new parent's button is the
   * only "New goal" (s22, s19).
   */
  function relabelMisnamed(s: KalamScreen, noun: string, parent: string): void {
    const names = new RegExp(`\\b(?:new|add|naya|nayi|create)\\b.*\\b${noun.replace(/[^a-z0-9 ]/g, '')}s?\\b`);
    const opens = (c: KalamComponent) => {
      const a = c.type === 'bigButton' ? spec.actions[c.action] : undefined;
      return a?.type === 'navigate' ? screenById(a.screen) : undefined;
    };
    for (const c of [...s.children]) {
      const target = opens(c);
      if (c.type !== 'bigButton' || !names.test(lc(c.label)) || !target || target.form === parent) continue;
      const twin = s.children.some((k) => k !== c && opens(k) === target);
      if (twin) {
        s.children.splice(s.children.indexOf(c), 1);
        notes.push(`screens.${s.id}: removed "${c.label}", it opened "${target.title}" and another button already does`);
      } else {
        notes.push(`screens.${s.id}: "${c.label}" renamed "${target.title}", the screen it opens`);
        c.label = target.title.slice(0, LIMITS.labelLength);
      }
    }
  }

  /** Without money: how many entries each parent has, by status this month when there is one (t17). */
  function addCounts(l: Link, page: KalamScreen): void {
    const fields = col(l.child)?.fields ?? {};
    const where = `${l.field} == selected`;
    const status = Object.entries(fields).find(([, f]) => f.type === 'enum' && f.options.length <= 5);
    const date = dateField(l.child);
    const stats: KalamComponent[] = [];
    if (status && status[1].type === 'enum' && date) {
      for (const o of status[1].options.slice(0, 4)) {
        const expr = `count(filter(${l.child}, ${where} && month(${date}) == month(today) && ${status[0]} == '${o.replace(/'/g, '')}'))`;
        if (fits(expr)) stats.push({ id: compIds.take(`${singular(l.parent)}_${status[0]}_count`), type: 'stat', label: `${o} this month`.slice(0, LIMITS.labelLength), expr, format: 'integer' });
      }
    } else {
      stats.push({ id: compIds.take(`${singular(l.parent)}_entries`), type: 'stat', label: label(l.child), expr: `count(filter(${l.child}, ${where}))`, format: 'integer' });
    }
    if (page.children.some((c) => c.type === 'stat' && /\bselected\b/.test(c.expr))) return;
    const n = Math.min(stats.length, LIMITS.componentsPerScreen - page.children.length);
    if (n > 0) {
      atTop(page, stats.slice(0, n));
      notes.push(`screens.${page.id}: added totals for each ${singular(label(l.parent)).toLowerCase()}`);
    }
  }

  /** Per-parent balance where money is involved; repayments subtract (mx04). */
  function addBalance(l: Link, page: KalamScreen): void {
    const fields = col(l.child)?.fields ?? {};
    const amount = Object.entries(fields).find(([fid, f]) => f.type === 'number' && MONEY_FIELD.test(`${fid} ${lc(f.label)}`))?.[0];
    if (!amount) return addCounts(l, page);
    const where = `${l.field} == selected`;
    let credit: string | undefined;
    let payment: string | undefined;
    /** Entries still owed when the field marks an entry settled ("paid"), not a repayment. */
    let unsettled: string | undefined;
    const quote = (o: string) => `'${o.replace(/'/g, '')}'`;
    for (const [fid, f] of Object.entries(fields)) {
      const words = `${fid} ${lc(f.label)}`;
      if (f.type === 'boolean') {
        if (SETTLED.test(words)) unsettled ??= `${fid} != true`;
        else if (REPAYMENT.test(words)) {
          payment = `${fid} == true`;
          credit = `${fid} != true`;
          break;
        }
      }
      if (f.type === 'enum' && f.options.length >= 2) {
        const pay = f.options.find((o) => REPAYMENT.test(lc(o)) && !SETTLED.test(lc(o)) && !CREDIT_WORDS.test(lc(o).replace(/\(.*\)/, '')));
        if (pay) {
          payment = `${fid} == ${quote(pay)}`;
          credit = `${fid} != ${quote(pay)}`;
          break;
        }
        const settled = f.options.find((o) => SETTLED.test(lc(o)));
        if (settled) unsettled ??= `${fid} != ${quote(settled)}`;
      }
    }
    if (credit && payment) unsettled = undefined;
    shopWideBalance(l.child, amount, page, credit && payment ? { credit, payment } : undefined, unsettled);
    const parentTotal = Object.entries(col(l.parent)?.fields ?? {}).find(([fid, f]) => f.type === 'number' && /fee|total|due|amount|price/.test(fid))?.[0];
    const paidExpr = `sum(filter(${l.child}, ${where}${payment ? ` && ${payment}` : ''}).${amount})`;
    let expr: string | undefined;
    let text = 'Balance';
    if (credit && payment) expr = `sum(filter(${l.child}, ${where} && ${credit}).${amount}) - ${paidExpr}`;
    else if (unsettled) expr = `sum(filter(${l.child}, ${where} && ${unsettled}).${amount})`;
    else if (parentTotal && page.children.some((c) => writtenField(c) === parentTotal)) {
      expr = `form.${parentTotal} - ${paidExpr}`;
      text = 'Pending';
    }
    const stats = page.children.filter((c): c is Extract<KalamComponent, { type: 'stat' }> => c.type === 'stat');
    const named = stats.find((c) => /balance|baaki|baki|bakaya|outstanding|pending|due|udhaar|udhar|owed/.test(lc(c.label)));
    const money = { format: 'currency' as const };
    if (expr && fits(expr)) {
      if (named) {
        named.expr = expr;
        named.format = 'currency';
        notes.push(`screens.${page.id}: "${named.label}" now counts only this ${singular(label(l.parent)).toLowerCase()}'s entries${payment ? ', with payments taken off' : ''}`);
      } else if (page.children.length < LIMITS.componentsPerScreen) {
        atTop(page, [{ id: compIds.take(`${singular(l.parent)}_${text.toLowerCase()}`), type: 'stat', label: text, expr, ...money }]);
        notes.push(`screens.${page.id}: added a ${text.toLowerCase()} for each ${singular(label(l.parent)).toLowerCase()}`);
      }
    }
    if (!stats.some((c) => c.expr === paidExpr) && !credit && page.children.length < LIMITS.componentsPerScreen && fits(paidExpr)) {
      const paid = PAYMENT_WORDS.test(`${l.child} ${lc(label(l.child))}`) || text === 'Pending';
      const total = `Total ${lc(fields[amount].label)}`.slice(0, LIMITS.labelLength);
      atTop(page, [{ id: compIds.take(`${singular(l.parent)}_total`), type: 'stat', label: paid ? 'Paid' : total, expr: paidExpr, ...money }]);
    }
  }

  /**
   * Shop-wide totals of what is owed ("Total udhaar" on the start screen) take repayments off too, or leave
   * settled entries out, the same way each parent's balance does (mx04).
   */
  function shopWideBalance(
    child: string, amount: string, page: KalamScreen, marks: { credit: string; payment: string } | undefined, unsettled: string | undefined,
  ): void {
    const owed = marks
      ? `(sum(filter(${child}, ${marks.credit}).${amount}) - sum(filter(${child}, ${marks.payment}).${amount}))`
      : unsettled ? `sum(filter(${child}, ${unsettled}).${amount})` : undefined;
    if (!owed) return;
    const plain = new RegExp(`\\bsum\\(\\s*${child}\\.${amount}\\s*\\)`, 'g');
    // A total that already reads the marker (s07: "sum(entries.amount) - ... is_payment ...") is left alone.
    const marker = new RegExp(`\\b${(marks?.payment ?? unsettled ?? '').split(' ')[0]}\\b`);
    for (const s of screens()) {
      if (s === page) continue;
      for (const c of s.children) {
        if (c.type !== 'stat' || /\bselected\b/.test(c.expr) || marker.test(c.expr) || !OWED.test(lc(c.label))) continue;
        const next = c.expr.replace(plain, owed);
        if (next === c.expr || !fits(next)) continue;
        c.expr = next;
        notes.push(`screens.${s.id}: "${c.label}" now ${marks ? 'takes payments off' : 'counts only what is not yet paid'}`);
      }
    }
  }

  function fixNoOpButtons(): void {
    for (const s of screens()) {
      for (const c of s.children) {
        if (c.type !== 'bigButton') continue;
        const a = spec.actions[c.action];
        if (!a) continue;
        const word = lc(c.label);
        // "Cancel" that deletes an appointment it should only mark (s20).
        if (a.type === 'delete' && /cancel/.test(word)) {
          const target = markTarget(a.collection, 'cancel');
          if (target) {
            const id = actionIds.take(`${c.action}_mark`);
            spec.actions[id] = { type: 'update', collection: a.collection, record: 'selected', set: { [target.field]: target.value }, then: { feedback: `${target.text}`, navigate: a.then?.navigate ?? navBack(s) } };
            replaceAction(c, id);
            notes.push(`screens.${s.id}: "${c.label}" now marks the entry ${String(target.value).toLowerCase()} instead of deleting it`);
          }
          continue;
        }
        if (a.type !== 'update' || (a.set && Object.keys(a.set).length)) continue;
        const edits = s.form === a.collection && s.children.some((k) => !!writtenField(k));
        if (edits) continue;
        const kind = /cancel/.test(word) ? 'cancel' : /paid|pay|jama/.test(word) ? 'paid' : 'done';
        // Only a button that names a state writes one; a plain "Save changes" gets inputs instead.
        const marks = /cancel|done|complete|finish|mark|close|deliver|ho gaya|paid|pay\b|jama|attended|seen/.test(word);
        let target = marks ? markTarget(a.collection, kind) : undefined;
        const fields = col(a.collection)?.fields;
        if (!target && marks && fields && /done|complete|finish|mark|close|deliver|ho gaya|paid/.test(word) && !own(fields, 'done')) {
          fields.done = { type: 'boolean', label: 'Done', defaultValue: false };
          target = { field: 'done', value: true, text: 'Marked done' };
          notes.push(`collections.${a.collection}.fields.done: added so "${c.label}" has something to save`);
        }
        if (target) {
          const id = actionIds.take(`${c.action}_set`);
          spec.actions[id] = { type: 'update', collection: a.collection, record: 'selected', set: { [target.field]: target.value }, then: { ...(a.then ?? {}), feedback: a.then?.feedback ?? target.text } };
          replaceAction(c, id);
          notes.push(`screens.${s.id}: "${c.label}" now sets ${target.field} to ${JSON.stringify(target.value)}`);
        } else if (s.form === a.collection || (!s.form && col(a.collection))) {
          // A plain "Save changes" with nothing to change: give the screen the inputs it edits.
          s.form = a.collection;
          const n = insertAbove(s, Object.entries(col(a.collection)?.fields ?? {}).map(([fid, f]) => inputFor(fid, f)));
          if (n) notes.push(`screens.${s.id}: added inputs so "${c.label}" saves the changes`);
        }
      }
    }
  }

  /** Points a button at a repaired action; the old one goes (with its voice phrases) once no button uses it. */
  function replaceAction(c: { action: string }, id: string): void {
    const old = c.action;
    c.action = id;
    if (spec.screens.some((s) => s.children.some((k) => k.type === 'bigButton' && k.action === old))) return;
    if (spec.intents[old]) spec.intents[id] = spec.intents[old];
    delete spec.intents[old];
    delete spec.actions[old];
  }

  function navBack(s: KalamScreen): string {
    const from = spec.screens.find((x) => x.children.some((c) => c.type === 'list' && c.detailScreen === s.id));
    return (from ?? home()).id;
  }

  /** The field and value a "done", "paid" or "cancel" button should write, if the collection has one. */
  function markTarget(cid: string, kind: 'done' | 'paid' | 'cancel'): { field: string; value: string | boolean; text: string } | undefined {
    const fields = col(cid)?.fields ?? {};
    const want = kind === 'cancel' ? /cancel/ : kind === 'paid' ? /paid|settled|received|jama/ : /done|complete|finish|deliver|closed|attended|seen/;
    for (const [fid, f] of Object.entries(fields)) {
      if (f.type === 'enum') {
        const o = f.options.find((x) => want.test(lc(x)));
        if (o) return { field: fid, value: o, text: `Marked ${o.toLowerCase()}` };
      }
    }
    if (kind === 'cancel') return undefined;
    const flag = Object.entries(fields).find(([fid, f]) => f.type === 'boolean' && (want.test(`${fid} ${lc(f.label)}`) || /status|done/.test(fid)));
    return flag ? { field: flag[0], value: true, text: kind === 'paid' ? 'Marked paid' : 'Marked done' } : undefined;
  }

  function showEveryField(): void {
    // An entry opened from a list shows every field its row does not, wherever else they are listed (s20 Details).
    for (const s of screens()) {
      for (const l of s.children) {
        if (l.type !== 'list' || !l.detailScreen) continue;
        const d = screenById(l.detailScreen);
        const fields = col(l.source)?.fields;
        if (!d || !fields) continue;
        const add = detailMissing(spec, l, d).map((fid) => inputFor(fid, fields[fid]));
        const n = insertAbove(d, add);
        if (!n) continue;
        notes.push(`screens.${d.id}: now shows ${add.slice(0, n).map((k) => `"${(k as { label: string }).label}"`).join(', ')}`);
        if (!savesEdits(d)) addButton(d, 'Save changes', crud(l.source, 'update', navBack(d)), 'primary');
      }
    }
    const shown = shownFields(spec);
    const entered = new Set(spec.screens.filter((s) => s.form).map((s) => s.form as string));
    for (const cid of Object.keys(spec.collections)) {
      if (!entered.has(cid)) continue;
      const c = col(cid) as KalamCollection;
      const hidden = Object.keys(c.fields).filter((fid) => !shown.get(cid)?.has(fid));
      if (!hidden.length) continue;
      const lists = listsOf(cid);
      let detail = lists.map(({ c: l }) => screenById(l.detailScreen)).find((s): s is KalamScreen => !!s && s.form === cid);
      if (!detail && lists.length) {
        detail = makeDetailScreen(cid, lists[0].s.id);
        if (detail) {
          for (const { c: l } of lists) if (!l.detailScreen) l.detailScreen = detail.id;
          notes.push(`screens.${detail.id}: added so every saved ${singular(label(cid)).toLowerCase()} detail can be seen and changed`);
          continue;
        }
        // No room for a screen: at least show a second field in the row.
        const l = lists[0].c;
        if (!l.secondary) l.secondary = hidden.find((f) => c.fields[f].type !== 'image');
        notes.push(`${label(cid)}: no room for a detail screen, so some fields are still not shown`);
        continue;
      }
      if (!detail) {
        // Entered but never listed: list it on the start screen with a detail screen.
        const h = home();
        const primary = displayField(cid);
        if (!primary || h.children.length >= LIMITS.componentsPerScreen) continue;
        const d = makeDetailScreen(cid, h.id);
        insertAbove(h, [{ id: compIds.take(`${cid}_list`), type: 'list', label: label(cid), source: cid, primary, ...(d ? { detailScreen: d.id } : {}), emptyText: 'Nothing saved yet.' }]);
        notes.push(`screens.${h.id}: added a list of ${label(cid).toLowerCase()} so saved entries can be seen`);
        continue;
      }
      const add = hidden.filter((fid) => !detail.children.some((k) => writtenField(k) === fid)).map((fid) => inputFor(fid, c.fields[fid]));
      const n = insertAbove(detail, add);
      if (n) notes.push(`screens.${detail.id}: now shows ${add.slice(0, n).map((k) => `"${(k as { label: string }).label}"`).join(', ')}`);
      if (n && !savesEdits(detail)) {
        addButton(detail, 'Save changes', crud(cid, 'update', navBack(detail)), 'primary');
      }
    }
  }

  function fixPeriods(): void {
    const PERIODS: Array<[RegExp, (d: string) => string, string]> = [
      [/\bthis week\b|\bweekly\b|\bper week\b|is hafte|हफ्ते|सप्ताह/, (d) => `week(${d}) == week(today)`, 'this week'],
      [/\bthis month\b|\bmonthly\b|is mahine|महीने/, (d) => `month(${d}) == month(today)`, 'this month'],
      [/\btoday\b|\baaj\b|आज/, (d) => `${d} == today`, 'today'],
    ];
    for (const s of screens()) {
      for (const c of s.children) {
        if (c.type !== 'stat') continue;
        const name = lc(c.label);
        if (/streak|in a row|lagatar/.test(name) && !/\bstreak\(/.test(c.expr)) {
          const cid = formulaDependencies(c.expr).collections.find((x) => col(x));
          const date = cid && dateField(cid);
          if (cid && date) {
            const flag = Object.entries(col(cid)?.fields ?? {}).find(([, f]) => f.type === 'boolean')?.[0];
            const src = flag ? `filter(${cid}, ${flag} == true)` : cid;
            c.expr = `streak(${src}.${date})`;
            c.format = 'integer';
            notes.push(`screens.${s.id}: "${c.label}" now counts days in a row`);
          }
          continue;
        }
        const period = PERIODS.find(([re]) => re.test(name));
        if (!period || /\bweek\(|\bmonth\(|==\s*today|today\s*==/.test(c.expr)) continue;
        const cids = formulaDependencies(c.expr).collections.filter((x) => col(x));
        let expr = c.expr;
        for (const cid of cids) {
          const date = dateField(cid);
          if (!date) continue;
          expr = replaceIdent(expr, cid, `filter(${cid}, ${period[1](date)})`);
        }
        if (expr !== c.expr && fits(expr)) {
          c.expr = expr;
          notes.push(`screens.${s.id}: "${c.label}" now counts only ${period[2]}`);
        }
      }
    }
  }

  /**
   * A habit kept as one "done today" flag has no history, so no streak and no week (s21): keep one dated
   * check-in per habit instead. findLinks then links each check-in to its habit and gives the habit a page,
   * and addTick puts a one-tap "Done today" on that page in place of the old tick.
   */
  function habitHistory(): { parent: string; child: string } | undefined {
    if (Object.keys(spec.collections).length >= LIMITS.collections || spec.screens.length > LIMITS.screens - 3) return undefined;
    for (const [hid, h] of Object.entries(spec.collections)) {
      if (dateField(hid) || !/habit|routine|aadat/.test(`${hid} ${lc(h.label)}`) || !listsOf(hid).length) continue;
      if (spec.screens.some((s) => s.form === hid && s.layout)) continue; // grouped inputs: leave the layout alone
      const flag = Object.entries(h.fields).find(([fid, f]) => f.type === 'boolean' && /today|aaj|done/.test(`${fid} ${lc(f.label)}`))?.[0];
      if (!flag) continue;
      const cid = new Ids(Object.keys(spec.collections)).take('checkins');
      const field = singular(hid);
      spec.collections[cid] = {
        label: 'Check-ins',
        fields: {
          [field]: { type: 'text', label: humanize(field), required: true },
          date: { type: 'date', label: 'Date', required: true, defaultValue: 'today' },
          done: { type: 'boolean', label: 'Done', defaultValue: true },
        },
      };
      const add: KalamScreen = {
        id: screenIds.take('check_in'), title: 'Check in', form: cid,
        children: Object.entries(spec.collections[cid].fields).map(([fid, f]) => inputFor(fid, f)),
      };
      spec.screens.push(add);
      addButton(add, 'Save', crud(cid, 'insert', home().id), 'primary');
      addButton(add, 'Back', navAction(home().id), 'secondary');
      // What read the flag now reads today's check-ins, and the flag goes.
      const usesFlag = new RegExp(`\\b${flag}\\b`);
      for (const s of screens()) {
        if (s.form === hid) s.children = s.children.filter((c) => writtenField(c) !== flag);
        for (const c of s.children) {
          if (c.type === 'stat' && usesFlag.test(c.expr)) c.expr = `count(filter(${cid}, date == today && done == true))`;
          if (c.type === 'list' && c.source === hid) {
            if (c.toggleField === flag) delete c.toggleField;
            if (c.filter && usesFlag.test(c.filter)) delete c.filter;
          }
        }
      }
      delete h.fields[flag];
      notes.push(`collections.${cid}: added so each day's check-in is kept and a streak can be counted ("${flag}" never reset, so it was removed)`);
      return { parent: hid, child: cid };
    }
    return undefined;
  }

  /** A photo the person keeps with an entry needs an image field (s19). It stores a picture on this device only. */
  function keepPhotos(): void {
    for (const s of screens()) {
      const c = col(s.form);
      if (!c) continue;
      for (const k of s.children) {
        if (k.type !== 'photo' || k.field || k.aiBlock || Object.keys(c.fields).length >= LIMITS.fieldsPerCollection) continue;
        const fid = new Ids(Object.keys(c.fields)).take(slugify(k.label, 'photo'));
        c.fields[fid] = { type: 'image', label: k.label || 'Photo' };
        k.field = fid;
        notes.push(`collections.${s.form}.fields.${fid}: added so "${k.label}" is kept with each entry`);
      }
    }
  }

  /** The streak the person asked for (s21), per parent where entries have one, plus the days done this week. */
  function addStreak(): void {
    if (!/streak|in a row|lagatar/.test(request)) return;
    if (spec.screens.some((s) => s.children.some((c) => c.type === 'stat' && /\bstreak\(/.test(c.expr)))) return;
    for (const [cid, c] of Object.entries(spec.collections)) {
      const date = dateField(cid);
      if (!date) continue;
      const flag = Object.entries(c.fields).find(([, f]) => f.type === 'boolean')?.[0];
      const link = Object.entries(c.fields).find(([, f]) => f.type === 'text' && !!f.ref);
      const parent = link?.[1].type === 'text' ? link[1].ref?.collection : undefined;
      const page = parent ? listsOf(parent).map(({ c: l }) => screenById(l.detailScreen)).find((s) => s?.form === parent) : undefined;
      const where = [page && link ? `${link[0]} == selected` : '', flag ? `${flag} == true` : ''].filter(Boolean).join(' && ');
      const src = where ? `filter(${cid}, ${where})` : cid;
      const streak = `streak(${src}.${date})`;
      const week = `count(filter(${cid}, ${where ? `${where} && ` : ''}week(${date}) == week(today)))`;
      const target = page ?? listsOf(cid)[0]?.s ?? home();
      if (target.children.length > LIMITS.componentsPerScreen - 2 || !fits(week)) continue;
      atTop(target, [
        { id: compIds.take('streak'), type: 'stat', label: 'Streak (days in a row)', expr: streak, format: 'integer' },
        { id: compIds.take('done_this_week'), type: 'stat', label: 'Days done this week', expr: week, format: 'integer' },
      ]);
      notes.push(`screens.${target.id}: added the streak that was asked for, and the days done this week`);
      return;
    }
    notes.push('A streak was asked for, but no entry has a date, so it cannot be counted');
  }

  function dateField(cid: string): string | undefined {
    const fields = Object.entries(col(cid)?.fields ?? {}).filter(([, f]) => f.type === 'date');
    return (fields.find(([fid]) => /date|day|when|on$/.test(fid)) ?? fields[0])?.[0];
  }

  function removeUnused(): void {
    // AI steps nothing runs (s23 "default_stub", ma06).
    const runs = new Set<string>();
    const pressed = new Set(spec.screens.flatMap((s) => s.children.flatMap((c) => (c.type === 'bigButton' ? [c.action] : []))));
    for (const id of Object.keys(spec.intents)) pressed.add(id);
    for (const [id, a] of Object.entries(spec.actions)) {
      if (a.type !== 'runAI') continue;
      if (pressed.has(id)) runs.add(a.aiBlock);
      else {
        delete spec.actions[id];
        notes.push(`actions.${id}: removed, no button or voice phrase runs it`);
      }
    }
    for (const s of spec.screens) for (const c of s.children) if (c.type === 'photo' && c.aiBlock) runs.add(c.aiBlock);
    for (const id of Object.keys(spec.aiBlocks)) {
      if (runs.has(id)) continue;
      delete spec.aiBlocks[id];
      notes.push(`aiBlocks.${id}: removed, nothing in the app uses it`);
    }
    // Collections nothing reads or fills (t16, s01).
    const used = new Set<string>();
    for (const s of spec.screens) {
      if (s.form) used.add(s.form);
      for (const c of s.children) {
        if (c.type === 'list' || c.type === 'chart' || c.type === 'reminder') used.add(c.source);
        if (c.type === 'stat') formulaDependencies(c.expr).collections.forEach((x) => used.add(x));
        if (c.type === 'list' && c.filter) formulaDependencies(c.filter).collections.forEach((x) => used.add(x));
      }
    }
    for (const a of Object.values(spec.actions)) if ('collection' in a) used.add(a.collection);
    for (const b of Object.values(spec.aiBlocks)) if (b.kind === 'extractFromPhoto') used.add(b.target);
    for (const c of Object.values(spec.collections)) for (const f of Object.values(c.fields)) if (f.type === 'text' && f.ref) used.add(f.ref.collection);
    for (const id of Object.keys(spec.collections)) {
      if (used.has(id)) continue;
      delete spec.collections[id];
      notes.push(`collections.${id}: removed, nothing in the app uses it`);
    }
    for (const id of Object.keys(spec.intents)) if (!own(spec.actions, id)) delete spec.intents[id];
  }

  function fixCurrency(): void {
    const asked = extractCurrency(opts.request);
    const pref = opts.currency && /^[A-Z]{3}$/.test(opts.currency) ? opts.currency : undefined;
    const want = asked ?? pref ?? 'INR';
    const current = spec.settings?.currency;
    const money =
      spec.screens.some((s) => s.children.some((c) => c.type === 'stat' && c.format === 'currency')) ||
      Object.values(spec.collections).some((c) => Object.entries(c.fields).some(([fid, f]) => f.type === 'number' && MONEY_FIELD.test(`${fid} ${lc(f.label)}`)));
    if ((money && !current) || (current && current !== want && current !== asked)) {
      spec.settings = { ...(spec.settings ?? {}), currency: want };
      if (current) notes.push(`settings.currency: ${current} changed to ${want}, the person did not ask for ${current}`);
    }
    const symbol = CURRENCY_SYMBOLS[want as CurrencyCode] ?? want;
    for (const s of spec.screens) {
      for (const c of s.children) {
        if (c.type === 'stat' && c.format === 'currency' && c.currency !== want) {
          if (c.currency) notes.push(`screens.${s.id}: "${c.label}" shown in ${want}, not ${c.currency}`);
          c.currency = want;
        }
      }
    }
    for (const [cid, c] of Object.entries(spec.collections)) {
      for (const [fid, f] of Object.entries(c.fields)) {
        if (f.type !== 'number' || !f.unit) continue;
        const code = extractCurrency(f.unit) ?? (/^(usd|inr|eur|gbp|aed)$/i.test(f.unit) ? f.unit.toUpperCase() : undefined);
        if (code && code !== want) {
          f.unit = symbol.slice(0, 12);
          notes.push(`collections.${cid}.fields.${fid}: unit is now ${want}`);
        }
      }
    }
  }
}

/** A fixed value written as text on the wire, as the field's own type. */
function coerceSet(f: KalamField, raw: unknown): string | number | boolean | undefined {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  let v: unknown = s;
  if (f.type === 'boolean') v = typeof s === 'boolean' ? s : /^(true|yes|done|1|haan)$/i.test(String(s)) ? true : /^(false|no|0|nahi)$/i.test(String(s)) ? false : undefined;
  else if (f.type === 'number') v = typeof s === 'number' ? s : Number(s);
  else if (f.type === 'enum') v = f.options.find((o) => o.toLowerCase() === String(s).toLowerCase());
  else if (f.type === 'date' && /^today$/i.test(String(s))) v = 'today';
  return setValueFits(f, v) ? (v as string | number | boolean) : undefined;
}
