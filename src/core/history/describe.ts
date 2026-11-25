/**
 * describeSpecChanges(before, after): plain-English lines for what differs between two designs of one app.
 *
 * Deterministic, offline, no model. Ids are stable, so a renamed screen, field or button is found by id and
 * reported as a rename, not as a removal plus an addition. Bookkeeping (`version`, `meta.updatedAt`) is ignored.
 */
import type { KalamAction, KalamAIBlock, KalamComponent, KalamField, KalamSpec } from '../spec/schema';
import { colourName } from './colour';
import { describeCondition, describeFormula, type FormulaNames } from './formula-text';
import {
  clip, COMPONENT_NOUN, deepEqual, humanize, joinWords, languageLabel, lowerFirst, movedIds, namesFor, plural,
  type SpecNames,
} from './names';
import type { ChangeCategory, ChangeDetail, ChangeEntry, ChangeImpact, ChangeKind } from './types';
import { IMPACT_RANK } from './types';

type Draft = Omit<ChangeEntry, 'key'>;
type Val = Record<string, unknown>;

const stronger = (a: ChangeImpact, b: ChangeImpact): ChangeImpact => (IMPACT_RANK[b] > IMPACT_RANK[a] ? b : a);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** How a stored value reads in a Before or After row. */
function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'not set';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : 'none';
  if (typeof v === 'object') {
    const o = v as Val;
    if ('field' in o && 'direction' in o) return `${humanize(String(o.field))}, ${o.direction === 'desc' ? 'high to low' : 'low to high'}`;
    return Object.entries(o).map(([k, x]) => `${humanize(k)}: ${show(x)}`).join(', ');
  }
  return String(v);
}

/** Items of `after` that `before` does not have. */
function newItems<T>(before: readonly T[] = [], after: readonly T[] = []): T[] {
  return after.filter((x) => !before.includes(x));
}

// ─── Screens ──────────────────────────────────────────────────────────────────

function diffScreens(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const nb = namesFor(b);
  const na = namesFor(a);
  const bIds = b.screens.map((s) => s.id);
  const aIds = a.screens.map((s) => s.id);
  const screenRef = (title: string): string => (/screen$/i.test(title) ? `the ${title}` : `the ${title} screen`);

  for (const s of a.screens) {
    if (bIds.includes(s.id)) continue;
    const n = s.children.length;
    out.push({
      kind: 'added', category: 'structure', impact: 'behaviour', ids: [s.id],
      text: `Added ${screenRef(s.title)}${n ? ` with ${plural(n, 'item')}` : ''}`,
    });
  }
  for (const s of b.screens) {
    if (aIds.includes(s.id)) continue;
    out.push({ kind: 'removed', category: 'structure', impact: 'behaviour', ids: [s.id], text: `Removed ${screenRef(s.title)}` });
  }
  for (const sa of a.screens) {
    const sb = b.screens.find((x) => x.id === sa.id);
    if (!sb) continue;
    if (sb.title !== sa.title) {
      out.push({
        kind: 'renamed', category: 'text', impact: 'cosmetic', ids: [sa.id],
        text: `Renamed ${screenRef(sb.title)} to ${sa.title}`,
        details: [{ name: 'Title', before: sb.title, after: sa.title }],
      });
    }
    if ((sb.description ?? '') !== (sa.description ?? '')) {
      out.push({
        kind: 'changed', category: 'text', impact: 'cosmetic', ids: [sa.id],
        text: `Changed the description of ${screenRef(sa.title)}`,
        details: [{ name: 'Description', before: show(sb.description), after: show(sa.description) }],
      });
    }
    if (sb.form !== sa.form) {
      const text = !sb.form
        ? `Connected ${screenRef(sa.title)} to ${na.collectionName(sa.form as string)}, so what you type is saved there`
        : !sa.form
          ? `Disconnected ${screenRef(sa.title)} from ${nb.collectionName(sb.form)}`
          : `Connected ${screenRef(sa.title)} to ${na.collectionName(sa.form)} instead of ${nb.collectionName(sb.form)}`;
      out.push({
        kind: 'changed', category: 'data', impact: 'behaviour', ids: [sa.id, ...(sa.form ? [sa.form] : [])], text,
        details: [{
          name: 'Saves to',
          before: sb.form ? nb.collectionName(sb.form) : 'nothing',
          after: sa.form ? na.collectionName(sa.form) : 'nothing',
        }],
      });
    }
  }
  for (const id of movedIds(bIds, aIds)) {
    const title = na.screenTitle(id);
    const to = aIds.indexOf(id) + 1;
    out.push({
      kind: 'moved', category: 'structure', impact: 'behaviour', ids: [id],
      text: `Moved ${screenRef(title)} to position ${to}`,
    });
  }
  if (b.initialScreen !== a.initialScreen) {
    out.push({
      kind: 'changed', category: 'structure', impact: 'behaviour', ids: [a.initialScreen],
      text: `Changed the first screen to ${na.screenTitle(a.initialScreen)}`,
      details: [{ name: 'Opens on', before: nb.screenTitle(b.initialScreen), after: na.screenTitle(a.initialScreen) }],
    });
  }
}

// ─── Components ───────────────────────────────────────────────────────────────

interface PropRule { words: string; category: ChangeCategory; impact: ChangeImpact }
const R = (words: string, category: ChangeCategory, impact: ChangeImpact): PropRule => ({ words, category, impact });

const COMPONENT_PROPS: Record<string, PropRule> = {
  label: R('text', 'text', 'cosmetic'),
  placeholder: R('hint text', 'text', 'cosmetic'),
  emptyText: R('empty message', 'text', 'cosmetic'),
  a11yLabel: R('screen reader label', 'text', 'cosmetic'),
  a11yDescription: R('screen reader description', 'text', 'cosmetic'),
  readAloud: R('read-aloud text', 'text', 'cosmetic'),
  prefix: R('prefix', 'text', 'cosmetic'),
  suffix: R('suffix', 'text', 'cosmetic'),
  format: R('number format', 'look', 'cosmetic'),
  currency: R('currency', 'look', 'cosmetic'),
  tone: R('style', 'look', 'cosmetic'),
  multiline: R('box size', 'look', 'cosmetic'),
  field: R('linked field', 'data', 'behaviour'),
  source: R('entries shown', 'data', 'behaviour'),
  toggleField: R('tick box field', 'data', 'behaviour'),
  required: R('required setting', 'data', 'behaviour'),
  options: R('choices', 'structure', 'behaviour'),
  primary: R('main line', 'structure', 'behaviour'),
  limit: R('item limit', 'structure', 'behaviour'),
  detailScreen: R('detail screen', 'structure', 'behaviour'),
  allowDelete: R('delete option', 'structure', 'behaviour'),
  sort: R('order', 'logic', 'behaviour'),
  min: R('limits', 'logic', 'behaviour'),
  max: R('limits', 'logic', 'behaviour'),
  step: R('step size', 'logic', 'behaviour'),
  action: R('action', 'logic', 'behaviour'),
  aiBlock: R('AI step', 'ai', 'behaviour'),
};

function propRule(c: KalamComponent, prop: string): PropRule {
  if (prop === 'secondary') return c.type === 'list' ? R('second line', 'structure', 'behaviour') : R('style', 'look', 'cosmetic');
  return COMPONENT_PROPS[prop] ?? R(humanize(prop).toLowerCase(), 'structure', 'behaviour');
}

function propValue(prop: string, v: unknown, n: SpecNames): string {
  if (v === undefined) return 'not set';
  if (prop === 'action') return n.actionName(String(v));
  if (prop === 'aiBlock') return n.blockName(String(v));
  if (prop === 'field' || prop === 'toggleField') return n.fieldLabel(String(v));
  if (prop === 'source') return n.collectionName(String(v));
  if (prop === 'detailScreen') return n.screenTitle(String(v));
  return show(v);
}

function formulaNames(n: SpecNames): FormulaNames {
  return { collection: n.collectionName, name: n.anyName };
}

function diffComponent(cb: KalamComponent, ca: KalamComponent, nb: SpecNames, na: SpecNames, screenId: string, out: Draft[]): void {
  const ids = [screenId, ca.id];
  const refB = nb.componentRef(cb);
  const refA = na.componentRef(ca);
  if (cb.type !== ca.type) {
    out.push({
      kind: 'changed', category: 'structure', impact: 'behaviour', ids,
      text: `Changed the ${refB} into a ${COMPONENT_NOUN[ca.type]}`,
      details: [{ name: 'Kind', before: COMPONENT_NOUN[cb.type], after: COMPONENT_NOUN[ca.type] }],
    });
    return;
  }
  const rb = cb as unknown as Val;
  const ra = ca as unknown as Val;
  const changed = [...new Set([...Object.keys(rb), ...Object.keys(ra)])]
    .filter((k) => k !== 'id' && k !== 'type' && !deepEqual(rb[k], ra[k]));
  if (!changed.length) return;
  const handled = new Set<string>();

  if (changed.includes('label') && typeof rb.label === 'string' && typeof ra.label === 'string') {
    handled.add('label');
    out.push({
      kind: 'renamed', category: 'text', impact: 'cosmetic', ids,
      text: `Renamed the ${refB} to ${clip(ra.label)}`,
      details: [{ name: 'Text', before: rb.label, after: ra.label }],
    });
  }
  if (changed.includes('visible')) {
    handled.add('visible');
    const hidden = ra.visible === false;
    out.push({
      kind: 'changed', category: 'structure', impact: 'behaviour', ids,
      text: `${hidden ? 'Hid' : 'Showed'} the ${refA}`,
      details: [{ name: 'Shown', before: rb.visible === false ? 'no' : 'yes', after: hidden ? 'no' : 'yes' }],
    });
  }
  if ('action' in ra && changed.includes('action')) {
    handled.add('action');
    out.push({
      kind: 'changed', category: 'logic', impact: 'behaviour', ids,
      text: `The ${refA} now runs the ${na.actionName(String(ra.action))} action`,
      details: [{ name: 'Action', before: propValue('action', rb.action, nb), after: propValue('action', ra.action, na) }],
    });
  }
  if (ca.type === 'stat' && changed.includes('expr')) {
    handled.add('expr');
    const fn = formulaNames(na);
    const phrase = describeFormula(ca.expr, fn);
    const beforePhrase = cb.type === 'stat' ? describeFormula(cb.expr, formulaNames(nb)) : undefined;
    out.push({
      kind: 'changed', category: 'logic', impact: 'behaviour', ids,
      text: phrase ? `The ${refA} now ${phrase}` : `Changed how the ${refA} is worked out`,
      details: [{ name: 'Works out', before: beforePhrase ?? 'an earlier calculation', after: phrase ?? 'a new calculation' }],
    });
  }
  if (ca.type === 'list' && changed.includes('filter')) {
    handled.add('filter');
    const cond = ca.filter ? describeCondition(ca.filter, formulaNames(na)) : undefined;
    const before = cb.type === 'list' && cb.filter ? describeCondition(cb.filter, formulaNames(nb)) : undefined;
    const text = !ca.filter
      ? `The ${refA} now shows all entries`
      : cond ? `The ${refA} now shows only entries ${cond}` : `Changed which entries the ${refA} shows`;
    out.push({
      kind: 'changed', category: 'logic', impact: 'behaviour', ids, text,
      details: [{
        name: 'Shows',
        before: cb.type === 'list' && cb.filter ? `only entries ${before ?? 'that match a rule'}` : 'all entries',
        after: ca.filter ? `only entries ${cond ?? 'that match a rule'}` : 'all entries',
      }],
    });
  }

  // Everything else: one line per category, listing the settings that changed.
  const groups = new Map<ChangeCategory, { words: string[]; impact: ChangeImpact; details: ChangeDetail[] }>();
  for (const prop of changed.filter((k) => !handled.has(k))) {
    const rule = propRule(ca, prop);
    const g = groups.get(rule.category) ?? { words: [], impact: 'cosmetic' as ChangeImpact, details: [] };
    if (!g.words.includes(rule.words)) g.words.push(rule.words);
    g.impact = stronger(g.impact, rule.impact);
    g.details.push({ name: cap(rule.words), before: propValue(prop, rb[prop], nb), after: propValue(prop, ra[prop], na) });
    groups.set(rule.category, g);
  }
  for (const [category, g] of groups) {
    out.push({
      kind: 'changed', category, impact: g.impact, ids,
      text: `Changed the ${joinWords(g.words)} of the ${refA}`,
      details: g.details,
    });
  }
}

function diffComponents(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const nb = namesFor(b);
  const na = namesFor(a);
  const index = (spec: KalamSpec) => {
    const m = new Map<string, { c: KalamComponent; screen: string }>();
    for (const s of spec.screens) for (const c of s.children) m.set(c.id, { c, screen: s.id });
    return m;
  };
  const before = index(b);
  const after = index(a);
  const inScreen = (id: string, spec: KalamSpec) => spec.screens.find((s) => s.id === id);

  for (const [id, { c, screen }] of after) {
    if (before.has(id)) continue;
    // Part of a brand new screen: the screen line already counts its items.
    if (!inScreen(screen, b)) continue;
    out.push({
      kind: 'added', category: 'structure', impact: 'behaviour', ids: [screen, id],
      text: `Added the ${na.componentRef(c)} to the ${na.screenTitle(screen)} screen`,
    });
  }
  for (const [id, { c, screen }] of before) {
    if (after.has(id)) continue;
    // Removed together with its whole screen: the screen line already says it.
    if (!inScreen(screen, a)) continue;
    out.push({
      kind: 'removed', category: 'structure', impact: 'behaviour', ids: [screen, id],
      text: `Removed the ${nb.componentRef(c)} from the ${nb.screenTitle(screen)} screen`,
    });
  }
  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) continue;
    if (was.screen !== now.screen) {
      out.push({
        kind: 'moved', category: 'structure', impact: 'behaviour', ids: [now.screen, id],
        text: `Moved the ${na.componentRef(now.c)} from the ${nb.screenTitle(was.screen)} screen to the ${na.screenTitle(now.screen)} screen`,
      });
    }
    diffComponent(was.c, now.c, nb, na, now.screen, out);
  }
  for (const s of a.screens) {
    const sb = inScreen(s.id, b);
    if (!sb) continue;
    const bIds = sb.children.map((c) => c.id);
    const aIds = s.children.map((c) => c.id);
    for (const id of movedIds(bIds, aIds)) {
      const c = after.get(id)?.c;
      if (!c) continue;
      const common = bIds.filter((x) => aIds.includes(x));
      const upNow = aIds.filter((x) => common.includes(x)).indexOf(id) < common.indexOf(id);
      out.push({
        kind: 'moved', category: 'structure', impact: 'behaviour', ids: [s.id, id],
        text: `Moved the ${na.componentRef(c)} ${upNow ? 'up' : 'down'} on the ${s.title} screen`,
      });
    }
  }
}

// ─── Collections and fields ───────────────────────────────────────────────────

const TYPE_WORDS: Record<KalamField['type'], string> = {
  text: 'text', number: 'a number', date: 'a date', boolean: 'a yes or no', enum: 'a choice',
};

const FIELD_ATTRS: Record<string, PropRule> = {
  min: R('allowed range', 'data', 'behaviour'),
  max: R('allowed range', 'data', 'behaviour'),
  maxLength: R('length limit', 'data', 'behaviour'),
  defaultValue: R('starting value', 'data', 'behaviour'),
  unit: R('number display', 'data', 'cosmetic'),
  decimals: R('number display', 'data', 'cosmetic'),
  placeholder: R('hint text', 'text', 'cosmetic'),
  multiline: R('box size', 'look', 'cosmetic'),
};

function diffFields(coll: string, fb: Record<string, KalamField>, fa: Record<string, KalamField>, nb: SpecNames, na: SpecNames, out: Draft[]): void {
  const place = na.collectionName(coll);
  for (const [id, f] of Object.entries(fa)) {
    if (fb[id]) continue;
    out.push({ kind: 'added', category: 'data', impact: 'behaviour', ids: [coll, id], text: `Added the ${f.label} field to ${place}` });
  }
  for (const [id, f] of Object.entries(fb)) {
    if (fa[id]) continue;
    out.push({
      kind: 'removed', category: 'data', impact: 'data', ids: [coll, id],
      text: `Removed the ${f.label} field from ${nb.collectionName(coll)}. Values you already saved stay on this device`,
    });
  }
  for (const [id, now] of Object.entries(fa)) {
    const was = fb[id];
    if (!was) continue;
    const ids = [coll, id];
    if (was.type !== now.type) {
      out.push({
        kind: 'changed', category: 'data', impact: 'data', ids,
        text: `Changed the ${now.label} field in ${place} from ${TYPE_WORDS[was.type]} to ${TYPE_WORDS[now.type]}`,
        details: [{ name: 'Kind', before: TYPE_WORDS[was.type], after: TYPE_WORDS[now.type] }],
      });
      continue;
    }
    if (was.label !== now.label) {
      out.push({
        kind: 'renamed', category: 'text', impact: 'cosmetic', ids,
        text: `Renamed the ${was.label} field to ${now.label}`,
        details: [{ name: 'Name', before: was.label, after: now.label }],
      });
    }
    if (was.type === 'enum' && now.type === 'enum') {
      const plus = newItems(was.options, now.options);
      const minus = newItems(now.options, was.options);
      if (plus.length) {
        out.push({ kind: 'added', category: 'data', impact: 'behaviour', ids, text: `Added ${joinWords(plus)} to the ${now.label} choices` });
      }
      if (minus.length) {
        out.push({
          kind: 'removed', category: 'data', impact: 'data', ids,
          text: `Removed ${joinWords(minus)} from the ${now.label} choices. Entries already saved are not changed`,
        });
      }
    }
    if (!!was.required !== !!now.required) {
      out.push({
        kind: 'changed', category: 'data', impact: 'behaviour', ids,
        text: now.required ? `Made the ${now.label} field required` : `The ${now.label} field is no longer required`,
        details: [{ name: 'Required', before: was.required ? 'yes' : 'no', after: now.required ? 'yes' : 'no' }],
      });
    }
    const rw = was as unknown as Val;
    const rn = now as unknown as Val;
    const groups = new Map<string, { rule: PropRule; details: ChangeDetail[] }>();
    for (const key of Object.keys(FIELD_ATTRS)) {
      if (deepEqual(rw[key], rn[key])) continue;
      const rule = FIELD_ATTRS[key];
      const g = groups.get(rule.words) ?? { rule, details: [] };
      g.details.push({ name: cap(humanize(key).toLowerCase()), before: show(rw[key]), after: show(rn[key]) });
      groups.set(rule.words, g);
    }
    for (const { rule, details } of groups.values()) {
      out.push({
        kind: 'changed', category: rule.category, impact: rule.impact, ids,
        text: `Changed the ${rule.words} of the ${now.label} field in ${place}`,
        details,
      });
    }
  }
}

function diffCollections(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const nb = namesFor(b);
  const na = namesFor(a);
  for (const [id, c] of Object.entries(a.collections)) {
    if (b.collections[id]) continue;
    const n = Object.keys(c.fields).length;
    out.push({
      kind: 'added', category: 'data', impact: 'behaviour', ids: [id],
      text: `Started keeping ${na.collectionName(id)} with ${plural(n, 'field')}`,
    });
  }
  for (const id of Object.keys(b.collections)) {
    if (a.collections[id]) continue;
    out.push({
      kind: 'removed', category: 'data', impact: 'data', ids: [id],
      text: `Stopped keeping ${nb.collectionName(id)} in the design. Entries you already saved stay on this device`,
    });
  }
  for (const [id, now] of Object.entries(a.collections)) {
    const was = b.collections[id];
    if (!was) continue;
    if ((was.label ?? '') !== (now.label ?? '')) {
      out.push({
        kind: 'renamed', category: 'text', impact: 'cosmetic', ids: [id],
        text: `Renamed ${nb.collectionName(id)} to ${na.collectionName(id)}`,
        details: [{ name: 'Name', before: nb.collectionName(id), after: na.collectionName(id) }],
      });
    }
    diffFields(id, was.fields, now.fields, nb, na, out);
  }
}

// ─── Actions, voice phrases and AI steps ──────────────────────────────────────

export function describeActionText(a: KalamAction, spec: KalamSpec): string {
  const n = namesFor(spec);
  const then = (base: string): string => {
    if (!('then' in a) || !a.then) return base;
    const extra: string[] = [];
    if (a.then.navigate) extra.push(`goes to the ${n.screenTitle(a.then.navigate)} screen`);
    if (a.then.speak) extra.push('says a message aloud');
    else if (a.then.feedback) extra.push('shows a message');
    return extra.length ? joinWords([base, ...extra]) : base;
  };
  switch (a.type) {
    case 'navigate': return `opens the ${n.screenTitle(a.screen)} screen`;
    case 'insert': return then(`saves a new ${n.recordName(a.collection)}`);
    case 'update': return then(`updates the chosen ${n.recordName(a.collection)}`);
    case 'delete': return then(`deletes the chosen ${n.recordName(a.collection)} after asking you to confirm`);
    case 'increment': return `adds ${a.by ?? 1} to ${lowerFirst(n.anyName(a.target))}`;
    case 'decrement': return `takes ${a.by ?? 1} away from ${lowerFirst(n.anyName(a.target))}`;
    case 'reset': return `resets ${lowerFirst(n.anyName(a.target))}`;
    case 'runAI': return then(`runs the ${n.blockName(a.aiBlock)} AI step`);
    case 'speak': return 'reads a message aloud';
    case 'feedback': return 'shows a message';
    case 'clearForm': return 'clears the form';
  }
}

function diffActions(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const na = namesFor(a);
  const nb = namesFor(b);
  for (const [id, act] of Object.entries(a.actions)) {
    const was = b.actions[id];
    if (!was) {
      out.push({ kind: 'added', category: 'logic', impact: 'behaviour', ids: [id], text: `Added the ${na.actionName(id)} action, which ${describeActionText(act, a)}` });
    } else if (!deepEqual(was, act)) {
      out.push({
        kind: 'changed', category: 'logic', impact: 'behaviour', ids: [id],
        text: `The ${na.actionName(id)} action now ${describeActionText(act, a)}`,
        details: [{ name: 'Does', before: describeActionText(was, b), after: describeActionText(act, a) }],
      });
    }
  }
  for (const id of Object.keys(b.actions)) {
    if (!a.actions[id]) out.push({ kind: 'removed', category: 'logic', impact: 'behaviour', ids: [id], text: `Removed the ${nb.actionName(id)} action` });
  }
  const phrases = (v: readonly string[] | undefined) => v ?? [];
  for (const id of new Set([...Object.keys(a.intents), ...Object.keys(b.intents)])) {
    const was = phrases(b.intents[id]);
    const now = phrases(a.intents[id]);
    const plus = newItems(was, now);
    const minus = newItems(now, was);
    if (!plus.length && !minus.length) continue;
    const name = na.actionName(id);
    const text = !minus.length
      ? `Added ${plural(plus.length, 'voice phrase')} for ${name}: ${joinWords(plus.slice(0, 3).map((p) => `“${p}”`))}`
      : !plus.length
        ? `Removed ${plural(minus.length, 'voice phrase')} for ${name}`
        : `Changed the voice phrases for ${name}`;
    out.push({
      kind: plus.length && !minus.length ? 'added' : minus.length && !plus.length ? 'removed' : 'changed',
      category: 'logic', impact: 'behaviour', ids: [id], text,
      details: [{ name: 'Voice phrases', before: show(was), after: show(now) }],
    });
  }
}

function describeBlockText(blk: KalamAIBlock, spec: KalamSpec): string {
  const n = namesFor(spec);
  switch (blk.kind) {
    case 'extractFromPhoto': {
      const fields = blk.fields ?? Object.keys(spec.collections[blk.target]?.fields ?? {});
      const labels = fields.map((f) => lowerFirst(n.fieldLabel(f, blk.target)));
      return labels.length ? `reads a photo and fills in ${joinWords(labels)}` : 'reads a photo';
    }
    case 'classify': return `sorts ${lowerFirst(n.anyName(blk.inputField))} into ${joinWords(blk.labels)}`;
    case 'summarise': return `summarises ${lowerFirst(n.anyName(blk.inputField))} in up to ${blk.maxWords} words`;
    case 'translate': return `translates ${lowerFirst(n.anyName(blk.inputField))} into ${languageLabel(blk.targetLang)}`;
  }
}

const BLOCK_PROPS: Record<string, PropRule> = {
  prompt: R('instructions', 'ai', 'behaviour'),
  labels: R('labels', 'ai', 'behaviour'),
  inputField: R('fields it reads and fills', 'ai', 'behaviour'),
  outputField: R('fields it reads and fills', 'ai', 'behaviour'),
  target: R('fields it reads and fills', 'ai', 'behaviour'),
  fields: R('fields it reads and fills', 'ai', 'behaviour'),
  maxWords: R('length limit', 'ai', 'behaviour'),
  targetLang: R('language', 'ai', 'behaviour'),
  fallback: R('fallback setting', 'ai', 'behaviour'),
  onError: R('error setting', 'ai', 'behaviour'),
};
const VERIFIED_WORDS = { onDevice: 'works on this device', cloudPreferred: 'works best online', unverified: 'not checked yet' } as const;

function diffAIBlocks(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const na = namesFor(a);
  const nb = namesFor(b);
  for (const [id, blk] of Object.entries(a.aiBlocks)) {
    const was = b.aiBlocks[id];
    const name = na.blockName(id);
    if (!was) {
      out.push({ kind: 'added', category: 'ai', impact: 'behaviour', ids: [id], text: `Added the ${name} AI step, which ${describeBlockText(blk, a)}` });
      continue;
    }
    if (deepEqual(was, blk)) continue;
    if (was.kind !== blk.kind) {
      out.push({
        kind: 'changed', category: 'ai', impact: 'behaviour', ids: [id],
        text: `The ${name} AI step now ${describeBlockText(blk, a)}`,
        details: [{ name: 'Does', before: describeBlockText(was, b), after: describeBlockText(blk, a) }],
      });
      continue;
    }
    const rw = was as unknown as Val;
    const rn = blk as unknown as Val;
    const words: string[] = [];
    const details: ChangeDetail[] = [];
    for (const key of Object.keys(BLOCK_PROPS)) {
      if (deepEqual(rw[key], rn[key])) continue;
      const w = BLOCK_PROPS[key].words;
      if (!words.includes(w)) words.push(w);
      // Never copy the instructions into history: they can be long and are not needed to understand the change.
      details.push(key === 'prompt'
        ? { name: cap(w) }
        : { name: cap(humanize(key).toLowerCase()), before: show(rw[key]), after: show(rn[key]) });
    }
    if (words.length) {
      out.push({
        kind: 'changed', category: 'ai', impact: 'behaviour', ids: [id],
        text: `Changed the ${joinWords(words)} of the ${name} AI step`, details,
      });
    }
    if (!deepEqual(was.verified, blk.verified) || !deepEqual(was.verification, blk.verification)) {
      const v = blk.verification;
      const score = v && v.testCount > 0 ? ` (${v.passCount} of ${v.testCount} checks passed)` : '';
      out.push({
        kind: 'changed', category: 'ai', impact: 'cosmetic', ids: [id],
        text: `The ${name} AI step is now marked as ${VERIFIED_WORDS[blk.verified]}${score}`,
        details: [{ name: 'Status', before: VERIFIED_WORDS[was.verified], after: VERIFIED_WORDS[blk.verified] }],
      });
    }
  }
  for (const id of Object.keys(b.aiBlocks)) {
    if (!a.aiBlocks[id]) out.push({ kind: 'removed', category: 'ai', impact: 'behaviour', ids: [id], text: `Removed the ${nb.blockName(id)} AI step` });
  }
}

// ─── Look and app settings ────────────────────────────────────────────────────

const COLOUR_TOKENS = [
  ['primary', 'main colour'], ['secondary', 'second colour'], ['background', 'background colour'],
  ['surface', 'card colour'], ['text', 'text colour'],
] as const;
const PRESET_NAMES: Record<string, string> = {
  calm_green: 'Calm green', warm_paper: 'Warm paper', ocean_blue: 'Ocean blue', soft_lavender: 'Soft lavender',
  minimal_neutral: 'Minimal neutral', high_contrast: 'High contrast',
};
const FONT_NAMES: Record<string, string> = { system: 'the device font', inter: 'Inter', noto_sans: 'Noto Sans', serif: 'a serif font', rounded: 'a rounded font' };
const hexShown = (hex: string | undefined): string => (hex ? `${colourName(hex)} (${hex.toUpperCase()})` : 'the default');

function diffLook(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const tb = b.theme;
  const ta = a.theme;
  const colourRows: Array<{ words: string; detail: ChangeDetail; text: string; ids: string[] }> = [];
  for (const [key, words] of COLOUR_TOKENS) {
    if (tb[key] === ta[key]) continue;
    colourRows.push({
      words,
      ids: [key],
      detail: { name: cap(words), before: hexShown(tb[key]), after: hexShown(ta[key]) },
      text: !ta[key] ? `Went back to the default ${words}` : !tb[key] ? `Set the ${words} to ${colourName(ta[key])}` : `Changed the ${words} from ${colourName(tb[key])} to ${colourName(ta[key])}`,
    });
  }
  const presetChanged = tb.preset !== ta.preset;
  if (presetChanged) {
    const name = ta.preset ? PRESET_NAMES[ta.preset] ?? humanize(ta.preset) : undefined;
    out.push({
      kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['theme', ...(ta.preset ? [ta.preset] : [])],
      text: name ? `Switched to the ${name} look` : 'Stopped using a ready-made look',
      // A preset sets every colour at once: list them as rows instead of five separate lines.
      details: colourRows.length >= 3 ? colourRows.map((r) => r.detail) : undefined,
    });
  }
  if (!(presetChanged && colourRows.length >= 3)) {
    for (const r of colourRows) {
      out.push({ kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['theme', ...r.ids], text: r.text, details: [r.detail] });
    }
  }
  if (tb.radius !== ta.radius) {
    out.push({
      kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['theme', 'radius'],
      text: ta.radius > tb.radius ? 'Made the corners rounder' : 'Made the corners squarer',
      details: [{ name: 'Corners', before: `${tb.radius}`, after: `${ta.radius}` }],
    });
  }
  if (tb.fontScale !== ta.fontScale) {
    out.push({
      kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['theme', 'fontScale'],
      text: ta.fontScale > tb.fontScale ? 'Made the text larger' : 'Made the text smaller',
      details: [{ name: 'Text size', before: `${Math.round(tb.fontScale * 100)}%`, after: `${Math.round(ta.fontScale * 100)}%` }],
    });
  }
  if (tb.spacing !== ta.spacing) {
    out.push({
      kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['theme', 'spacing'],
      text: `Changed the spacing to ${ta.spacing ?? 'the default'}`,
      details: [{ name: 'Spacing', before: tb.spacing ?? 'default', after: ta.spacing ?? 'default' }],
    });
  }
  if (tb.fontFamily !== ta.fontFamily) {
    const to = ta.fontFamily ? FONT_NAMES[ta.fontFamily] ?? ta.fontFamily : 'the default font';
    out.push({
      kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['theme', 'fontFamily'], text: `Changed the font to ${to}`,
      details: [{ name: 'Font', before: tb.fontFamily ? FONT_NAMES[tb.fontFamily] ?? tb.fontFamily : 'the default font', after: to }],
    });
  }
  if (!deepEqual(b.icon, a.icon)) {
    const glyphChanged = b.icon?.glyph !== a.icon?.glyph;
    out.push({
      kind: 'changed', category: 'look', impact: 'cosmetic', ids: ['icon'],
      text: !a.icon ? 'Removed the app icon' : glyphChanged ? 'Changed the app icon' : 'Changed the app icon colours',
      details: glyphChanged ? [{ name: 'Icon', before: b.icon ? humanize(b.icon.glyph) : 'none', after: a.icon ? humanize(a.icon.glyph) : 'none' }] : undefined,
    });
  }
}

function diffApp(b: KalamSpec, a: KalamSpec, out: Draft[]): void {
  const push = (kind: ChangeKind, category: ChangeCategory, impact: ChangeImpact, id: string, text: string, details?: ChangeDetail[]) =>
    out.push({ kind, category, impact, ids: [id], text, details });
  if (b.name !== a.name) {
    push('renamed', 'text', 'cosmetic', 'name', `Renamed the app from ${b.name} to ${a.name}`, [{ name: 'Name', before: b.name, after: a.name }]);
  }
  if ((b.description ?? '') !== (a.description ?? '')) {
    push('changed', 'text', 'cosmetic', 'description', 'Changed the app description', [{ name: 'Description', before: show(b.description), after: show(a.description) }]);
  }
  if (b.lang !== a.lang) {
    push('changed', 'settings', 'behaviour', 'lang', `Changed the app language from ${languageLabel(b.lang)} to ${languageLabel(a.lang)}`,
      [{ name: 'Language', before: languageLabel(b.lang), after: languageLabel(a.lang) }]);
  }
  if (b.schemaVersion !== a.schemaVersion) {
    push('changed', 'settings', 'cosmetic', 'schemaVersion', `Updated the app to format ${a.schemaVersion}`);
  }
  const mb = b.meta;
  const ma = a.meta;
  if ((mb.description ?? '') !== (ma.description ?? '')) {
    push('changed', 'text', 'cosmetic', 'description', 'Changed the description used when sharing', [{ name: 'Sharing description', before: show(mb.description), after: show(ma.description) }]);
  }
  if ((mb.author ?? '') !== (ma.author ?? '')) push('changed', 'settings', 'cosmetic', 'author', 'Changed the author name');
  if (!deepEqual(mb.tags, ma.tags)) push('changed', 'settings', 'cosmetic', 'tags', 'Changed the tags', [{ name: 'Tags', before: show(mb.tags), after: show(ma.tags) }]);
  if (mb.license !== ma.license) {
    push('changed', 'settings', 'behaviour', 'license', 'Changed the sharing licence', [{ name: 'Licence', before: show(mb.license), after: show(ma.license) }]);
  }
  if ((mb.remixAllowed ?? false) !== (ma.remixAllowed ?? false)) {
    push('changed', 'settings', 'behaviour', 'remixAllowed', ma.remixAllowed ? 'Allowed others to remix this app' : 'Stopped others from remixing this app');
  }
  if (!deepEqual(mb.supportedLanguages, ma.supportedLanguages)) {
    push('changed', 'settings', 'cosmetic', 'supportedLanguages', 'Changed the languages this app has been checked in');
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Plain-English changes that turn `before` into `after`, most structural first. Empty when the two designs are
 * the same apart from bookkeeping. Never throws for specs that passed validation.
 */
export function describeSpecChanges(before: KalamSpec, after: KalamSpec): ChangeEntry[] {
  const out: Draft[] = [];
  diffScreens(before, after, out);
  diffComponents(before, after, out);
  diffCollections(before, after, out);
  diffActions(before, after, out);
  diffAIBlocks(before, after, out);
  diffLook(before, after, out);
  diffApp(before, after, out);
  const seen = new Map<string, number>();
  return out.map((d) => {
    const base = `${d.kind}:${d.category}:${d.ids.join('/')}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...d, key: n ? `${base}#${n}` : base };
  });
}
