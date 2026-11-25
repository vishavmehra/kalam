/** Small colour helpers for user/app-provided hex colours (KalamSpec themes are untrusted data). */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance (0–1). Invalid input counts as mid-grey. */
export function luminance(hex: string): number {
  const c = channels(hex);
  if (!c) return 0.2;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink or white — whichever reads better on `background`. */
export function readableOn(background: string, dark = '#202820', light = '#FFFFFF'): string {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/** `#RRGGBB` + alpha → `rgba()`; falls back to the input for non-hex values. */
export function withAlpha(hex: string, alpha: number): string {
  const c = channels(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : hex;
}

/** Returns `hex` if it is a valid colour, otherwise `fallback`. */
export function safeColor(hex: string | undefined, fallback: string): string {
  return hex && HEX.test(hex) ? hex : fallback;
}
