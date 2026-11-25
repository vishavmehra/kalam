/**
 * What the voice agent says about a screen (docs/10 §4.5, docs/03 §19.6). Built only from the
 * KalamSpec and the Access Modes, so it is exact, deterministic and testable. Pure TypeScript.
 *
 * Wording rules: short sentences, plain words, no dashes used as punctuation.
 */
import type { AccessModes } from '@/core/contracts';
import type { KalamScreen, KalamSpec } from '@/core/spec/schema';
import { screenFieldDefs } from './fields';
import { visibleChildren } from './theme';

const MAX_SPOKEN_ACTIONS = 5;
const MAX_SPOKEN_FIELDS = 4;
const MAX_DESCRIPTION = 120;

/** "A", "A or B", "A, B or C". */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Button labels the person can say on this screen (the voice service also matches them). */
export function spokenActionLabels(spec: KalamSpec, screen: KalamScreen, modes: AccessModes): string[] {
  const labels: string[] = [];
  for (const c of visibleChildren(screen, modes)) {
    if (c.type === 'bigButton' && spec.actions[c.action]) labels.push(c.label);
  }
  return unique(labels);
}

/** Field names the person can say with a value, e.g. "chest 40". */
export function spokenFieldLabels(spec: KalamSpec, screen: KalamScreen): string[] {
  return unique(Object.values(screenFieldDefs(spec, screen)).map((d) => d.label));
}

export interface ScreenAnnouncement {
  title: string;
  actions: string[];
  fields: string[];
  text: string;
}

/**
 * Voice-only Mode: spoken when a screen opens. Title first, then what can be said.
 * `first` adds the one-line microphone hint, for the first screen of a session.
 */
export function buildScreenAnnouncement(
  spec: KalamSpec, screen: KalamScreen, modes: AccessModes, opts: { first?: boolean } = {},
): ScreenAnnouncement {
  const actions = spokenActionLabels(spec, screen, modes);
  const fields = spokenFieldLabels(spec, screen);
  const parts: string[] = [`${screen.title}.`];
  if (screen.description && screen.description.length <= MAX_DESCRIPTION) parts.push(ensureStop(screen.description));
  if (opts.first) parts.push('Tap the microphone to talk.');
  if (actions.length) {
    const shown = actions.slice(0, MAX_SPOKEN_ACTIONS);
    parts.push(`You can say: ${listPhrase(shown)}.`);
    if (actions.length > shown.length) parts.push('Say help for the rest.');
  } else {
    parts.push('There are no spoken commands on this screen.');
  }
  if (fields.length) {
    const shown = fields.slice(0, MAX_SPOKEN_FIELDS);
    const more = fields.length - shown.length;
    const names = more > 0 ? `${shown.join(', ')} and ${more} more` : listPhrase(shown);
    parts.push(`To fill in a field, say its name and the value. Fields: ${names}.`);
  }
  return { title: screen.title, actions, fields, text: parts.join(' ') };
}

/** Reply to "help": every command on this screen, plus the agent's own commands. */
export function buildHelpText(spec: KalamSpec, screen: KalamScreen, modes: AccessModes): string {
  const actions = spokenActionLabels(spec, screen, modes);
  const fields = spokenFieldLabels(spec, screen);
  const parts: string[] = [];
  parts.push(actions.length ? `On this screen you can say: ${listPhrase(actions)}.` : 'There are no spoken commands on this screen.');
  if (fields.length) parts.push(`To fill in a field, say its name and the value. Fields: ${listPhrase(fields)}.`);
  parts.push('Say repeat to hear the last answer again. Say stop to be quiet. Say cancel to drop a question.');
  return parts.join(' ');
}

function ensureStop(s: string): string {
  const t = s.trim();
  return /[.!?।]$/.test(t) ? t : `${t}.`;
}
export { ensureStop };

/**
 * Words the recogniser should expect on this screen: button labels, field names, choice options and
 * the author's intent phrases. Bounded, so it is safe to hand to a recogniser.
 */
export function voiceHints(spec: KalamSpec, screen: KalamScreen): string[] {
  const out: string[] = [];
  for (const c of screen.children) if (c.type === 'bigButton') out.push(c.label);
  for (const def of Object.values(screenFieldDefs(spec, screen))) {
    out.push(def.label);
    for (const o of def.options ?? []) out.push(o);
  }
  for (const phrases of Object.values(spec.intents)) out.push(...phrases.slice(0, 3));
  return unique(out).filter((s) => s.length <= 40).slice(0, 100);
}
