/**
 * Conflicts between modalities (docs/06 §12.4-12.6, docs/16 R-019). Deterministic checks find clear
 * disagreements, for example the text says 3 fields and the drawing has 5 input stamps, and turn each
 * into a plain question. Nothing is silently discarded: the answer becomes a correction item.
 * Conflicts a person can only spot by reading a photo are left to the compiler's clarifications.
 */
import type { DrawingSummary } from '@/core/contracts';
import { conflictCopy, CURRENCY_NAME, languageName } from './copy';
import { differsFrom, type DetectedLanguage } from './language';
import type { ContextConflict } from './types';

export interface ConflictSources {
  texts: ReadonlyArray<{ id: string; text: string }>;
  transcript?: { attachmentId: string; text: string; language?: DetectedLanguage };
  drawing?: DrawingSummary;
  /** The app language and currency the person chose. */
  preferences: { language: string; currency?: string };
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15,
};
const NUM = `(\\d{1,2}|${Object.keys(WORD_NUMBERS).join('|')})`;
const FIELD_RE = new RegExp(`\\b${NUM}\\s+(?:[a-z]+\\s+)?(?:fields?|columns?|inputs?|boxes|details|entries per (?:record|row)|questions?)\\b`, 'gi');
const SCREEN_RE = new RegExp(`\\b${NUM}\\s+(?:[a-z]+\\s+)?(?:screens?|pages?|tabs?)\\b`, 'gi');

const toNumber = (s: string) => WORD_NUMBERS[s.toLowerCase()] ?? Number(s);

/** The one count a text states for `re`, or undefined when it states none or several different ones. */
export function statedCount(text: string, re: RegExp): number | undefined {
  const found = new Set<number>();
  for (const m of text.matchAll(re)) {
    const n = toNumber(m[1]!);
    if (n > 0 && n <= 40) found.add(n);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

const INPUT_STAMPS = new Set(['number', 'textInput', 'date', 'choice', 'toggle', 'photo']);

/** Input stamps in the drawing (the clearest field signal it has), or undefined when there are none. */
export function drawingFieldCount(d: DrawingSummary): number | undefined {
  const n = d.elements.filter((e) => e.kind.startsWith('stamp:') && INPUT_STAMPS.has(e.kind.slice(6))).length;
  return n || undefined;
}

const LANGUAGE_WORDS: Array<[RegExp, string]> = [
  [/\b(?:in|into)\s+hindi\b|हिंदी|हिन्दी/i, 'hi'],
  [/\b(?:in|into)\s+gujarati\b|ગુજરાતી/i, 'gu'],
  [/\b(?:in|into)\s+marathi\b|मराठी/i, 'mr'],
  [/\b(?:in|into)\s+bengali\b|\b(?:in|into)\s+bangla\b|বাংলা/i, 'bn'],
  [/\b(?:in|into)\s+tamil\b|தமிழ்/i, 'ta'],
  [/\b(?:in|into)\s+telugu\b|తెలుగు/i, 'te'],
  [/\b(?:in|into)\s+kannada\b|ಕನ್ನಡ/i, 'kn'],
  [/\b(?:in|into)\s+malayalam\b|മലയാളം/i, 'ml'],
  [/\b(?:in|into)\s+punjabi\b|ਪੰਜਾਬੀ/i, 'pa'],
  [/\b(?:in|into)\s+english\b/i, 'en'],
];

/** The single app language a text asks for ("make it in Hindi"), if any. */
export function askedLanguage(text: string): string | undefined {
  const found = LANGUAGE_WORDS.filter(([re]) => re.test(text)).map(([, code]) => code);
  return found.length === 1 ? found[0] : undefined;
}

const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/₹|\brupees?\b|\brs\.?\s?\d|\binr\b/i, 'INR'],
  [/\$\s?\d|\bdollars?\b|\busd\b/i, 'USD'],
  [/€|\beuros?\b|\beur\b/i, 'EUR'],
  [/£|\bpounds? sterling\b|\bgbp\b/i, 'GBP'],
];

export function mentionedCurrencies(text: string): string[] {
  return CURRENCY_WORDS.filter(([re]) => re.test(text)).map(([, code]) => code);
}

interface Source { where: string; textId?: string; attachmentId?: string }

function make(
  topic: ContextConflict['topic'], observations: ContextConflict['observations'], question: string,
  options: ContextConflict['options'],
): ContextConflict {
  const key = `${topic}|${observations.map((o) => o.statement).join('|')}`;
  return { id: `cf_${topic}`, topic, observations, resolution: 'needs_user_confirmation', question, options, key };
}

/** The English name of a place in the interface language. */
function shown(english: string): string {
  const en = conflictCopy.whereEnglish;
  return english === en.text ? conflictCopy.where.text : english === en.voice ? conflictCopy.where.voice : english === en.drawing ? conflictCopy.where.drawing : english;
}

function countConflict(
  topic: 'field_count' | 'screen_count', noun: 'fields' | 'screens',
  stated: Array<Source & { n: number }>, drawn: number | undefined,
): ContextConflict | undefined {
  const claims: Array<Source & { n: number }> = [...stated];
  if (drawn !== undefined) claims.push({ where: conflictCopy.whereEnglish.drawing, n: drawn });
  const distinct = [...new Map(claims.map((c) => [c.n, c])).values()];
  if (distinct.length < 2) return undefined;
  // The drawing is always last, so `a` is a description or voice note.
  const [a, b] = distinct as [Source & { n: number }, Source & { n: number }];
  const lower = (w: string) => w.charAt(0).toLowerCase() + w.slice(1);
  // A claim's place is kept in English (it is part of what identifies the conflict and of the recorded answer);
  // the question and the buttons name it in the interface language.
  const verb = b.where === conflictCopy.whereEnglish.drawing ? 'shows' : 'says';
  const question = (topic === 'field_count' ? conflictCopy.fieldCount : conflictCopy.screenCount)(
    { n: a.n, where: shown(a.where) }, { n: b.n, where: lower(shown(b.where)) }, verb,
  );
  return make(
    topic,
    distinct.slice(0, 4).map((c) => ({
      ...(c.textId ? { sourceTextId: c.textId } : {}),
      ...(c.attachmentId ? { sourceAttachmentId: c.attachmentId } : {}),
      statement: `${c.where}: ${c.n} ${noun}`,
    })),
    question,
    distinct.slice(0, 4).map((c) => ({
      id: `n${c.n}`,
      label: conflictCopy.useCount(c.n, noun, lower(shown(c.where))),
      correction: conflictCopy.correctionCount(c.n, noun, lower(c.where)),
    })),
  );
}

export function detectConflicts(src: ConflictSources): ContextConflict[] {
  const out: ContextConflict[] = [];
  const voice = src.transcript?.text.trim() ? src.transcript : undefined;
  const speakers: Array<Source & { text: string }> = [
    ...src.texts.map((t) => ({ where: conflictCopy.whereEnglish.text, textId: t.id, text: t.text })),
    ...(voice ? [{ where: conflictCopy.whereEnglish.voice, attachmentId: voice.attachmentId, text: voice.text }] : []),
  ];

  const countsFor = (re: RegExp) =>
    speakers.flatMap((s) => {
      const n = statedCount(s.text, re);
      return n === undefined ? [] : [{ where: s.where, n, ...(s.textId ? { textId: s.textId } : {}), ...(s.attachmentId ? { attachmentId: s.attachmentId } : {}) }];
    });

  const fields = countConflict('field_count', 'fields', countsFor(FIELD_RE), src.drawing ? drawingFieldCount(src.drawing) : undefined);
  if (fields) out.push(fields);
  const pages = src.drawing && src.drawing.pageCount > 0 ? src.drawing.pageCount : undefined;
  const screens = countConflict('screen_count', 'screens', countsFor(SCREEN_RE), pages);
  if (screens) out.push(screens);

  // Language: an explicit request, or speech in another language, against the chosen app language.
  const appLang = src.preferences.language.split('-')[0]!.toLowerCase();
  const asked = speakers.map((s) => ({ s, code: askedLanguage(s.text) })).find((x) => x.code && x.code !== appLang);
  const spoken = voice?.language && differsFrom(voice.language, appLang) ? voice.language.code : undefined;
  const other = asked?.code ?? spoken;
  if (other) {
    const how = asked ? 'mentioned' : 'spoke';
    out.push(make(
      'language',
      [
        { ...(asked?.s.textId ? { sourceTextId: asked.s.textId } : {}), ...(!asked && voice ? { sourceAttachmentId: voice.attachmentId } : {}), statement: `${how === 'spoke' ? 'Spoken' : 'Asked for'}: ${languageName(other)}` },
        { statement: `App language: ${languageName(appLang)}` },
      ],
      conflictCopy.language(languageName(other), languageName(appLang), how),
      [other, appLang].map((code) => ({ id: code, label: conflictCopy.useLanguage(languageName(code)), correction: conflictCopy.correctionLanguage(languageName(code)) })),
    ));
  }

  // Currency: two currencies across inputs and the chosen one.
  const mentioned = [...new Set(speakers.flatMap((s) => mentionedCurrencies(s.text)))];
  const pool = [...new Set([...(src.preferences.currency && mentioned.length ? [src.preferences.currency] : []), ...mentioned])];
  if (pool.length >= 2) {
    const [a, b] = pool as [string, string];
    const name = (c: string) => CURRENCY_NAME[c] ?? c;
    out.push(make(
      'currency',
      pool.slice(0, 4).map((c) => ({ statement: `Currency: ${name(c)}` })),
      conflictCopy.currency(name(a), name(b)),
      pool.slice(0, 4).map((c) => ({ id: c, label: conflictCopy.useCurrency(name(c)), correction: conflictCopy.correctionCurrency(name(c)) })),
    ));
  }
  return out;
}

/**
 * New detection merged with earlier answers: an answered conflict stays answered while its
 * observations are unchanged; conflicts that no longer appear are dropped.
 */
export function mergeConflicts(previous: readonly ContextConflict[], detected: readonly ContextConflict[]): ContextConflict[] {
  return detected.map((d) => {
    const old = previous.find((p) => p.id === d.id && p.key === d.key && p.resolution === 'resolved');
    return old ?? d;
  });
}

/** The person's answer. Returns the resolved conflict and the correction sentence to record. */
export function answerConflict(c: ContextConflict, optionId: string): { conflict: ContextConflict; correction: string } | undefined {
  const option = c.options.find((o) => o.id === optionId);
  if (!option) return undefined;
  return { conflict: { ...c, resolution: 'resolved', resolutionNote: option.label }, correction: option.correction };
}

export const openConflicts = (all: readonly ContextConflict[]) => all.filter((c) => c.resolution === 'needs_user_confirmation');
