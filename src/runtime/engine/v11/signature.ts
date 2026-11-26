/**
 * Signature storage (KalamSpec 1.1). A signature is saved in a text field as plain numbers:
 * `sig1:` then strokes separated by `.`, each point two 2-character base-36 numbers (0-999) on a
 * 1000 x 400 box. It is parsed back strictly and drawn from numbers only, never as markup.
 * A typed signature (for keyboard, switch and screen reader users) is `sigt:` then the typed name.
 */
import { LIMITS } from '@/core/spec/schema';

export type Point = readonly [number, number];
export type Stroke = readonly Point[];

export const SIG_W = 1000;
export const SIG_H = 400;
const PREFIX = 'sig1:';
const SIGNATURE_RE = /^sig1:(?:[0-9a-z]{4})+(?:\.(?:[0-9a-z]{4})+)*$/;
const MIN_STEP = 4;

const enc = (n: number) => Math.max(0, Math.min(999, Math.round(n))).toString(36).padStart(2, '0');

const TYPED_PREFIX = 'sigt:';
/** 1 to 80 characters, no control characters, not blank. */
const TYPED_RE = /^sigt:(?=.*\S)[^\u0000-\u001f\u007f]{1,80}$/u;

/** Every coordinate of a drawn signature is on the box (0-999): 'zz' (1295) matches the pattern but is not. */
const onBox = (value: string): boolean => (value.slice(PREFIX.length).replace(/\./g, '').match(/../g) ?? []).every((n) => parseInt(n, 36) <= 999);

export function isSignature(value: unknown): value is string {
  return typeof value === 'string' && value.length <= LIMITS.signatureLength &&
    ((SIGNATURE_RE.test(value) && onBox(value)) || TYPED_RE.test(value));
}

/** The typed name of a typed signature, or undefined for a drawn one or anything else. */
export function typedSignature(value: unknown): string | undefined {
  return typeof value === 'string' && TYPED_RE.test(value) ? value.slice(TYPED_PREFIX.length) : undefined;
}

/** A typed name → stored text, or undefined when it is empty, too long or has control characters. */
export function encodeTypedSignature(name: string): string | undefined {
  const text = TYPED_PREFIX + name.replace(/\s+/g, ' ').trim();
  return TYPED_RE.test(text) ? text : undefined;
}

/** Drops points closer than MIN_STEP to the last kept one (pen jitter). */
function thin(stroke: Stroke): Stroke {
  const out: Point[] = [];
  for (const p of stroke) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= MIN_STEP) out.push(p);
  }
  return out;
}

/**
 * Strokes in box units (0..SIG_W, 0..SIG_H) → stored text, or undefined when empty. Long signatures
 * keep every second point until they fit the field limit.
 */
export function encodeSignature(strokes: readonly Stroke[]): string | undefined {
  let kept = strokes.map(thin).filter((s) => s.length > 0);
  for (let pass = 0; pass < 8; pass++) {
    if (!kept.length) return undefined;
    const text = PREFIX + kept.map((s) => s.map(([x, y]) => enc(x) + enc(y)).join('')).join('.');
    if (text.length <= LIMITS.signatureLength) return text;
    kept = kept.map((s) => s.filter((_, i) => i % 2 === 0 || i === s.length - 1));
  }
  return undefined;
}

/** Stored text → strokes, or undefined for anything that is not a well-formed signature. */
export function decodeSignature(value: unknown): Stroke[] | undefined {
  if (!isSignature(value) || !value.startsWith(PREFIX)) return undefined;
  const strokes: Stroke[] = [];
  for (const part of value.slice(PREFIX.length).split('.')) {
    const pts: Point[] = [];
    for (let i = 0; i < part.length; i += 4) {
      const x = parseInt(part.slice(i, i + 2), 36);
      const y = parseInt(part.slice(i + 2, i + 4), 36);
      if (x > 999 || y > 999) return undefined;
      pts.push([x, Math.min(y, SIG_H)]);
    }
    strokes.push(pts);
  }
  return strokes;
}

/** SVG path data built only from numbers, scaled to a width × height box. A dot gets a tiny line. */
export function signaturePath(strokes: readonly Stroke[], width: number, height: number): string {
  const sx = width / SIG_W;
  const sy = height / SIG_H;
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  return strokes
    .filter((s) => s.length)
    .map((s) => {
      const pts = s.length === 1 ? [s[0], [s[0][0] + 1, s[0][1]] as const] : s;
      return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x * sx)} ${f(y * sy)}`).join(' ');
    })
    .join(' ');
}

/** Screen position inside a pad of `width` × `height` → box units. */
export function toBox(x: number, y: number, width: number, height: number): Point {
  const cx = Math.max(0, Math.min(width, x));
  const cy = Math.max(0, Math.min(height, y));
  return [width ? (cx / width) * SIG_W : 0, height ? (cy / height) * SIG_H : 0];
}
