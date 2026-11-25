/**
 * Edit by drawing (docs/08 §16, docs/04 §12.5–12.7, docs/03 §17.3, docs/00 §16).
 *
 * The overlay picks components by geometry (never AI) and hands this module a VisualEditRequest.
 * Clear marks become deterministic ops: cross → remove, arrow → move, note on empty space → new
 * text, scribble + words → new label, circle + simple words → a small patch on the picked part.
 * Anything else goes to the edit service (deterministic parser → Gemini Nano → Firebase cloud)
 * with the picked parts named, and the result is held to the selection: ops that touch other
 * parts are dropped (docs/14 §4.7 "editing one part does not silently modify another").
 *
 * Never mutates the input spec. Every proposed spec passes validateSpec before it is returned.
 * Pure TypeScript (no React / React Native).
 */
import type { AIProviderName, EditClass, EditOutcome, EditService, SpecIssue, SpecPatchOp } from '../contracts';
import { LIMITS, RESERVED_IDS, type KalamComponent, type KalamScreen, type KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { applyPatchOps, normalizeHex } from './apply';
import { parseSmallEdit } from './parse';
import { COLOUR_WORDS, THEME_PRESET_TOKENS } from './presets';

// ─── Request / outcome ────────────────────────────────────────────────────────
export type VisualGesture =
  /** Circle, tap, underline or a pick from the list: "this part". */
  | { kind: 'select' }
  /** Cross-out or strike-through. `hide` keeps the part in the design but stops showing it. */
  | { kind: 'remove'; mode?: 'remove' | 'hide' }
  /** Arrow: place the single target just before `before` on its screen (null = at the end). */
  | { kind: 'move'; before: string | null }
  /** Scribble over a part: its words should change. */
  | { kind: 'relabel' }
  /** Text note. On a part it is an instruction; on empty space it becomes text before `before`. */
  | { kind: 'note'; text: string; before?: string | null };

/** One drawn mark in overlay coordinates (docs/08 §16.4). Kept for the record; never sent to AI. */
export interface VisualAnnotation {
  kind: 'circle' | 'cross' | 'arrow' | 'line' | 'scribble' | 'tap' | 'free' | 'note';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

export interface VisualEditRequest {
  appId: string;
  /** App version the marks were drawn on (docs/08 §16.4). */
  baseVersion: number;
  /** Screen the marks were drawn on. */
  screenId: string;
  /** Component ids picked by geometry, in screen order. */
  targets: string[];
  gesture: VisualGesture;
  /** Typed or spoken words, e.g. "bigger, green". */
  instruction?: string;
  annotations?: VisualAnnotation[];
  source: 'drawing_overlay';
}

export type VisualEditNeed = 'target' | 'single_target' | 'instruction' | 'label';

export interface VisualEditOutcome {
  ok: boolean;
  /** Validated proposed spec: always a new object, the input spec is never changed. */
  spec?: KalamSpec;
  ops: SpecPatchOp[];
  /** Plain summary, saved as the version summary when the person keeps the change. */
  summary: string;
  /** Plain notes shown with the preview, e.g. that a colour is shared by the whole app. */
  notes: string[];
  /** Consequences worth a second look, e.g. removing the button that saves entries. */
  warnings: string[];
  route: EditOutcome['route'];
  provider: AIProviderName;
  editClass: EditClass;
  /** True when the change reaches beyond the picked parts (theme, app name). */
  appWide: boolean;
  /** Set when the request was incomplete. */
  needs?: VisualEditNeed;
  /** Failure explanation, ready to show. */
  message?: string;
  errors: SpecIssue[];
}

export type VisualEditPlan =
  | { kind: 'ops'; ops: SpecPatchOp[]; notes: string[]; appWide: boolean; summary?: string }
  | { kind: 'ask'; instruction: string; words: string }
  | { kind: 'needs'; needs: VisualEditNeed; message: string }
  | { kind: 'nothing'; message: string };

export interface VisualEditDeps {
  edit: Pick<EditService, 'applyInstruction'>;
  signal?: AbortSignal;
}

const MAX_WORDS = 300;
const STRUCTURAL_OPS: ReadonlySet<SpecPatchOp['op']> = new Set([
  'addScreen', 'removeScreen', 'addCollection', 'updateCollectionField', 'addAction', 'addAIBlock',
]);

// ─── Parts and names ──────────────────────────────────────────────────────────
export interface LocatedPart { component: KalamComponent; screen: KalamScreen; index: number }

export function findPart(spec: KalamSpec, id: string): LocatedPart | undefined {
  for (const screen of spec.screens) {
    const index = screen.children.findIndex((c) => c.id === id);
    if (index >= 0) return { component: screen.children[index] as KalamComponent, screen, index };
  }
  return undefined;
}

const short = (s: string, max = 32): string => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const labelOf = (c: KalamComponent): string => ('label' in c && typeof c.label === 'string' ? c.label : '');

/** Everyday noun per component type: what a shopkeeper would call it. */
const NOUNS: Record<KalamComponent['type'], string> = {
  bigButton: 'button', number: 'field', textInput: 'field', date: 'field', choice: 'choice', toggle: 'switch',
  counter: 'counter', list: 'list', stat: 'number', photo: 'photo', heading: 'heading', text: 'text',
};
const wordsFirst = (c: KalamComponent) => c.type === 'heading' || c.type === 'text';

/** Plain name for a part, e.g. `the "Save" button`. Lower-case "the" so it fits mid-sentence. */
export function partName(c: KalamComponent): string {
  const l = labelOf(c) ? `"${short(labelOf(c))}"` : '';
  if (!l) return `the ${NOUNS[c.type]}`;
  return wordsFirst(c) ? `the ${NOUNS[c.type]} ${l}` : `the ${l} ${NOUNS[c.type]}`;
}

/** Short tag for chips and highlights, e.g. `Save button` or, for a heading, its words. */
export function partTag(c: KalamComponent): string {
  const l = short(labelOf(c), 24);
  const noun = NOUNS[c.type];
  if (wordsFirst(c)) return l || noun.charAt(0).toUpperCase() + noun.slice(1);
  return l ? `${l} ${noun}` : noun.charAt(0).toUpperCase() + noun.slice(1);
}

// ─── Colour helpers (core must not import the UI design layer) ────────────────
function luminance(hex: string): number {
  const h = normalizeHex(hex);
  if (!h) return 0.2;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
const presetTokens = (spec: KalamSpec) => (spec.theme.preset ? THEME_PRESET_TOKENS[spec.theme.preset] : undefined);
const appBackground = (spec: KalamSpec) => spec.theme.background ?? presetTokens(spec)?.background ?? '#FFFFFF';
const appText = (spec: KalamSpec) => spec.theme.text ?? presetTokens(spec)?.text ?? '#1A1A1A';

/** English colour words first, so a hex maps back to "green" rather than "hara". */
const COLOUR_NAMES = Object.keys(COLOUR_WORDS).sort((a, b) => b.length - a.length);
const NAME_BY_HEX = new Map<string, string>();
for (const [name, hex] of Object.entries(COLOUR_WORDS)) if (!NAME_BY_HEX.has(hex.toUpperCase())) NAME_BY_HEX.set(hex.toUpperCase(), name);
const colourName = (hex: string): string | undefined => NAME_BY_HEX.get((normalizeHex(hex) ?? hex).toUpperCase());
const COLOUR_RES = COLOUR_NAMES.map((n) => [n, new RegExp(`(?:^|[^a-z])${n}(?:[^a-z]|$)`, 'i')] as const);
/** First colour word in the text (longest names first, so "dark blue" beats "blue"). */
const colourIn = (text: string): string | undefined => COLOUR_RES.find(([, re]) => re.test(text))?.[0];

// ─── Words → clauses ──────────────────────────────────────────────────────────
const strip = (s: string) => s.trim().replace(/[.!?]+$/, '').trim();
const unquote = (s: string) => strip(s).replace(/^["“'‘](.*)["”'’]$/s, '$1').trim();
const LEAD = /^(?:please|pls|kindly|can\s+you|could\s+you|make\s+(?:it|this|that|them)|turn\s+(?:it|this|that)|it\s+should\s+be|should\s+be|it\s+must\s+be)\s+/i;
const COMMAND_START = /^(?:make|turn|set|change|hide|remove|delete|move|rename|call|put|add)\b/i;
const COMMAND_WORDS = /\b(make|turn|set|change|bigger|larger|smaller|hide|remove|delete|move|required|optional|colou?r|round(?:er|ed)?|sharp(?:er)?)\b/i;

function splitClauses(text: string): string[] {
  const quoted: string[] = [];
  const masked = text.replace(/["“][^"”]*["”]/g, (q) => `\u0000${quoted.push(q) - 1}\u0000`);
  return masked
    .split(/\s*(?:,|;|&|\+|\.(?=\s|$)|\band\s+then\b|\bthen\b|\balso\b|\band\b|\baur\b|\bphir\b)\s*/i)
    .map((c) => c.replace(/\u0000(\d+)\u0000/g, (_, i: string) => quoted[Number(i)] ?? ''))
    .map((c) => {
      let s = strip(c);
      for (let i = 0; i < 2 && LEAD.test(s); i++) s = s.replace(LEAD, '').trim();
      return s.replace(/\s+please$/i, '').trim();
    })
    .filter((c) => c.length > 0);
}

const RENAME: readonly RegExp[] = [
  /^(?:rename|re-name|relabel)(?:\s+(?:it|this|that|them))?\s+(?:to|as|into)\s+(.+)$/i,
  /^(?:call|name|label|title)\s+(?:it|this|that)\s+(.+)$/i,
  /^(?:change|set)\s+(?:the\s+|its\s+)?(?:label|text|name|title|words?|wording)\s+(?:to|as)\s+(.+)$/i,
  /^(?:it\s+|this\s+)?(?:should\s+)?(?:say|says|read|reads)\s+(.+)$/i,
  /^(?:naam|label)\s+(.+?)\s+(?:karo|kar\s+do|kardo|rakho|rakh\s+do)$/i,
  /^(.+?)\s+(?:naam\s+(?:karo|rakho|kar\s+do|rakh\s+do)|likho|likh\s+do)$/i,
  /^["“](.+)["”]$/,
];
function renameValue(clause: string): string | undefined {
  for (const re of RENAME) {
    const m = re.exec(clause);
    const value = m?.[1] ? unquote(m[1]).slice(0, LIMITS.labelLength).trim() : '';
    if (value) return value;
  }
  return undefined;
}

const HIDE = /^(?:hide|chhupao|chupao|chhupa\s+do|chupa\s+do|chhupa\s+dijiye)(?:\s+(?:it|this|that|them|these|those))?$/i;
const REMOVE = /^(?:remove|delete|erase|get\s+rid\s+of|take\s+(?:it\s+|this\s+)?(?:away|out|off)|drop|hatao|hata\s+do|hata\s+dijiye|nikalo|nikal\s+do|(?:i\s+)?(?:don'?t|do\s+not)\s+need(?:\s+(?:it|this|that))?|not\s+needed)(?:\s+(?:it|this|that|them|these|those))?$/i;
const MOVE = /^(?:(?:move|put|shift)\s+(?:it\s+|this\s+)?)?(up|higher|upar|down|lower|neeche|niche|(?:to\s+the\s+|at\s+the\s+)?top|first|(?:to\s+the\s+|at\s+the\s+)?(?:bottom|end)|last)$/i;
const REQUIRED = /^(?:required|compulsory|mandatory|must(?:\s+be)?\s+fill(?:ed)?(?:\s+in)?|must\s+fill|zaroori|zaruri|jaruri|not\s+optional)$/i;
const OPTIONAL = /^(?:optional|not\s+required|not\s+compulsory|not\s+mandatory|can\s+be\s+(?:blank|empty|skipped))$/i;
const HINT = /^(?:placeholder|hint|example|sample)(?:\s+text)?\s*(?::|=|to|is|should\s+be)?\s+(.+)$/i;
const TONE_DANGER = /^(?:red|dark\s+red|maroon|laal|lal|danger(?:ous)?|warning|alarm)$/i;
const TONE_QUIET = /^(?:plain|grey|gray|white|safed|safaid|light|outline|outlined|hollow|quiet(?:er)?|subtle|simple|secondary|less\s+important|not\s+so\s+bright)$/i;
const TONE_LOUD = /^(?:primary|main(?:\s+colou?r)?|bold|solid|filled|stand\s+out|important|more\s+important|highlight(?:ed)?|bright(?:er)?)$/i;
const BIGGER = /\b(bigger|larger|large|big|taller|wider|increase|enlarge|bada|badi|bade|badhao|badha)\b/i;
const SMALLER = /\b(smaller|small|shorter|narrower|decrease|reduce|shrink|chhota|chhoti|chhote|ghatao)\b/i;
const MUCH = /\b(much|a\s+lot|lot|very|way|bahut|zyada|jyada)\b/i;
const ABOUT_TEXT = /\b(text|font|letters?|writing|words?|likhai|akshar)\b/i;
const ROUND = /\b(round|rounder|rounded|curvy|curved|softer|gol)\b/i;
const SHARP = /\b(sharp|sharper|square|squared|straight|pointy)\b/i;
const INSTRUCTION_NOTE = /^(?:please\s+)?(?:add|make|put|move|remove|delete|hide|show|change|insert|create|need|should|replace|rename|turn|jodo|banao|lagao|hatao|daalo|dalo)\b/i;

const isInput = (c: KalamComponent): c is Extract<KalamComponent, { type: 'number' | 'textInput' | 'date' | 'choice' }> =>
  c.type === 'number' || c.type === 'textInput' || c.type === 'date' || c.type === 'choice';
const isTextLike = (c: KalamComponent) => c.type === 'text' || c.type === 'heading' || c.type === 'stat';

interface Ctx { spec: KalamSpec; parts: LocatedPart[] }
interface ClauseResult { ops: SpecPatchOp[]; notes?: string[]; appWide?: boolean; problem?: string; needs?: VisualEditNeed }

const prop = (component: string, property: string, value: string | number | boolean): SpecPatchOp =>
  ({ op: 'setComponentProperty', component, property, value });

function single(ctx: Ctx): LocatedPart | undefined {
  return ctx.parts.length === 1 ? ctx.parts[0] : undefined;
}

function matchRename(clause: string, ctx: Ctx): ClauseResult | undefined {
  const value = renameValue(clause);
  if (!value) return undefined;
  const p = single(ctx);
  if (!p) return { ops: [], needs: 'single_target' };
  if (value === labelOf(p.component)) return { ops: [], notes: ['It already says that.'] };
  return { ops: [{ op: 'renameComponent', component: p.component.id, label: value }] };
}

function matchRemoval(clause: string, ctx: Ctx): ClauseResult | undefined {
  if (HIDE.test(clause)) return { ops: ctx.parts.map((p) => prop(p.component.id, 'visible', false)) };
  if (REMOVE.test(clause)) return { ops: ctx.parts.map((p): SpecPatchOp => ({ op: 'removeComponent', component: p.component.id })) };
  return undefined;
}

const shown = (c: KalamComponent) => c.visible !== false;

function matchMove(clause: string, ctx: Ctx): ClauseResult | undefined {
  const m = MOVE.exec(clause);
  if (!m?.[1]) return undefined;
  const p = single(ctx);
  if (!p) return { ops: [], needs: 'single_target' };
  const word = m[1].toLowerCase();
  const others = p.screen.children.filter((c) => c.id !== p.component.id && shown(c));
  const visibleBefore = p.screen.children.slice(0, p.index).filter(shown);
  const visibleAfter = p.screen.children.slice(p.index + 1).filter(shown);
  let before: string | null | undefined;
  if (/^(up|higher|upar)$/.test(word)) before = visibleBefore[visibleBefore.length - 1]?.id;
  else if (/^(down|lower|neeche|niche)$/.test(word)) before = visibleAfter.length ? (visibleAfter[1]?.id ?? null) : undefined;
  else if (/top|first/.test(word)) before = others[0]?.id;
  else before = null;
  const ops = before === undefined ? [] : moveOps(ctx.spec, p.component.id, before);
  return ops.length ? { ops } : { ops: [], notes: ['It is already there.'] };
}

function matchRequired(clause: string, ctx: Ctx): ClauseResult | undefined {
  const req = REQUIRED.test(clause);
  if (!req && !OPTIONAL.test(clause)) return undefined;
  if (!ctx.parts.every((p) => isInput(p.component))) return undefined;
  const ops: SpecPatchOp[] = [];
  for (const p of ctx.parts) {
    const c = p.component;
    if (!isInput(c)) continue;
    if (req) {
      if (c.required !== true) ops.push(prop(c.id, 'required', true));
      continue;
    }
    // A field required by the saved data itself is a data change, not a small edit.
    const collection = p.screen.form ? ctx.spec.collections[p.screen.form] : undefined;
    const def = collection && Object.prototype.hasOwnProperty.call(collection.fields, c.field) ? collection.fields[c.field] : undefined;
    if (def?.required) return undefined;
    if (c.required === true) ops.push(prop(c.id, 'required', false));
  }
  return ops.length ? { ops } : { ops: [], notes: [req ? 'It is already required.' : 'It is already optional.'] };
}

function matchHint(clause: string, ctx: Ctx): ClauseResult | undefined {
  const m = HINT.exec(clause);
  if (!m?.[1]) return undefined;
  const p = single(ctx);
  if (!p || (p.component.type !== 'number' && p.component.type !== 'textInput')) return undefined;
  const value = unquote(m[1]).slice(0, LIMITS.labelLength);
  return value ? { ops: [prop(p.component.id, 'placeholder', value)] } : undefined;
}

function matchTone(clause: string, ctx: Ctx): ClauseResult | undefined {
  if (!ctx.parts.every((p) => p.component.type === 'bigButton')) return undefined;
  const tone = TONE_DANGER.test(clause) ? 'danger' : TONE_QUIET.test(clause) ? 'secondary' : TONE_LOUD.test(clause) ? 'primary' : undefined;
  if (!tone) return undefined;
  const ops = ctx.parts
    .filter((p) => ((p.component as { tone?: string }).tone ?? 'primary') !== tone)
    .map((p) => prop(p.component.id, 'tone', tone));
  return ops.length ? { ops } : { ops: [], notes: ['It already looks like that.'] };
}

function matchSize(clause: string, ctx: Ctx): ClauseResult | undefined {
  const bigger = BIGGER.test(clause);
  if (bigger === SMALLER.test(clause) || clause.length > 48) return undefined;
  // A one-line text box that should be "bigger": give it room to write. Scoped to the picked part.
  if (bigger && !ABOUT_TEXT.test(clause) && ctx.parts.every((p) => p.component.type === 'textInput' && !p.component.multiline)) {
    return { ops: ctx.parts.map((p) => prop(p.component.id, 'multiline', true)) };
  }
  const step = MUCH.test(clause) ? 0.2 : 0.1;
  const current = ctx.spec.theme.fontScale;
  const next = Math.min(1.6, Math.max(0.8, Math.round((current + (bigger ? step : -step)) * 100) / 100));
  if (next === current) return { ops: [], notes: [bigger ? 'Text is already as big as it can be.' : 'Text is already as small as it can be.'] };
  return {
    ops: [{ op: 'setThemeNumber', token: 'fontScale', value: next }],
    appWide: true,
    notes: [`The whole app uses one text size, so all text and buttons get ${bigger ? 'bigger' : 'smaller'}.`],
  };
}

function matchCorners(clause: string, ctx: Ctx): ClauseResult | undefined {
  const round = ROUND.test(clause);
  if (round === SHARP.test(clause) || clause.length > 40) return undefined;
  const r = ctx.spec.theme.radius;
  const value = round ? Math.min(32, r + 6) : /\bsquare/i.test(clause) ? 0 : Math.max(0, r - 6);
  if (value === r) return { ops: [], notes: ['The corners already look like that.'] };
  return { ops: [{ op: 'setThemeNumber', token: 'radius', value }], appWide: true, notes: ['The whole app uses one corner shape.'] };
}

type ColourToken = 'primary' | 'background' | 'surface' | 'text';
const TOKEN_NOTES: Record<ColourToken, string> = {
  primary: 'Buttons and highlights across the app share this colour.',
  background: 'Every screen uses this background.',
  surface: 'Cards and boxes across the app share this colour.',
  text: 'All text in the app uses this colour.',
};

function matchColour(clause: string, ctx: Ctx): ClauseResult | undefined {
  if (clause.length > 40) return undefined;
  const hex = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(clause)?.[0];
  const name = hex ? undefined : colourIn(clause);
  const value = hex ? normalizeHex(hex) : name ? COLOUR_WORDS[name] : undefined;
  if (!value) return undefined;
  const label = name ?? colourName(value) ?? 'That';
  const token: ColourToken =
    /\b(background|backgrounds|bg|backdrop|peeche|pichhe)\b/i.test(clause) ? 'background'
      : /\b(text|font|writing|letters|words|likhai|akshar)\b/i.test(clause) ? 'text'
        : /\b(cards?|boxes|surface)\b/i.test(clause) ? 'surface'
          : ctx.parts.length && ctx.parts.every((p) => isTextLike(p.component)) ? 'text' : 'primary';
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  if (token === 'text' && contrast(value, appBackground(ctx.spec)) < 4.5) {
    return { ops: [], problem: `${cap} text would be hard to read on this background. Try a darker colour.` };
  }
  if (token === 'background' && contrast(appText(ctx.spec), value) < 4.5) {
    return { ops: [], problem: `Text would be hard to read on a ${label} background. Try a lighter or darker colour.` };
  }
  const current = ctx.spec.theme[token] ?? presetTokens(ctx.spec)?.[token];
  const ops: SpecPatchOp[] = current && normalizeHex(current) === value ? [] : [{ op: 'setThemeToken', token, value }];
  // A red or plain button would not show the new main colour, so switch the picked button to it.
  if (token === 'primary') {
    for (const p of ctx.parts) {
      if (p.component.type === 'bigButton' && (p.component.tone ?? 'primary') !== 'primary') ops.push(prop(p.component.id, 'tone', 'primary'));
    }
  }
  if (!ops.length) return { ops: [], notes: ['It is already that colour.'] };
  return { ops, appWide: true, notes: [TOKEN_NOTES[token]] };
}

const THEME_OPS: ReadonlySet<SpecPatchOp['op']> = new Set(['setThemeToken', 'setThemeNumber', 'setThemePreset', 'setThemeOption', 'setAppName']);

/** Id of the existing part an op changes (addComponent carries a new part, so it has none). */
function targetOf(op: SpecPatchOp): string | undefined {
  switch (op.op) {
    case 'renameComponent': case 'setComponentProperty': case 'removeComponent': case 'moveComponent': return op.component;
    default: return undefined;
  }
}

/** App-level phrases ("dark theme", "ocean blue look") via the shared deterministic parser. */
function matchAppLevel(clause: string, ctx: Ctx): ClauseResult | undefined {
  const parsed = parseSmallEdit(clause, ctx.spec);
  if (!parsed.ops.length || parsed.unmatched.length || parsed.confidence < 0.6) return undefined;
  const picked = new Set(ctx.parts.map((p) => p.component.id));
  const scoped = parsed.ops.every((op) => {
    const target = targetOf(op);
    return THEME_OPS.has(op.op) || (target !== undefined && picked.has(target));
  });
  if (!scoped) return undefined;
  return { ops: parsed.ops, appWide: parsed.ops.some((op) => THEME_OPS.has(op.op)) };
}

const MATCHERS = [matchRename, matchRemoval, matchMove, matchRequired, matchHint, matchTone, matchSize, matchCorners, matchColour, matchAppLevel];

type WordsMatch =
  | { kind: 'ops'; ops: SpecPatchOp[]; notes: string[]; appWide: boolean }
  | { kind: 'unmatched' }
  | { kind: 'needs'; needs: VisualEditNeed }
  | { kind: 'problem'; message: string };

/** Deterministic, target-aware reading of the words. Every clause must be understood. */
export function matchTargetedWords(spec: KalamSpec, targets: readonly string[], words: string): WordsMatch {
  const parts = targets.map((id) => findPart(spec, id)).filter((p): p is LocatedPart => !!p);
  const ctx: Ctx = { spec, parts };
  const text = words.trim().slice(0, MAX_WORDS);
  // "rename to Tea and Coffee", "hint: e.g. 250": keep the whole value when it holds no other command.
  const lead = strip(text).replace(LEAD, '');
  const whole = renameValue(lead) ?? HINT.exec(lead)?.[1];
  const clauses = whole && !COMMAND_WORDS.test(whole) && !colourIn(whole) ? [lead] : splitClauses(text);
  if (!clauses.length) return { kind: 'unmatched' };
  const ops: SpecPatchOp[] = [];
  const notes: string[] = [];
  let appWide = false;
  for (const clause of clauses) {
    let hit: ClauseResult | undefined;
    for (const m of MATCHERS) {
      hit = m(clause, ctx);
      if (hit) break;
    }
    if (!hit) return { kind: 'unmatched' };
    if (hit.needs) return { kind: 'needs', needs: hit.needs };
    if (hit.problem) return { kind: 'problem', message: hit.problem };
    ops.push(...hit.ops);
    for (const n of hit.notes ?? []) if (!notes.includes(n)) notes.push(n);
    appWide ||= !!hit.appWide;
  }
  return { kind: 'ops', ops, notes, appWide };
}

// ─── Planning ─────────────────────────────────────────────────────────────────
/** moveComponent steps that place `id` just before `before` (null = at the end) on its screen. */
export function moveOps(spec: KalamSpec, id: string, before: string | null): SpecPatchOp[] {
  const at = findPart(spec, id);
  if (!at) return [];
  const ids = at.screen.children.map((c) => c.id);
  const rest = ids.filter((x) => x !== id);
  const to = before === null ? rest.length : rest.indexOf(before);
  if (to < 0) return [];
  const steps = to - at.index;
  return Array.from({ length: Math.abs(steps) }, (): SpecPatchOp => ({ op: 'moveComponent', component: id, direction: steps > 0 ? 'down' : 'up' }));
}

function freshId(spec: KalamSpec, base: string): string {
  const used = new Set<string>([
    ...spec.screens.flatMap((s) => [s.id, ...s.children.map((c) => c.id)]),
    ...Object.keys(spec.collections), ...Object.keys(spec.actions), ...Object.keys(spec.aiBlocks),
    ...RESERVED_IDS,
  ]);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

const needs = (n: VisualEditNeed, message: string): VisualEditPlan => ({ kind: 'needs', needs: n, message });

/** Words the edit service gets: the person's words plus which parts they picked (ids, no labels). */
export function contextualInstruction(spec: KalamSpec, req: VisualEditRequest, words: string): string {
  const parts = req.targets.map((id) => findPart(spec, id)).filter((p): p is LocatedPart => !!p);
  const text = words.trim().slice(0, MAX_WORDS);
  if (!parts.length) {
    const screen = spec.screens.find((s) => s.id === req.screenId);
    const before = req.gesture.kind === 'note' && req.gesture.before ? req.gesture.before : null;
    const where = before ? `just above part ${before}` : 'at the end';
    return `${text}\n\n(Written as a note on view ${screen?.id ?? req.screenId}, ${where}. Place the change there.)`;
  }
  const listed = parts.slice(0, 4).map((p) => `${p.component.type} ${p.component.id}`).join(', ');
  const more = parts.length > 4 ? ` and ${parts.length - 4} more` : '';
  return `${text}\n\n(Selected: ${listed}${more}. Change only ${parts.length > 1 ? 'these parts' : 'this part'} unless the request clearly asks for more.)`;
}

export function planVisualEdit(spec: KalamSpec, req: VisualEditRequest): VisualEditPlan {
  const targets = [...new Set(req.targets)].filter((id) => !!findPart(spec, id));
  const scoped: VisualEditRequest = { ...req, targets };
  const words = (req.instruction ?? '').trim().slice(0, MAX_WORDS);
  const g = req.gesture;

  if (g.kind === 'note') {
    const text = g.text.trim().slice(0, MAX_WORDS);
    if (!text) return needs('instruction', 'Write a note first.');
    if (targets.length) return planWords(spec, scoped, text);
    return planNewText(spec, scoped, text, g.before ?? null);
  }
  if (!targets.length) return needs('target', 'Pick a part of the app first.');

  switch (g.kind) {
    case 'remove': {
      const hide = g.mode === 'hide' || HIDE.test(strip(words));
      if (words && !hide && !REMOVE.test(strip(words))) return { kind: 'ask', instruction: contextualInstruction(spec, scoped, words), words };
      return {
        kind: 'ops', notes: [], appWide: false,
        ops: targets.map((id): SpecPatchOp => (hide ? prop(id, 'visible', false) : { op: 'removeComponent', component: id })),
      };
    }
    case 'move': {
      const [id] = targets;
      if (targets.length !== 1 || !id) return needs('single_target', 'Start the arrow on one part.');
      if (g.before === id) return { kind: 'nothing', message: 'It is already there.' };
      const ops = moveOps(spec, id, g.before);
      if (!ops.length) {
        return g.before !== null && !findPart(spec, g.before)
          ? { kind: 'nothing', message: 'Kalam could not find where the arrow points.' }
          : { kind: 'nothing', message: 'It is already there.' };
      }
      const moved = findPart(spec, id)?.component;
      const anchor = g.before ? findPart(spec, g.before)?.component : undefined;
      const rel = moved?.type === 'stat' && anchor?.type === 'stat' ? 'before' : 'above';
      const summary = moved
        ? anchor ? `Moved ${partName(moved)} ${rel} ${partName(anchor)}` : `Moved ${partName(moved)} to the end of the screen`
        : undefined;
      return { kind: 'ops', ops, notes: [], appWide: false, summary: summary && capitalise(summary) };
    }
    case 'relabel': {
      const [id] = targets;
      if (targets.length !== 1 || !id) return needs('single_target', 'Pick one part to change its words.');
      const part = findPart(spec, id);
      if (!words) return needs('label', `Type the new words for ${part ? partName(part.component) : 'this part'}.`);
      const label = renameValue(strip(words)) ?? (COMMAND_START.test(words) ? undefined : unquote(words).slice(0, LIMITS.labelLength));
      if (label) return { kind: 'ops', ops: [{ op: 'renameComponent', component: id, label }], notes: [], appWide: false };
      return planWords(spec, scoped, words);
    }
    case 'select':
      if (!words) return needs('instruction', 'Say what should change.');
      return planWords(spec, scoped, words);
  }
}

function planWords(spec: KalamSpec, req: VisualEditRequest, words: string): VisualEditPlan {
  const m = matchTargetedWords(spec, req.targets, words);
  switch (m.kind) {
    case 'ops':
      return m.ops.length ? { kind: 'ops', ops: m.ops, notes: m.notes, appWide: m.appWide } : { kind: 'nothing', message: m.notes.join(' ') || 'Nothing to change.' };
    case 'needs':
      return needs(m.needs, m.needs === 'single_target' ? 'Pick just one part for that.' : 'Say what should change.');
    case 'problem':
      return { kind: 'nothing', message: m.message };
    case 'unmatched':
      return { kind: 'ask', instruction: contextualInstruction(spec, req, words), words };
  }
}

function planNewText(spec: KalamSpec, req: VisualEditRequest, text: string, before: string | null): VisualEditPlan {
  const screen = spec.screens.find((s) => s.id === req.screenId);
  if (!screen) return needs('target', 'Kalam could not tell which screen the note is on.');
  if (INSTRUCTION_NOTE.test(text)) return { kind: 'ask', instruction: contextualInstruction(spec, req, text), words: text };
  if (screen.children.length >= LIMITS.componentsPerScreen) return { kind: 'nothing', message: 'This screen is full. Remove a part to make room.' };
  const found = before ? screen.children.findIndex((c) => c.id === before) : -1;
  const index = found >= 0 ? found : screen.children.length;
  const component: KalamComponent = { id: freshId(spec, 'note_text'), type: 'text', label: unquote(text).slice(0, LIMITS.labelLength) || text.slice(0, LIMITS.labelLength) };
  return { kind: 'ops', ops: [{ op: 'addComponent', screen: screen.id, component, index }], notes: [], appWide: false };
}

// ─── Plain summaries ──────────────────────────────────────────────────────────
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const TOKEN_NAMES: Record<string, string> = {
  primary: 'main colour', secondary: 'second colour', background: 'background colour', surface: 'card colour', text: 'text colour',
};
const AI_KINDS: Record<string, string> = {
  extractFromPhoto: 'reads photos', classify: 'sorts text into groups', summarise: 'shortens long text', translate: 'translates text',
};

function describeProperty(spec: KalamSpec, op: Extract<SpecPatchOp, { op: 'setComponentProperty' }>): string {
  const c = findPart(spec, op.component)?.component;
  const name = c ? partName(c) : 'a part';
  const v = op.value;
  switch (op.property) {
    case 'visible': return v === false ? `Hid ${name}` : `Showed ${name}`;
    case 'tone': return `Made ${name} ${v === 'danger' ? 'red' : v === 'secondary' ? 'plain' : 'use the main colour'}`;
    case 'required': return `Made ${name} ${v ? 'required' : 'optional'}`;
    case 'placeholder': return `Changed the hint in ${name} to "${short(String(v))}"`;
    case 'multiline': return v ? `Gave ${name} more room to write` : `Made ${name} a single line`;
    case 'label': return `Renamed ${name} to "${short(String(v))}"`;
    case 'secondary': return v ? `Hid ${name} in Simple mode` : `Showed ${name} in Simple mode`;
    case 'allowDelete': return v ? `Let people delete rows in ${name}` : `Stopped people deleting rows in ${name}`;
    case 'a11yLabel': case 'a11yDescription': case 'readAloud': return `Changed what is read aloud for ${name}`;
    default: return `Changed ${name}`;
  }
}

/** Plain-language summary of ops, worded against the spec they apply to. */
export function describeOps(spec: KalamSpec, ops: readonly SpecPatchOp[]): string {
  const parts: string[] = [];
  const moves = new Map<string, number>();
  for (const op of ops) {
    const name = (id: string) => {
      const c = findPart(spec, id)?.component;
      return c ? partName(c) : 'a part';
    };
    switch (op.op) {
      case 'setThemeToken': {
        const n = colourName(op.value);
        parts.push(`Changed the ${TOKEN_NAMES[op.token] ?? 'colour'}${n ? ` to ${n}` : ''}`);
        break;
      }
      case 'setThemeNumber':
        if (op.token === 'fontScale' && op.value !== spec.theme.fontScale) parts.push(`Made all text and buttons ${op.value > spec.theme.fontScale ? 'bigger' : 'smaller'}`);
        if (op.token === 'radius' && op.value !== spec.theme.radius) parts.push(`Made corners ${op.value > spec.theme.radius ? 'rounder' : 'sharper'}`);
        break;
      case 'setThemePreset': parts.push(`Switched to the ${op.preset.replace(/_/g, ' ')} look`); break;
      case 'setThemeOption': parts.push(op.option === 'fontFamily' ? 'Changed the font' : `Changed the spacing to ${op.value}`); break;
      case 'setAppName': parts.push(`Renamed the app to "${short(op.value)}"`); break;
      case 'setLanguage': parts.push('Changed the app language'); break;
      case 'renameComponent': parts.push(`Renamed ${name(op.component)} to "${short(op.label)}"`); break;
      case 'setComponentProperty': parts.push(describeProperty(spec, op)); break;
      case 'addComponent': parts.push(op.component.type === 'text' ? `Added the note "${short(op.component.label)}"` : `Added ${partName(op.component)}`); break;
      case 'removeComponent': parts.push(`Removed ${name(op.component)}`); break;
      case 'moveComponent': {
        if (!moves.has(op.component)) parts.push(`\u0000move:${op.component}`);
        moves.set(op.component, (moves.get(op.component) ?? 0) + (op.direction === 'down' ? 1 : -1));
        break;
      }
      case 'addScreen': parts.push(`Added a screen called "${short(op.screen.title)}"`); break;
      case 'removeScreen': {
        const s = spec.screens.find((x) => x.id === op.screen);
        parts.push(s ? `Removed the "${short(s.title)}" screen` : 'Removed a screen');
        break;
      }
      case 'renameScreen': parts.push(`Renamed a screen to "${short(op.title)}"`); break;
      case 'addCollection': parts.push(`Added a place to keep ${op.collection.label ? `"${short(op.collection.label)}"` : 'new records'}`); break;
      case 'updateCollectionField': parts.push(`Set up the "${short(op.definition.label)}" field`); break;
      case 'addAction': parts.push('Added a new button action'); break;
      case 'addAIBlock': parts.push(`Added an AI step that ${AI_KINDS[op.block.kind] ?? 'helps with data'}`); break;
    }
  }
  const text = parts
    .map((p) => {
      if (!p.startsWith('\u0000move:')) return p;
      const id = p.slice('\u0000move:'.length);
      const net = moves.get(id) ?? 0;
      const c = findPart(spec, id)?.component;
      return net === 0 ? '' : `Moved ${c ? partName(c) : 'a part'} ${net < 0 ? 'up' : 'down'}`;
    })
    .filter(Boolean)
    .map((p, i) => (i === 0 ? capitalise(p) : p.charAt(0).toLowerCase() + p.slice(1)))
    .join('; ');
  return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text || 'No changes';
}

// ─── Scope, warnings, diff ────────────────────────────────────────────────────
/** Keeps ops that stay on the picked parts (theme and additive changes allowed). */
export function scopeOps(ops: readonly SpecPatchOp[], targets: readonly string[], screenId: string): { kept: SpecPatchOp[]; dropped: SpecPatchOp[] } {
  const allowed = new Set(targets);
  for (const op of ops) {
    if (op.op === 'addComponent') allowed.add(op.component.id);
    if (op.op === 'addScreen') for (const c of op.screen.children) allowed.add(c.id);
  }
  const kept: SpecPatchOp[] = [];
  const dropped: SpecPatchOp[] = [];
  for (const op of ops) {
    const target = targetOf(op);
    const ok = target !== undefined ? allowed.has(target)
      : op.op === 'removeScreen' ? false
        : op.op === 'renameScreen' ? op.screen === screenId
          : true;
    (ok ? kept : dropped).push(op);
  }
  return { kept, dropped };
}

/** Plain consequences of removing or hiding buttons that do real work. */
export function removalWarnings(spec: KalamSpec, ops: readonly SpecPatchOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    const id = op.op === 'removeComponent' ? op.component
      : op.op === 'setComponentProperty' && op.property === 'visible' && op.value === false ? op.component : undefined;
    const c = id ? findPart(spec, id)?.component : undefined;
    if (c?.type !== 'bigButton' || !Object.prototype.hasOwnProperty.call(spec.actions, c.action)) continue;
    const action = spec.actions[c.action];
    if (action?.type === 'insert') out.push(`Without ${partName(c)}, entries on this screen can't be saved.`);
    else if (action?.type === 'update') out.push(`Without ${partName(c)}, changes on this screen can't be saved.`);
    else if (action?.type === 'navigate') {
      const s = spec.screens.find((x) => x.id === action.screen);
      out.push(`Without ${partName(c)}, there may be no way to open ${s ? `"${short(s.title)}"` : 'the next screen'}.`);
    }
  }
  return out;
}

export interface PartDiff { changed: string[]; added: string[]; removed: string[]; moved: string[]; appChanged: boolean }

/** Which parts a proposed spec changes, for the preview highlight. */
export function diffParts(before: KalamSpec, after: KalamSpec): PartDiff {
  const index = (spec: KalamSpec) => {
    const m = new Map<string, { screen: string; json: string }>();
    for (const s of spec.screens) for (const c of s.children) m.set(c.id, { screen: s.id, json: JSON.stringify(c) });
    return m;
  };
  const a = index(before);
  const b = index(after);
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [id, v] of b) {
    const old = a.get(id);
    if (!old) added.push(id);
    else if (old.json !== v.json) changed.push(id);
  }
  for (const id of a.keys()) if (!b.has(id)) removed.push(id);
  // Moved: parts outside the longest run that kept its order (so one move flags one part).
  const moved: string[] = [];
  for (const s of after.screens) {
    const prev = before.screens.find((x) => x.id === s.id);
    if (!prev) continue;
    const common = s.children.map((c) => c.id).filter((id) => a.get(id)?.screen === s.id);
    const oldPos = new Map(prev.children.map((c, i) => [c.id, i]));
    const seq = common.map((id) => oldPos.get(id) ?? 0);
    const keep = longestIncreasing(seq);
    common.forEach((id, i) => {
      if (!keep.has(i)) moved.push(id);
    });
  }
  const app = (s: KalamSpec) => JSON.stringify([s.theme, s.name, s.lang, s.icon ?? null]);
  return { changed, added, removed, moved, appChanged: app(before) !== app(after) };
}

/** Indices of one longest strictly increasing subsequence (n ≤ 40, O(n²) is fine). */
function longestIncreasing(seq: readonly number[]): Set<number> {
  const len = seq.map(() => 1);
  const prev = seq.map(() => -1);
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) {
      if ((seq[j] as number) < (seq[i] as number) && (len[j] as number) + 1 > (len[i] as number)) {
        len[i] = (len[j] as number) + 1;
        prev[i] = j;
      }
    }
  }
  let end = -1;
  len.forEach((l, i) => {
    if (end < 0 || l > (len[end] as number)) end = i;
  });
  const out = new Set<number>();
  for (let i = end; i >= 0; i = prev[i] as number) out.add(i);
  return out;
}

// ─── Running ──────────────────────────────────────────────────────────────────
const classOf = (ops: readonly SpecPatchOp[]): EditClass => (ops.some((o) => STRUCTURAL_OPS.has(o.op)) ? 'structural' : 'small');
const isAppWideOp = (op: SpecPatchOp) => THEME_OPS.has(op.op) || op.op === 'setLanguage';
const sameOp = (a: SpecPatchOp, b: SpecPatchOp) => JSON.stringify(a) === JSON.stringify(b);

function failure(partial: Partial<VisualEditOutcome> & { message: string }): VisualEditOutcome {
  return {
    ok: false, ops: [], summary: 'No changes', notes: [], warnings: [], route: 'deterministic', provider: 'deterministic',
    editClass: 'small', appWide: false, errors: [], ...partial,
  };
}

function finish(
  base: KalamSpec, proposed: KalamSpec, ops: SpecPatchOp[],
  meta: Pick<VisualEditOutcome, 'route' | 'provider' | 'editClass'> & { notes: string[]; appWide: boolean; summary?: string },
): VisualEditOutcome {
  const checked = validateSpec(proposed);
  if (!checked.ok || !checked.spec) {
    return failure({ message: "That change would break the app, so Kalam didn't make it.", errors: checked.errors, route: meta.route, provider: meta.provider });
  }
  return {
    ok: true, spec: checked.spec, ops,
    summary: meta.summary ?? describeOps(base, ops),
    notes: meta.notes, warnings: removalWarnings(base, ops),
    route: meta.route, provider: meta.provider, editClass: meta.editClass, appWide: meta.appWide, errors: [],
  };
}

/** Plans and runs one visual edit. The result is a proposal: nothing is saved here. */
export async function runVisualEdit(spec: KalamSpec, req: VisualEditRequest, deps: VisualEditDeps): Promise<VisualEditOutcome> {
  const plan = planVisualEdit(spec, req);
  if (plan.kind === 'needs') return failure({ needs: plan.needs, message: plan.message });
  if (plan.kind === 'nothing') return failure({ message: plan.message });

  if (plan.kind === 'ops') {
    const res = applyPatchOps(spec, plan.ops);
    if (!res.ok || !res.spec) {
      const removing = plan.ops.some((o) => o.op === 'removeComponent');
      return failure({
        message: removing
          ? "Other parts of the app still use it, so Kalam can't remove it. You can hide it instead."
          : "That change would break the app, so Kalam didn't make it.",
        errors: res.errors,
      });
    }
    return finish(spec, res.spec, plan.ops, {
      route: 'deterministic', provider: 'deterministic', editClass: classOf(plan.ops), notes: plan.notes, appWide: plan.appWide, summary: plan.summary,
    });
  }

  // Words Kalam can't map on its own: the edit service decides (parser → Nano → Firebase cloud).
  const out = await deps.edit.applyInstruction(spec, plan.instruction, { signal: deps.signal });
  const meta = { route: out.route, provider: out.provider, editClass: out.editClass };
  if (!out.ok || !out.spec) {
    return failure({ ...meta, message: out.message ?? "Kalam couldn't make that change. Try saying it differently.", errors: out.errors });
  }
  const targets = [...new Set(req.targets)].filter((id) => !!findPart(spec, id));
  const ops = out.ops ?? [];
  if (!out.ops) {
    // No op list to check: compare the specs instead.
    const d = diffParts(spec, out.spec);
    if ([...d.changed, ...d.removed, ...d.moved].some((id) => !targets.includes(id))) {
      return failure({ ...meta, message: 'That suggestion changed other parts of the app, so Kalam did not use it. Try saying it differently.' });
    }
    return finish(spec, out.spec, [], { ...meta, notes: [], appWide: d.appChanged, summary: 'Changed the picked part' });
  }
  // The service's own parser read our added context too; only trust ops the person's words give.
  if (out.route === 'deterministic') {
    const own = parseSmallEdit(plan.words, spec).ops;
    if (!ops.every((op) => own.some((o) => sameOp(o, op)))) {
      return failure({ ...meta, message: "Kalam couldn't work out that change here. Try other words, or connect to the internet." });
    }
  }
  const { kept, dropped } = scopeOps(ops, targets, req.screenId);
  if (!kept.length) {
    return failure({ ...meta, message: 'That suggestion changed other parts of the app, so Kalam did not use it. Try saying it differently.' });
  }
  let proposed = out.spec;
  if (dropped.length) {
    const res = applyPatchOps(spec, kept);
    if (!res.ok || !res.spec) return failure({ ...meta, message: "Kalam couldn't make that change safely. Try saying it differently.", errors: res.errors });
    proposed = res.spec;
  }
  return finish(spec, proposed, kept, {
    ...meta,
    editClass: classOf(kept),
    notes: dropped.length ? ['Kalam left the other parts of the app as they were.'] : [],
    appWide: kept.some(isAppWideOp),
  });
}
