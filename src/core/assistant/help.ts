/**
 * Deterministic help from the spec itself: "what is this app", "what does Add expense do",
 * "how do I add an order". No model, no records. Every sentence is built from the spec's own
 * screens, buttons, collections and fields, so an explanation can never describe something the
 * app does not have (docs/14 §13.6: explanations match the actual app structure).
 */
import { describeSpec } from '../spec/describe';
import type { KalamComponent, KalamScreen, KalamSpec } from '../spec/schema';
import { collectionName, lower, mentions, namesOf, quote, singular, stems, words } from './text';

export interface HelpAnswer { text: string; lines?: string[] }

const CHANGE_THE_APP = 'Changing your app is done from Edit. Tap Edit at the top of the app and say what you want to change.';
const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

const VERBS = {
  add: ['add', 'create', 'new', 'enter', 'record', 'log', 'save', 'make', 'register', 'put', 'write', 'note'],
  remove: ['delete', 'remove', 'erase'],
  edit: ['edit', 'change', 'update', 'modify', 'fix', 'correct'],
  view: ['see', 'view', 'find', 'check', 'open', 'show', 'look', 'list', 'get'],
} as const;
type Verb = keyof typeof VERBS;
const HOW_FILLER = new Set(stems(
  `how do can could should would i we you to where is are a an the new my one another entry record item thing something
   all of in for on please ${Object.values(VERBS).flat().join(' ')}`,
));

const PREPOSITIONS = new Set(['to', 'in', 'into', 'on', 'for', 'with']);
const WHAT_FILLER = new Set(stems('what is are the a an field mean means for does do this'));

interface Located { screen: KalamScreen; component: KalamComponent }
function allComponents(spec: KalamSpec): Located[] {
  return spec.screens.flatMap((screen) => screen.children.map((component) => ({ screen, component })));
}

/** One sentence telling the person how to get to `screen`. */
function openStep(spec: KalamSpec, screen: KalamScreen): string {
  if (screen.id === spec.initialScreen) return `Start on ${quote(screen.title)}.`;
  const via = allComponents(spec).find(({ screen: s, component: c }) =>
    s.id !== screen.id && c.type === 'bigButton' && spec.actions[c.action]?.type === 'navigate'
    && (spec.actions[c.action] as { screen: string }).screen === screen.id);
  return via && via.component.type === 'bigButton'
    ? `On ${quote(via.screen.title)}, tap ${quote(via.component.label)}.`
    : `Open ${quote(screen.title)}.`;
}

/** Single sentence for what one button does, reusing describeSpec's wording. */
function explainButton(spec: KalamSpec, componentId: string): string | undefined {
  const only: KalamSpec = {
    ...spec, intents: {}, screens: spec.screens.map((s) => ({ ...s, children: s.children.filter((c) => c.id === componentId) })),
  };
  return describeSpec(only).actions[0];
}

function overview(spec: KalamSpec): HelpAnswer {
  const info = describeSpec(spec);
  const lines = [`Screens: ${info.screens.map((s) => s.title).join(', ')}.`];
  if (info.collections.length) lines.push(`It keeps track of: ${info.collections.map((c) => lower(c.name)).join(', ')}.`);
  lines.push(...info.actions.slice(0, 5).map(sentence));
  return { text: sentence(info.purpose), lines };
}

function howToAdd(spec: KalamSpec, cid: string): HelpAnswer {
  const noun = lower(singular(collectionName(spec, cid)));
  const form = spec.screens.find((s) => s.form === cid);
  if (!form) return { text: `This app has no screen for adding ${lower(collectionName(spec, cid))}. ${CHANGE_THE_APP}` };
  const fieldOf = (c: KalamComponent): string | undefined => ('field' in c && typeof c.field === 'string' ? c.field : undefined);
  const inputs = form.children.filter((c) => fieldOf(c) && c.type !== 'counter');
  const labelOf = (c: KalamComponent): string => ('label' in c && c.label ? c.label : '');
  const labels = inputs.map(labelOf).filter(Boolean);
  const required = inputs
    .filter((c) => spec.collections[cid]?.fields[fieldOf(c) as string]?.required || ('required' in c && c.required))
    .map(labelOf).filter(Boolean);
  const save = form.children.find((c) => c.type === 'bigButton' && spec.actions[c.action]?.type === 'insert');
  const lines = [openStep(spec, form)];
  if (labels.length) lines.push(`Fill in ${labels.join(', ')}.${required.length ? ` ${required.join(', ')} must be filled in.` : ''}`);
  lines.push(save && save.type === 'bigButton' ? `Tap ${quote(save.label)}.` : 'Tap the save button.');
  return { text: `To add ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}:`, lines };
}

function howToRemove(spec: KalamSpec, cid: string): HelpAnswer {
  const label = lower(collectionName(spec, cid));
  const hit = allComponents(spec).find(({ component: c }) => c.type === 'list' && c.source === cid && c.allowDelete);
  if (!hit) return { text: `This app has no way to delete ${label} yet. ${CHANGE_THE_APP}` };
  return {
    text: `To delete one of your ${label}:`,
    lines: [openStep(spec, hit.screen), 'Tap the bin icon next to the entry.', 'Kalam asks you to confirm before it deletes anything.'],
  };
}

function howToEdit(spec: KalamSpec, cid: string): HelpAnswer {
  const noun = lower(singular(collectionName(spec, cid)));
  const hit = allComponents(spec).find(({ component: c }) => c.type === 'list' && c.source === cid && c.detailScreen);
  const list = hit && hit.component.type === 'list' ? hit.component : undefined;
  const detail = list?.detailScreen ? spec.screens.find((s) => s.id === list.detailScreen) : undefined;
  if (!hit || !detail) return { text: `This app does not let you change a ${noun} after saving it. ${CHANGE_THE_APP}` };
  const save = detail.children.find((c) => c.type === 'bigButton' && spec.actions[c.action]?.type === 'update');
  return {
    text: `To change a ${noun}:`,
    lines: [openStep(spec, hit.screen), `Tap the ${noun} you want to change.`, save && save.type === 'bigButton' ? `Make your changes, then tap ${quote(save.label)}.` : 'Make your changes and save them.'],
  };
}

function howToView(spec: KalamSpec, cid: string): HelpAnswer {
  const label = lower(collectionName(spec, cid));
  const hit = allComponents(spec).find(({ component: c }) => c.type === 'list' && c.source === cid);
  if (!hit) return { text: `This app does not show a list of ${label}. ${CHANGE_THE_APP}` };
  return { text: `To see your ${label}:`, lines: [openStep(spec, hit.screen)] };
}

/** "how do I …" questions. Returns undefined when it is not one. */
function howTo(spec: KalamSpec, q: string, n: string): HelpAnswer | undefined {
  if (!/^(how (do|can|could|should|would) (i|we|you)|how to|where (do|can) i|where (is|are))\b/.test(n)) return undefined;
  const toks = words(q);
  const verb = (Object.keys(VERBS) as Verb[]).find((v) => toks.some((t) => (VERBS[v] as readonly string[]).includes(t)));
  if (!verb) return undefined;
  if (verb !== 'view' && /\b(field|column|screen|page|button|colou?r|theme|formula|font)\b/.test(n)) return { text: CHANGE_THE_APP };

  const qset = new Set(stems(q));
  const left = new Set(qset);
  const named = Object.entries(spec.collections).filter(([id, c]) => namesOf(c.label, id).some((t) => mentions(t, qset)));
  for (const [id, c] of named) namesOf(c.label, id).filter((t) => mentions(t, qset)).forEach((t) => t.forEach((x) => left.delete(x)));
  for (const c of Object.values(spec.collections)) {
    for (const [fid, f] of Object.entries(c.fields)) {
      namesOf(f.label, fid).filter((t) => mentions(t, qset)).forEach((t) => t.forEach((x) => left.delete(x)));
    }
  }
  const extra = [...left].some((t) => !HOW_FILLER.has(t));
  const only = Object.keys(spec.collections);
  const cid = named.length === 1 ? named[0][0] : !named.length && only.length === 1 && !extra ? only[0] : undefined;

  // "how can I add a customer phone number" / "add a phone number to an expense": a new detail, not a new entry.
  if (verb === 'add' && extra && named.length === 0) return { text: CHANGE_THE_APP };
  if (verb === 'add' && named.length === 1) {
    const [id, c] = named[0];
    const first = namesOf(c.label, id).find((t) => mentions(t, qset))?.[0];
    const before = first ? stems(q).slice(0, stems(q).indexOf(first)) : [];
    if (before.some((t) => left.has(t) && !HOW_FILLER.has(t)) && before.slice(-2).some((t) => PREPOSITIONS.has(t))) return { text: CHANGE_THE_APP };
  }
  if (!cid) {
    const info = describeSpec(spec);
    return { text: 'I could not match that to a part of this app. Here is what it can do.', lines: info.actions.slice(0, 5).map(sentence) };
  }
  return { add: howToAdd, remove: howToRemove, edit: howToEdit, view: howToView }[verb](spec, cid);
}

/** "what does <button> do" and "what is <field>". */
function whatIs(spec: KalamSpec, q: string, n: string): HelpAnswer | undefined {
  if (!/^what (does|will|happens|is|are)\b/.test(n)) return undefined;
  const qset = new Set(stems(q));
  const buttons = allComponents(spec).flatMap(({ component: c }) => (c.type === 'bigButton' ? [c] : []));
  const button = buttons
    .filter((b) => mentions(stems(b.label), qset))
    .sort((a, b) => stems(b.label).length - stems(a.label).length)[0];
  if (button && /\b(do|does|happen|happens|mean)\b/.test(n)) {
    const what = explainButton(spec, button.id);
    return what ? { text: `${quote(button.label)} ${lowerFirst(sentence(what))}` } : undefined;
  }
  const info = describeSpec(spec);
  for (const [cid, c] of Object.entries(spec.collections)) {
    for (const [fid, f] of Object.entries(c.fields)) {
      const hit = namesOf(f.label, fid).filter((t) => mentions(t, qset));
      if (!hit.length) continue;
      // Only a plain "what is <field>"; "what is the total <field>" is a calculation, not a definition.
      const left = new Set(qset);
      hit.forEach((t) => t.forEach((x) => left.delete(x)));
      if ([...left].some((t) => !WHAT_FILLER.has(t))) continue;
      const kind = info.collections.find((x) => x.id === cid)?.fields.find((x) => x.label === f.label);
      const text = [`${quote(f.label)} is in ${lower(collectionName(spec, cid))}.`, kind ? `Type: ${lowerFirst(kind.type)}.` : '', f.required ? 'It must be filled in.' : '']
        .filter(Boolean).join(' ');
      return { text };
    }
  }
  return undefined;
}

export function answerHelp(spec: KalamSpec, question: string): HelpAnswer | undefined {
  const n = words(question).join(' ');
  if (/^(what is this( app)?|what does this app do|what can i do( here| in this app)?|what can this app do|tell me about this app|about this app|describe this app|explain this app|help( me)?)$/.test(n)) {
    return overview(spec);
  }
  const count = n.match(/^how many (screens|pages|fields|buttons)\b/);
  if (count) {
    const info = describeSpec(spec);
    const num = count[1] === 'screens' || count[1] === 'pages' ? spec.screens.length
      : count[1] === 'fields' ? info.collections.reduce((t, c) => t + c.fields.length, 0)
        : allComponents(spec).filter(({ component: c }) => c.type === 'bigButton').length;
    return { text: `This app has ${num} ${num === 1 ? singular(count[1]) : count[1]}.` };
  }
  if (/^((what|which) (screens|pages)\b|list (the )?(screens|pages))/.test(n)) {
    return { text: 'These are the screens in this app.', lines: spec.screens.map((s) => s.title) };
  }
  if (/^((what|which) (fields|information|details)\b|what do i (fill in|enter|type))/.test(n)) {
    const info = describeSpec(spec);
    if (!info.collections.length) return { text: 'This app does not keep any entries, so there is nothing to fill in.' };
    return { text: 'This is what the app keeps.', lines: info.collections.map((c) => `${c.name}: ${c.fields.map((f) => f.label).join(', ')}`) };
  }
  return howTo(spec, question, n) ?? whatIs(spec, question, n);
}
