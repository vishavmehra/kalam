/**
 * Listing media safety (docs/12 §9.3, §18.1 layer 5, §24.8; docs/11 §11.6). Media from listings is
 * untrusted. SVG icons pass a strict allowlist and are re-serialised from parsed tokens (the input
 * string is never passed through). Screenshots must be real JPEG / PNG / WebP of bounded size,
 * checked from their bytes, not from a claimed MIME type. Pure TypeScript.
 */
import { base64ByteLength, base64ToBytes } from '../backup/base64';

// ─── SVG ──────────────────────────────────────────────────────────────────────

export const SVG_MAX_INPUT = 16_000;
export const SVG_MAX_OUTPUT = 8_000;

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'title', 'desc', 'defs',
  'lineargradient', 'radialgradient', 'stop',
]);
const ATTRIBUTES = new Set([
  'viewbox', 'width', 'height', 'xmlns', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
  'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'offset', 'stop-color', 'stop-opacity', 'id',
  'gradientunits', 'gradienttransform', 'fx', 'fy', 'preserveaspectratio',
]);
/** Original casing for camel-cased SVG names (the allowlists are lowercase). */
const CASE: Record<string, string> = {
  viewbox: 'viewBox', lineargradient: 'linearGradient', radialgradient: 'radialGradient',
  gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', preserveaspectratio: 'preserveAspectRatio',
};
const TEXT_ELEMENTS = new Set(['title', 'desc']);
const SAFE_VALUE = /^[#(),.%\-+\w\s:/]*$/;

export type SvgResult = { ok: true; svg: string } | { ok: false; reason: string };

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cleanValue(name: string, raw: string): string | undefined {
  const value = raw.trim();
  if (value.length > 4000 || !SAFE_VALUE.test(value)) return undefined;
  const lower = value.toLowerCase();
  if (lower.includes('javascript') || lower.includes('data:') || lower.includes('expression')) return undefined;
  // Only local paint servers: url(#id). Anything else could load an external resource.
  const urls = lower.match(/url\(([^)]*)\)/g) ?? [];
  if (urls.some((u) => !/^url\(#[\w-]+\)$/.test(u))) return undefined;
  if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') return undefined;
  return value;
}

/** Allowlist sanitiser. Rejects (rather than repairs) anything scripted, external or malformed. */
export function sanitizeSvg(input: string): SvgResult {
  if (input.length > SVG_MAX_INPUT) return { ok: false, reason: 'The icon file is too large.' };
  let src = input.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<!|<\?|<!\[CDATA\[/i.test(src)) return { ok: false, reason: 'The icon has declarations or entities, which are not allowed.' };
  src = src.trim();
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  const attr = /\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const out: string[] = [];
  const stack: string[] = [];
  let pos = 0;
  let sawRoot = false;
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    const text = src.slice(pos, lt === -1 ? src.length : lt);
    if (text.trim()) {
      if (!TEXT_ELEMENTS.has(stack.at(-1) ?? '')) return { ok: false, reason: 'The icon has text outside a title.' };
      if (/[&]/.test(text) && !/^(?:[^&]|&(?:amp|lt|gt|quot|apos);)*$/.test(text)) return { ok: false, reason: 'The icon has entities, which are not allowed.' };
      out.push(escapeText(text.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ?? '')));
    }
    if (lt === -1) break;
    tag.lastIndex = lt;
    const m = tag.exec(src);
    if (!m) return { ok: false, reason: 'The icon is not valid SVG.' };
    pos = tag.lastIndex;
    const [, closing, rawName = '', attrs = '', selfClosing] = m;
    const name = rawName.toLowerCase();
    if (!ELEMENTS.has(name)) return { ok: false, reason: `The icon uses <${rawName}>, which is not allowed.` };
    if (closing) {
      if (stack.pop() !== name) return { ok: false, reason: 'The icon is not valid SVG.' };
      out.push(`</${CASE[name] ?? name}>`);
      continue;
    }
    if (!sawRoot) {
      if (name !== 'svg' || lt !== 0) return { ok: false, reason: 'The file must start with <svg>.' };
      sawRoot = true;
    } else if (!stack.length) {
      return { ok: false, reason: 'The icon has content after </svg>.' };
    }
    const parts: string[] = [];
    for (const a of attrs.matchAll(attr)) {
      const attrName = (a[1] ?? '').toLowerCase();
      if (attrName.startsWith('on') || attrName.includes('href') || attrName === 'style') {
        return { ok: false, reason: 'The icon has scripts, links or styles, which are not allowed.' };
      }
      if (!ATTRIBUTES.has(attrName)) continue; // unknown presentation attributes are dropped
      const value = cleanValue(attrName, a[2] ?? a[3] ?? '');
      if (value === undefined) return { ok: false, reason: 'The icon has an unsafe attribute value.' };
      parts.push(`${CASE[attrName] ?? attrName}="${value}"`);
    }
    if (name === 'svg' && !parts.some((p) => p.startsWith('xmlns='))) parts.unshift('xmlns="http://www.w3.org/2000/svg"');
    out.push(`<${CASE[name] ?? name}${parts.length ? ` ${parts.join(' ')}` : ''}${selfClosing ? ' />' : '>'}`);
    if (!selfClosing) stack.push(name);
  }
  if (!sawRoot || stack.length) return { ok: false, reason: 'The icon is not valid SVG.' };
  const svg = out.join('');
  if (svg.length > SVG_MAX_OUTPUT) return { ok: false, reason: 'The icon is too detailed. Use a simpler drawing.' };
  return { ok: true, svg };
}

// ─── Screenshots ──────────────────────────────────────────────────────────────

export const SCREENSHOT_LIMITS = { count: 3, maxBytes: 100_000, minSide: 64, maxSide: 1280, maxAspect: 4 } as const;
export type ScreenshotMime = 'image/jpeg' | 'image/png' | 'image/webp';
export interface Screenshot { mimeType: ScreenshotMime; base64: string; width: number; height: number }
export type ScreenshotResult = { ok: true; screenshot: Screenshot } | { ok: false; reason: string };

/** Width/height read from the image header bytes. Undefined when the bytes are not that format. */
export function imageSize(bytes: Uint8Array): { mimeType: ScreenshotMime; width: number; height: number } | undefined {
  const at = (i: number) => bytes[i] ?? 0;
  const be16 = (i: number) => (at(i) << 8) | at(i + 1);
  const le16 = (i: number) => at(i) | (at(i + 1) << 8);
  const be32 = (i: number) => ((at(i) << 24) >>> 0) + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3);
  // PNG: signature, then the IHDR chunk.
  if (be32(0) === 0x89504e47 && be32(4) === 0x0d0a1a0a && be32(12) === 0x49484452) {
    return { mimeType: 'image/png', width: be32(16), height: be32(20) };
  }
  // JPEG: walk markers to the first start-of-frame.
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return undefined;
      const marker = at(i + 1);
      const len = be16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: 'image/jpeg', width: be16(i + 7), height: be16(i + 5) };
      }
      if (len < 2) return undefined;
      i += 2 + len;
    }
    return undefined;
  }
  // WebP: RIFF....WEBP with a VP8 / VP8L / VP8X chunk.
  if (be32(0) === 0x52494646 && be32(8) === 0x57454250) {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15));
    if (chunk === 'VP8 ') return { mimeType: 'image/webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
      return { mimeType: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { mimeType: 'image/webp', width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)) };
    }
  }
  return undefined;
}

/** Checks a screenshot from its bytes: real image type, size, dimensions and shape. */
export function validateScreenshot(input: { mimeType: string; base64: string }): ScreenshotResult {
  if (base64ByteLength(input.base64) > SCREENSHOT_LIMITS.maxBytes) return { ok: false, reason: 'Each screenshot must be under 100 KB.' };
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(input.base64);
  } catch {
    return { ok: false, reason: 'That screenshot is damaged.' };
  }
  const info = imageSize(bytes);
  if (!info) return { ok: false, reason: 'Screenshots must be JPEG, PNG or WebP images.' };
  if (info.mimeType !== input.mimeType) return { ok: false, reason: 'The screenshot type does not match its contents.' };
  const { width, height } = info;
  const { minSide, maxSide, maxAspect } = SCREENSHOT_LIMITS;
  if (width < minSide || height < minSide || width > maxSide || height > maxSide) {
    return { ok: false, reason: `Screenshots must be between ${minSide} and ${maxSide} pixels on each side.` };
  }
  if (Math.max(width, height) / Math.min(width, height) > maxAspect) return { ok: false, reason: 'That screenshot is too long and thin.' };
  return { ok: true, screenshot: { mimeType: info.mimeType, base64: input.base64, width, height } };
}
