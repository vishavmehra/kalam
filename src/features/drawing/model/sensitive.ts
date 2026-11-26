/**
 * Looks for private details in the typed text of a drawing before it can go to the cloud (docs/11 §7.5 "ask before cloud
 * processing when the drawing contains potentially sensitive information"). It reads only text objects, on this device,
 * and returns kinds, never the values. A guess: it can miss a detail and it can flag a harmless number, which is why it
 * only asks a question and never blocks.
 */
import type { DrawingDocument } from '@/core/contracts';

export type SensitiveKind = 'card' | 'id' | 'phone' | 'email' | 'secret';

/** Order the kinds are named in. */
export const SENSITIVE_ORDER: readonly SensitiveKind[] = ['card', 'id', 'phone', 'email', 'secret'];

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
const CARD_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;
/** Aadhaar (twelve digits, often in groups of four) and PAN (five letters, four digits, a letter). */
const ID = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b[A-Z]{5}\d{4}[A-Z]\b/;
const PHONE = /(?:\+\d{1,3}[ -]?)?\b\d{5}[ -]?\d{5}\b|\b\d{10}\b/;
const SECRET = /\b(?:password|passcode|passwd|pin|otp|cvv|secret key)\b|पासवर्ड|ओटीपी|पिन/iu;

/** Luhn check, so a long number is only called a card number when it can be one. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export function sensitiveKindsIn(text: string): SensitiveKind[] {
  const found = new Set<SensitiveKind>();
  // A card number is taken out of the text once found, so its groups of digits are not also read as an ID or a phone.
  let rest = text;
  for (const run of text.match(CARD_RUN) ?? []) {
    if (luhnValid(run.replace(/\D/g, ''))) { found.add('card'); rest = rest.replace(run, ' '); }
  }
  if (ID.test(rest)) found.add('id');
  if (PHONE.test(rest)) found.add('phone');
  if (EMAIL.test(text)) found.add('email');
  if (SECRET.test(text)) found.add('secret');
  return SENSITIVE_ORDER.filter((k) => found.has(k));
}

/** Kinds of private detail found in the visible text of a drawing, in a fixed order. Empty when none. */
export function findSensitive(doc: Pick<DrawingDocument, 'pages'>): SensitiveKind[] {
  const found = new Set<SensitiveKind>();
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.kind !== 'text' || el.hidden) continue;
      for (const k of sensitiveKindsIn(el.text)) found.add(k);
    }
  }
  return SENSITIVE_ORDER.filter((k) => found.has(k));
}
