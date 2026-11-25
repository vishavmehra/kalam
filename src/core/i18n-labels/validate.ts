/**
 * Checks on one translated label (docs/10 §15.2, docs/03 §20.3). A translation is accepted only when
 * it is not empty, keeps placeholders and numbers, is written in the right script and is a sane length.
 * Anything else is rejected and the original label stays on screen. Pure TypeScript.
 */
import { detectScripts, scriptForLanguage } from '../../i18n/scripts';

export type TranslationRejection =
  | 'not_text' | 'empty' | 'too_long' | 'placeholders_changed' | 'numbers_changed' | 'wrong_script';

export type TranslationCheck =
  | { ok: true; text: string }
  | { ok: false; reason: TranslationRejection };

/** `{name}`, `{{count}}`, `%s`, `%1$d`, `${x}`, `[[x]]` and simple tags such as `<b>`. */
const PLACEHOLDER = /\{\{[^{}]{1,40}\}\}|\{[^{}]{1,40}\}|\$\{[^}]{1,40}\}|%\d*\$?[sdif@]|\[\[[^\]]{1,40}\]\]|<\/?[A-Za-z][^<>]{0,40}>/g;

/** Code point of "zero" in each digit set that a model may write: Arabic-Indic and the Indian scripts. */
const DIGIT_ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66] as const;

/** Longest accepted translation, whatever the source length. */
export const MAX_TRANSLATION_CHARS = 400;

export function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER) ?? [];
}

/** Maps Devanagari, Bengali, Tamil, ... digits to 0-9 so `५` and `5` compare equal. */
export function toAsciiDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

/** Numbers as written, with thousands commas removed: `1,20,000` gives `120000`. */
export function extractNumbers(text: string): string[] {
  const plain = toAsciiDigits(text).replace(/(\d),(?=\d{2,3}(?!\d))/g, '$1');
  return plain.match(/\d+(?:\.\d+)?/g) ?? [];
}

const sameBag = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\u0001') === [...b].sort().join('\u0001');

/**
 * `source` is the original label, `candidate` what the model wrote, `target` the language asked for.
 * Returns the cleaned text on success. A candidate identical to the source is allowed (names, brands).
 */
export function checkTranslation(source: string, candidate: unknown, target: string): TranslationCheck {
  if (typeof candidate !== 'string') return { ok: false, reason: 'not_text' };
  // Control characters never belong in a label; line breaks only where the source had one.
  // eslint-disable-next-line no-control-regex
  const cleaned = candidate.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const text = (source.includes('\n') ? cleaned : cleaned.replace(/\s*[\r\n]+\s*/g, ' ')).trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_TRANSLATION_CHARS || text.length > source.length * 3 + 24) return { ok: false, reason: 'too_long' };
  if (!sameBag(extractPlaceholders(source), extractPlaceholders(text))) return { ok: false, reason: 'placeholders_changed' };
  if (!sameBag(extractNumbers(source), extractNumbers(text))) return { ok: false, reason: 'numbers_changed' };
  if (text !== source) {
    const found = detectScripts(text);
    // Hindi written in Latin letters ("Hinglish") is a common failure: it needs at least some native script.
    if (found.length > 0 && !found.includes(scriptForLanguage(target))) return { ok: false, reason: 'wrong_script' };
  }
  return { ok: true, text };
}

/** Plain-language reason, for the correction sheet. */
export function describeRejection(reason: TranslationRejection): string {
  switch (reason) {
    case 'not_text': return 'This is not text.';
    case 'empty': return 'Write something, or leave the original label.';
    case 'too_long': return 'This is much longer than the original. Shorten it so it fits on screen.';
    case 'placeholders_changed': return 'Keep the parts in braces, like {name}, exactly as they are.';
    case 'numbers_changed': return 'Keep the same numbers as the original label.';
    case 'wrong_script': return 'Write this in the script of the chosen language.';
  }
}
