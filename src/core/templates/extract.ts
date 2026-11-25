/**
 * Deterministic parameter extraction helpers shared by templates (docs/07 §4.2 — "local
 * parameter extraction"). Pure regex/lexicon work, no model calls. Handles English plus
 * common Hindi/Hinglish phrasing ("Ramesh Tailors naam ka app", "rupaye", "naap").
 */
import { RESERVED_IDS } from '../spec/schema';

/** Lowercase, strip punctuation (keeps Devanagari, ₹ $ € £ %), collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ₹$€£%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-word / whole-phrase containment; both sides already normalised. Tolerates simple plurals. */
export function containsPhrase(normalized: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false;
  const hay = ` ${normalized} `;
  const p = normalizedPhrase;
  return hay.includes(` ${p} `) || hay.includes(` ${p}s `) || hay.includes(` ${p}es `);
}

export function hasPhrase(normalized: string, phrase: string): boolean {
  return containsPhrase(normalized, normalizeText(phrase));
}

const NAME_STOP = /\s+(?:app|application|for|to|with|that|which|where|in|jo|jisme|mein|me)\b.*$/i;

function tidyName(raw: string): string | undefined {
  const name = raw.replace(NAME_STOP, '').replace(/^(?:the|a|an)\s+/i, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "called X", "named X", "titled X", quoted "X", Hinglish "X naam ka/ki/se", "naam X rakho". */
export function extractAppName(text: string): string | undefined {
  const patterns = [
    /\b(?:called|named|titled|name it|name)\s+["“'‘]?([^"”'’.,!?;:\n]{2,60})/i,
    /["“]([^"”\n]{2,40})["”]/,
    /([A-Za-zऀ-ॿ][A-Za-z0-9ऀ-ॿ' ]{1,40}?)\s+naam\s+(?:ka|ki|ke|se|wala|wali)\b/i,
    /\bnaam\s+["“']?([A-Za-zऀ-ॿ][^"”'.,!?;:\n]{1,40}?)\s+(?:rakho|rakh do|hai|ho)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const name = m?.[1] ? tidyName(m[1]) : undefined;
    if (name) return name;
  }
  return undefined;
}

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED';
export const CURRENCY_SYMBOLS: Readonly<Record<CurrencyCode, string>> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED',
};

export function extractCurrency(text: string): CurrencyCode | undefined {
  const t = ` ${text.toLowerCase()} `;
  if (/₹|\brs\.?\s?\d|\brs\b|\brupees?\b|\binr\b|\brupaye\b|\brupaiya\b|\brupay\b|रुपये|रुपए/.test(t)) return 'INR';
  if (/\$|\busd\b|\bdollars?\b/.test(t)) return 'USD';
  if (/€|\beur\b|\beuros?\b/.test(t)) return 'EUR';
  if (/£|\bgbp\b|\bsterling\b/.test(t)) return 'GBP';
  if (/\baed\b|\bdirhams?\b/.test(t)) return 'AED';
  return undefined;
}

/** "cm" / "inches" (avoids the bare word "in"). */
export function extractUnit(text: string): 'cm' | 'in' | undefined {
  const t = text.toLowerCase();
  if (/\b(?:cm|cms|centimet(?:er|re)s?)\b|सेंटीमीटर/.test(t)) return 'cm';
  if (/\binch(?:es)?\b|\d\s*(?:in|")(?:\b|\s|$)|\binchi\b|इंच/.test(t)) return 'in';
  return undefined;
}

const LIST_STOP = /\s+(?:with|for|to|that|which|where|so|and also|also|in (?:rupees|inr|dollars|cm|inches))\b.*$/i;

/** Words that describe the app itself, never a list entry. */
const META_ITEM = /\b(?:app|application|tracker|list|me|it|this|that|something|stuff|things)\b/i;

/**
 * Pulls a comma/"and"-separated list (≥ 2 entries) that follows one of `keywords`, trying each
 * keyword occurrence in text order: "categories food, travel and rent" → ["Food", "Travel", "Rent"].
 */
export function extractList(text: string, keywords: readonly string[], max = 12): string[] | undefined {
  const kw = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  for (const m of text.matchAll(new RegExp(`\\b(?:${kw})\\b`, 'gi'))) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const body = /^\s*(?:like|such as|including|are|is|of|:|-|=|\()?\s*([^.;\n)]+)/i.exec(rest)?.[1];
    if (!body) continue;
    const items = body
      .replace(LIST_STOP, '')
      .split(/,|\band\b|&|\/|\bor\b|\baur\b|\+/i)
      .map((s) => s.replace(/^\s*(?:etc|the|a|an|my)\b/i, '').replace(/\betc\b\.?/i, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 40 && !/^\d+$/.test(s) && !META_ITEM.test(s));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item.charAt(0).toUpperCase() + item.slice(1));
      if (out.length >= max) break;
    }
    if (out.length >= 2) return out;
  }
  return undefined;
}

/** First number following one of the keywords: "target 108", "goal of 50 glasses". */
export function extractNumberAfter(text: string, keywords: readonly string[]): number | undefined {
  const re = new RegExp(`\\b(?:${keywords.join('|')})\\b\\D{0,12}?(\\d+(?:\\.\\d+)?)`, 'i');
  const m = re.exec(text);
  const n = m?.[1] ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

const RESERVED = new Set<string>(RESERVED_IDS);

/** Converts a human label into a valid, unique, non-reserved KalamSpec identifier. */
export function toIdentifier(label: string, used: Set<string>, fallback = 'field'): string {
  let base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  if (!base || !/^[a-z]/.test(base)) base = base ? `${fallback}_${base}`.slice(0, 30) : fallback;
  if (RESERVED.has(base)) base = `${base}_value`;
  let id = base;
  for (let i = 2; used.has(id); i += 1) id = `${base}_${i}`;
  used.add(id);
  return id;
}
