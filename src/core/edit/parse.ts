/**
 * Deterministic edit understanding (docs/07 §15.1–15.2): no model call. Handles common English and
 * simple Hinglish ("button hara karo") small edits; anything it cannot map is returned as
 * `unmatched` so the edit service can escalate to Gemini Nano (small) or Firebase cloud (structural).
 */
import type { EditClass, SpecPatchOp } from '../contracts';
import type { KalamComponent, KalamSpec, ThemePreset } from '../spec/schema';
import { COLOUR_WORDS, DARK_TOKENS, LIGHT_TOKENS } from './presets';

type ColourToken = 'primary' | 'secondary' | 'background' | 'surface' | 'text';
interface Match { ops: SpecPatchOp[]; confidence: number }

// ─── Text helpers ─────────────────────────────────────────────────────────────
const HINGLISH_VERBS = /\s+(?:karo|kar\s+do|kardo|kar\s+dijiye|kijiye|karein|banao|bana\s+do|rakho|rakh\s+do|chahiye|please)$/i;
const clean = (s: string): string => s.trim().replace(/^["“'‘]|["”'’]$/g, '').replace(/[.!?]+$/, '').trim();
const unquote = (s: string): string => clean(s).replace(/^["“'‘](.*)["”'’]$/, '$1').trim();

const STOP = new Set([
  'the', 'a', 'an', 'my', 'this', 'that', 'button', 'btn', 'field', 'box', 'input', 'screen', 'page', 'label', 'wala',
  'wali', 'wale', 'waala', 'ko', 'ka', 'ki', 'ke', 'section', 'component', 'please', 'one', 'on', 'of',
]);
const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t));

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const tokenMatch = (a: string, b: string): boolean =>
  a === b ||
  (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) ||
  (a.length >= 4 && b.length >= 4 && withinOneEdit(a, b));

/** Dice similarity over meaningful tokens with typo tolerance. 0..1. */
export function labelSimilarity(query: string, candidate: string): number {
  const q = tokens(query);
  const c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  if (q.join(' ') === c.join(' ')) return 1;
  const hits = q.filter((t) => c.some((u) => tokenMatch(t, u))).length;
  return (2 * hits) / (q.length + c.length);
}

const TYPE_WORDS: Partial<Record<KalamComponent['type'], string[]>> = {
  photo: ['photo', 'camera', 'picture', 'image', 'scan'],
  list: ['list'],
  stat: ['total', 'summary', 'stat', 'count'],
  counter: ['counter'],
  heading: ['heading', 'title'],
};

interface Target { kind: 'component' | 'screen'; id: string; score: number; ambiguous: boolean }

function findTarget(spec: KalamSpec, query: string, kinds: ReadonlyArray<Target['kind']>): Target | undefined {
  const scored: Target[] = [];
  const qTokens = tokens(query);
  if (kinds.includes('component')) {
    const all = spec.screens.flatMap((s) => s.children);
    for (const c of all) {
      const labels = [('label' in c && c.label) || '', c.a11yLabel ?? ''].filter(Boolean);
      let score = Math.max(0, ...labels.map((l) => labelSimilarity(query, l)));
      const words = TYPE_WORDS[c.type];
      if (score < 0.5 && words && qTokens.some((t) => words.includes(t)) && all.filter((x) => x.type === c.type).length === 1) {
        score = 0.7;
      }
      scored.push({ kind: 'component', id: c.id, score, ambiguous: false });
    }
  }
  if (kinds.includes('screen')) {
    for (const s of spec.screens) scored.push({ kind: 'screen', id: s.id, score: labelSimilarity(query, s.title), ambiguous: false });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.5) return undefined;
  return { ...best, ambiguous: (scored[1]?.score ?? 0) === best.score && best.score < 1 };
}

// ─── Matchers (each receives one clause, original casing) ─────────────────────
function matchAppName(clause: string): Match | undefined {
  const patterns = [
    /^(?:call|name|rename)\s+(?:the\s+|this\s+|my\s+)?app\s+(?:to\s+|as\s+)?(.+)$/i,
    /^(?:change|set)\s+(?:the\s+)?app(?:'s)?\s+(?:name|title)\s+to\s+(.+)$/i,
    /^app\s+(?:ka|ko)\s+naam\s+(.+?)$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(clause.replace(HINGLISH_VERBS, ''));
    const value = m?.[1] ? unquote(m[1]) : '';
    if (value) return { ops: [{ op: 'setAppName', value: value.slice(0, 60) }], confidence: 0.95 };
  }
  return undefined;
}

function matchRename(clause: string, spec: KalamSpec): Match | undefined {
  const c = clause.replace(HINGLISH_VERBS, '');
  const m =
    /^(?:rename|re-name)\s+(.+?)\s+(?:to|as|into)\s+(.+)$/i.exec(c) ??
    /^change\s+(?:the\s+)?(?:label|name|title|text)\s+(?:of|on)\s+(.+?)\s+to\s+(.+)$/i.exec(c) ??
    /^(.+?)\s+ka\s+naam\s+(.+)$/i.exec(c);
  if (!m?.[1] || !m[2]) return undefined;
  const from = unquote(m[1]);
  const to = unquote(m[2]).slice(0, 120);
  if (!to) return undefined;
  if (/^(?:the\s+|this\s+|my\s+)?app$/i.test(from)) return { ops: [{ op: 'setAppName', value: to.slice(0, 60) }], confidence: 0.95 };
  const wantsScreen = /\b(screen|page|tab)\b/i.test(from);
  const target = findTarget(spec, from, wantsScreen ? ['screen'] : ['component', 'screen']);
  if (!target) return undefined;
  const confidence = Math.min(0.95, target.score) * (target.ambiguous ? 0.7 : 1);
  return target.kind === 'screen'
    ? { ops: [{ op: 'renameScreen', screen: target.id, title: to.slice(0, 60) }], confidence }
    : { ops: [{ op: 'renameComponent', component: target.id, label: to }], confidence };
}

function matchVisibility(clause: string, spec: KalamSpec): Match | undefined {
  const c = clause.replace(HINGLISH_VERBS, '');
  const rules: Array<[RegExp, boolean, number]> = [
    [/^(?:please\s+)?hide\s+(.+)$/i, false, 0.9],
    [/^(?:please\s+)?(?:remove|delete|get\s+rid\s+of|take\s+away)\s+(.+)$/i, false, 0.7],
    [/^(.+?)\s+(?:ko\s+)?(?:chhupao|chupao|chhupa\s+do|chupa\s+do|hatao|hata\s+do|hata\s+dijiye)$/i, false, 0.85],
    [/^(?:please\s+)?(?:show|unhide|bring\s+back|display)\s+(.+)$/i, true, 0.9],
    [/^(.+?)\s+(?:ko\s+)?(?:dikhao|dikha\s+do|wapas\s+lao)$/i, true, 0.85],
  ];
  for (const [re, visible, base] of rules) {
    const m = re.exec(c);
    if (!m?.[1]) continue;
    const target = findTarget(spec, unquote(m[1]), ['component']);
    if (!target) return undefined;
    return {
      ops: [{ op: 'setComponentProperty', component: target.id, property: 'visible', value: visible }],
      confidence: base * Math.min(1, target.score + 0.1) * (target.ambiguous ? 0.7 : 1),
    };
  }
  return undefined;
}

const PRESET_PATTERNS: ReadonlyArray<[RegExp, ThemePreset]> = [
  [/\bcalm[\s_-]*green\b/i, 'calm_green'],
  [/\bwarm[\s_-]*paper\b/i, 'warm_paper'],
  [/\bocean([\s_-]*blue)?\b/i, 'ocean_blue'],
  [/\bsoft[\s_-]*lavender\b|\blavender\s+(?:theme|preset|style)\b/i, 'soft_lavender'],
  [/\bminimal([\s_-]*neutral)?\b/i, 'minimal_neutral'],
  [/\bhigh[\s_-]*contrast\b/i, 'high_contrast'],
];
function matchPreset(clause: string): Match | undefined {
  for (const [re, preset] of PRESET_PATTERNS) {
    if (re.test(clause)) return { ops: [{ op: 'setThemePreset', preset }], confidence: 0.95 };
  }
  if (/\b(dark|night)\s*(theme|mode|look|background)\b|\bandhera\b|\bmake\s+it\s+dark\b/i.test(clause)) {
    return { ops: (Object.keys(DARK_TOKENS) as Array<keyof typeof DARK_TOKENS>).map((token): SpecPatchOp => ({ op: 'setThemeToken', token, value: DARK_TOKENS[token] })), confidence: 0.9 };
  }
  if (/\b(light|day|bright)\s*(theme|mode|look)\b|\bmake\s+it\s+light\b/i.test(clause)) {
    return { ops: (Object.keys(LIGHT_TOKENS) as Array<keyof typeof LIGHT_TOKENS>).map((token): SpecPatchOp => ({ op: 'setThemeToken', token, value: LIGHT_TOKENS[token] })), confidence: 0.9 };
  }
  return undefined;
}

const COLOUR_NAMES = Object.keys(COLOUR_WORDS).sort((a, b) => b.length - a.length);
const TOKEN_WORDS: ReadonlyArray<[RegExp, ColourToken]> = [
  [/\b(background|backgrounds|bg|backdrop|peeche|pichhe|pichla)\b/i, 'background'],
  [/\b(text|font|writing|letters|likhai|akshar)\b/i, 'text'],
  [/\b(cards?|surface|boxes)\b/i, 'surface'],
  [/\b(accent|secondary|highlights?)\b/i, 'secondary'],
  [/\b(buttons?|header|primary|main|theme|app|brand|colou?r|rang)\b/i, 'primary'],
];
function matchColour(clause: string): Match | undefined {
  const lower = ` ${clause.toLowerCase()} `;
  const hex = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(clause)?.[0];
  const name = hex ? undefined : COLOUR_NAMES.find((n) => new RegExp(`[^a-z]${n}[^a-z]`).test(lower));
  const value = hex ?? (name ? COLOUR_WORDS[name] : undefined);
  if (!value) return undefined;
  const target = TOKEN_WORDS.find(([re]) => re.test(clause));
  const token: ColourToken = target?.[1] ?? 'primary';
  const explicit = !!target && !/^(theme|app|colou?r|rang)$/i.test(target[0].exec(clause)?.[0] ?? '');
  return { ops: [{ op: 'setThemeToken', token, value }], confidence: explicit ? 0.9 : 0.75 };
}

function matchFontScale(clause: string, spec: KalamSpec): Match | undefined {
  const bigger = /\b(bigger|larger|large|increase|enlarge|zoom\s+in|more\s+readable|bada|badi|bade|badhao|badha)\b/i.test(clause);
  const smaller = /\b(smaller|small|decrease|reduce|shrink|zoom\s+out|chhota|chhoti|chhote|ghatao)\b/i.test(clause);
  if (bigger === smaller) return undefined;
  const aboutText = /\b(text|font|fonts|letters|writing|words|likhai|akshar|size|everything|sab)\b/i.test(clause);
  const aboutButtons = /\bbuttons?\b/i.test(clause);
  if (!aboutText && !aboutButtons) return undefined;
  const step = /\b(much|a\s+lot|lot|very|bahut|zyada)\b/i.test(clause) ? 0.2 : 0.1;
  const next = Math.min(1.6, Math.max(0.8, Math.round((spec.theme.fontScale + (bigger ? step : -step)) * 100) / 100));
  return { ops: [{ op: 'setThemeNumber', token: 'fontScale', value: next }], confidence: aboutText ? 0.9 : 0.65 };
}

function matchCorners(clause: string, spec: KalamSpec): Match | undefined {
  const corners = /\b(corners?|edges?|kone)\b/i.test(clause);
  const round = /\b(round|rounder|rounded|curved|curvy|softer|gol)\b/i.test(clause);
  const sharp = /\b(sharp|sharper|square|squared|straight|less\s+rounded|no\s+round(ed)?|flat)\b/i.test(clause);
  if (!corners && !(round && /\b(buttons?|cards?|boxes)\b/i.test(clause))) return undefined;
  if (round === sharp) return undefined;
  const r = spec.theme.radius;
  const value = round ? Math.min(32, r + 6) : /\b(square|squared|no\s+round(ed)?)\b/i.test(clause) ? 0 : Math.max(0, r - 6);
  return { ops: [{ op: 'setThemeNumber', token: 'radius', value }], confidence: corners ? 0.9 : 0.75 };
}

/** Splits an instruction into clauses ("make it green and the text bigger"). Quoted text stays whole. */
function splitClauses(text: string): string[] {
  const quoted: string[] = [];
  const masked = text.replace(/["“][^"”]*["”]/g, (q) => `\u0000${quoted.push(q) - 1}\u0000`);
  return masked
    .split(/\s*(?:,|;|\.(?=\s|$)|\band\s+then\b|\bthen\b|\balso\b|\band\b|\baur\b|\bphir\b)\s*/i)
    .map((c) => c.replace(/\u0000(\d+)\u0000/g, (_, i: string) => quoted[Number(i)] ?? ''))
    .map((c) => c.trim().replace(/^(?:please|pls|kindly|can\s+you|could\s+you)\s+/i, ''))
    .filter((c) => c.length > 0);
}

/** Deterministic small-edit parser. confidence 0 means "nothing understood". */
export function parseSmallEdit(text: string, spec: KalamSpec): { ops: SpecPatchOp[]; confidence: number; unmatched: string[] } {
  const clauses = splitClauses(String(text ?? '').slice(0, 500));
  const ops: SpecPatchOp[] = [];
  const unmatched: string[] = [];
  const confidences: number[] = [];
  for (const clause of clauses) {
    const m =
      matchAppName(clause) ?? matchRename(clause, spec) ?? matchVisibility(clause, spec) ?? matchPreset(clause) ??
      matchFontScale(clause, spec) ?? matchCorners(clause, spec) ?? matchColour(clause);
    if (m) {
      ops.push(...m.ops);
      confidences.push(m.confidence);
    } else unmatched.push(clause);
  }
  if (!ops.length) return { ops, confidence: 0, unmatched };
  const avg = confidences.reduce((s, c) => s + c, 0) / confidences.length;
  const coverage = confidences.length / clauses.length;
  return { ops, confidence: Math.round(avg * coverage * 100) / 100, unmatched };
}

const STRUCTURAL: ReadonlyArray<[RegExp, string]> = [
  [/\b(add|new|create|another|insert|naya|nayi|naye|jodo|banao)\b.*\b(screens?|pages?|tabs?|sections?)\b|\b(screens?|pages?)\b.*\b(jodo|banao|add)\b/i, 'Adds a new screen'],
  [/\b(add|new|create|another|naya|nayi|jodo)\b.*\b(collections?|tables?|database|data\s+type)\b/i, 'Adds a new kind of saved data'],
  [/\bworkflows?\b|\bapprovals?\b|\bprocess\s+for\b/i, 'Changes how work flows through the app'],
  [/\brelationships?\b|\brelations?\b|\b(link|connect|relate)(ed|s)?\b.*\b(to|with)\b|\bbelongs?\s+to\b/i, 'Links different kinds of data together'],
  [/\b(reports?|dashboards?|charts?|graphs?|analytics)\b/i, 'Adds a report or dashboard'],
  [/\b(roles?|permissions?|log\s?in|sign\s?in|admins?)\b/i, 'Adds roles or sign-in'],
  [/\b(add|new|create|another|jodo)\b.*\b(fields?|columns?|buttons?|inputs?|questions?|counters?|photos?|lists?)\b/i, 'Adds new parts to the app'],
];
const SMALL_WORDS = /\b(colou?rs?|rang|rename|naam|bigger|larger|smaller|size|font|text|hide|show|chhupao|dikhao|translate|label|theme|dark|light|corners?|rounded|preset|style)\b/i;

/** Small = style/label tweaks (deterministic or Nano). Structural = new screens/data/logic (cloud). */
export function classifyEdit(text: string, spec: KalamSpec): { editClass: EditClass; reasons: string[] } {
  const reasons = STRUCTURAL.filter(([re]) => re.test(text)).map(([, why]) => why);
  if (reasons.length) return { editClass: 'structural', reasons };
  const parsed = parseSmallEdit(text, spec);
  if (parsed.ops.length && parsed.unmatched.length === 0) {
    return { editClass: 'small', reasons: ['A simple style, label or visibility change'] };
  }
  if (SMALL_WORDS.test(text)) return { editClass: 'small', reasons: ['Looks like a style or wording change'] };
  return { editClass: 'structural', reasons: ['Not a simple style or label change'] };
}
