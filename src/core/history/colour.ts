/** Everyday names for hex colours, so history can say "dark green" instead of "#1F6F5C". Pure TypeScript. */

function toHsl(hex: string): { h: number; s: number; l: number } | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function hueName(h: number, l: number): string {
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return l < 0.4 ? 'brown' : 'orange';
  if (h < 65) return l < 0.4 ? 'olive' : 'yellow';
  if (h < 170) return 'green';
  if (h < 195) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

/** `#1F6F5C` becomes `dark green`. Anything that is not a six digit hex colour comes back unchanged. */
export function colourName(hex: string): string {
  const c = toHsl(hex);
  if (!c) return hex;
  const { h, s, l } = c;
  if (l >= 0.96) return 'white';
  if (l <= 0.1) return 'black';
  if (s < 0.1) return l > 0.78 ? 'light grey' : l < 0.3 ? 'dark grey' : 'grey';
  if (l > 0.88 && h >= 25 && h < 70) return 'cream';
  const base = hueName(h, l);
  if (base === 'brown' || base === 'olive') return base;
  if (l < 0.28) return `dark ${base}`;
  if (l > 0.75) return `light ${base}`;
  return base;
}
