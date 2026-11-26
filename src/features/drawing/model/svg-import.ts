/**
 * SVG import (docs/08 §14.4, §14.5). Brings the simple shapes of an SVG file into editable drawing objects:
 * rectangles, circles, ellipses, lines, polylines, polygons, paths (as pen strokes) and text. The file is
 * untrusted, so it is never rendered or run. A small parser reads the tags and only a short list of known
 * attributes is looked at; everything else is ignored.
 *
 *  - Scripts, links, `<use>`, `<image>`, `<foreignObject>`, styles and animations are never read. Anything
 *    that looks like one is counted and left out.
 *  - A DOCTYPE with an internal subset (entity definitions) is refused. Only the five built in entities and
 *    numbered character references are decoded.
 *  - Size caps: 1 million characters, 5000 tags, 32 levels deep, 2000 characters per attribute (200,000 for
 *    path data and point lists), 2000 points per path, 50,000 points in all, and no more objects than the
 *    page can still hold.
 *  - Numbers are bounded. A shape with a coordinate that is not a finite number within 100,000 of the origin
 *    after its transforms is counted as skipped, so one hostile value cannot reach the drawing.
 *  - Every pattern below runs in time proportional to the length of its input. There is no nested or
 *    ambiguous repetition in a pattern that is matched against a whole attribute.
 */
import type { DrawingElement } from '@/core/contracts';
import { INK_COLORS, PAGE_HEIGHT, PAGE_OBJECT_CAP, PAGE_WIDTH } from './constants';
import { dropOrphanGroups, newId, STAMPS } from './document';
import { elementAABB, normalizeAngle, scaleElement, textSize, translateElement, unionBounds } from './geometry';
import { withProperties, type FontChoice } from './properties';

export const SVG_IMPORT_LIMITS = {
  maxChars: 1_000_000, maxNodes: 5000, maxDepth: 32, maxAttrs: 40, maxPathPoints: 2000, maxTotalPoints: 50_000, strokePoints: 400,
  /** Longest attribute value kept, except path data and point lists. */
  maxAttrChars: 2000,
  /** Longest `d`, `points` or `data-kalam-points` value kept. */
  maxLongAttrChars: 200_000,
  /** Largest coordinate, in either direction, that survives the import. */
  maxCoord: 100_000,
} as const;
const LONG_ATTRS = new Set(['d', 'points', 'data-kalam-points']);
const COORD = SVG_IMPORT_LIMITS.maxCoord;
/** A finite number that is no further than `maxCoord` from zero. */
const bounded = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD;

export type SvgImportResult =
  | { ok: true; elements: DrawingElement[]; notices: string[]; skipped: number }
  | { ok: false; reason: string };

// ── A tiny XML reader ──────────────────────────────────────────────────────────────────────────────

interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }
class Refuse extends Error {}

const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/gi;
function decode(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(ENTITY, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return cp > 0 && cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
  });
}

const isNameChar = (c: string): boolean => /[A-Za-z0-9_:.-]/.test(c);
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\r' || c === '\t';
const local = (name: string): string => name.slice(name.lastIndexOf(':') + 1);

function parseXml(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const n = src.length;
  let i = 0; let nodes = 0;
  const need = (ok: boolean): void => { if (!ok) throw new Refuse('malformed'); };
  while (i < n) {
    const cur = stack[stack.length - 1]!;
    if (src[i] !== '<') {
      const j = src.indexOf('<', i);
      const end = j < 0 ? n : j;
      if (cur.text.length < 20_000) cur.text += decode(src.slice(i, end));
      i = end;
    } else if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i + 4);
      need(j >= 0); i = j + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i + 9);
      need(j >= 0);
      if (cur.text.length < 20_000) cur.text += src.slice(i + 9, j);
      i = j + 3;
    } else if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i + 2);
      need(j >= 0); i = j + 2;
    } else if (src.startsWith('<!', i)) {
      const j = src.indexOf('>', i);
      need(j >= 0);
      if (src.slice(i, j).includes('[')) throw new Refuse('entities');
      i = j + 1;
    } else if (src.startsWith('</', i)) {
      const j = src.indexOf('>', i);
      need(j >= 0 && stack.length > 1);
      need(stack.pop()!.name === local(src.slice(i + 2, j).trim()).toLowerCase());
      i = j + 1;
    } else {
      i += 1;
      const start = i;
      while (i < n && isNameChar(src[i]!)) i++;
      const name = local(src.slice(start, i)).toLowerCase();
      need(name.length > 0);
      const attrs: Record<string, string> = {};
      let count = 0; let selfClosed = false;
      for (;;) {
        while (i < n && isSpace(src[i])) i++;
        need(i < n);
        if (src[i] === '/' && src[i + 1] === '>') { selfClosed = true; i += 2; break; }
        if (src[i] === '>') { i += 1; break; }
        const a = i;
        while (i < n && isNameChar(src[i]!)) i++;
        need(i > a);
        const attr = local(src.slice(a, i));
        while (i < n && isSpace(src[i])) i++;
        if (src[i] !== '=') { need(src[i] === '/' || src[i] === '>' || isNameChar(src[i] ?? ' ')); continue; }
        i += 1;
        while (i < n && isSpace(src[i])) i++;
        const q = src[i];
        need(q === '"' || q === "'");
        const end = src.indexOf(q!, i + 1);
        need(end >= 0);
        // A value over its cap is dropped before it is decoded, so a huge attribute costs one indexOf and nothing more.
        const cap = LONG_ATTRS.has(attr) ? SVG_IMPORT_LIMITS.maxLongAttrChars : SVG_IMPORT_LIMITS.maxAttrChars;
        if (count < SVG_IMPORT_LIMITS.maxAttrs && end - i - 1 <= cap) { attrs[attr] = decode(src.slice(i + 1, end)); count += 1; }
        i = end + 1;
      }
      need(++nodes <= SVG_IMPORT_LIMITS.maxNodes);
      const node: XNode = { name, attrs, children: [], text: '' };
      cur.children.push(node);
      if (!selfClosed) {
        stack.push(node);
        need(stack.length <= SVG_IMPORT_LIMITS.maxDepth + 1);
      }
    }
  }
  need(stack.length === 1);
  return root;
}

// ── Numbers, colours, transforms ───────────────────────────────────────────────────────────────────

const NUMBER = /[-+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:e[-+]?[0-9]+)?/gi;

/** A length in user units. Plain numbers and `px` only; percentages and font units are not understood. */
function length(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^\s*([-+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:e[-+]?[0-9]+)?)(px)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  return bounded(n) ? n : undefined;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', gray: '#808080', grey: '#808080', pink: '#ffc0cb', brown: '#a52a2a', cyan: '#00ffff', magenta: '#ff00ff',
  navy: '#000080', teal: '#008080', lime: '#00ff00', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
};

/** A hex colour, `null` for "none", or undefined when the value is not understood (gradients, `currentColor`). */
export function parseSvgColor(value: string): string | null | undefined {
  const t = value.trim().toLowerCase();
  if (t === 'none' || t === 'transparent') return null;
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{8}$/.test(t)) return t.slice(0, 7);
  // The inside of the brackets is split on separators, not matched with one long pattern, so spaces cannot make it slow.
  const fn = /^rgba?[(]([^)]*)[)]$/.exec(t);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    if ((parts.length !== 3 && parts.length !== 4) || !parts.every((x) => /^[0-9.]+%?$/.test(x))) return undefined;
    const part = (x: string) => Math.max(0, Math.min(255, Math.round(x.endsWith('%') ? (parseFloat(x) / 100) * 255 : parseFloat(x))));
    const vals = [parts[0]!, parts[1]!, parts[2]!].map(part);
    return vals.some((v) => Number.isNaN(v)) ? undefined : `#${vals.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return NAMED[t];
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const at = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/**
 * `translate`, `scale`, `rotate` and `matrix`. Skews and anything else make the transform unusable (undefined).
 * Read by walking from bracket to bracket with `indexOf`, so no pattern ever runs over a whole attribute.
 */
function parseTransform(value: string | undefined): Matrix | undefined {
  if (!value) return IDENTITY;
  let m: Matrix = IDENTITY;
  let found = 0; let last = 0;
  while (last < value.length) {
    const open = value.indexOf('(', last);
    if (open < 0) break;
    const close = value.indexOf(')', open + 1);
    if (close < 0) return undefined;
    // What sits before the bracket must be separators and one name.
    const head = /^[\s,]*([a-zA-Z]+)\s*$/.exec(value.slice(last, open));
    if (!head) return undefined;
    last = close + 1; found += 1;
    const nums = (value.slice(open + 1, close).match(NUMBER) ?? []).map(Number);
    const [a = 0, b, c, d, e, f] = nums;
    let t: Matrix;
    switch (head[1]) {
      case 'translate': t = [1, 0, 0, 1, a, b ?? 0]; break;
      case 'scale': t = [a, 0, 0, b ?? a, 0, 0]; break;
      case 'rotate': {
        const rad = (a * Math.PI) / 180; const cos = Math.cos(rad); const sin = Math.sin(rad);
        const cx = b ?? 0; const cy = c ?? 0;
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'matrix':
        if (nums.length !== 6) return undefined;
        t = [a, b!, c!, d!, e!, f!];
        break;
      default: return undefined;
    }
    if (t.some((v) => !Number.isFinite(v))) return undefined;
    m = mul(m, t);
    if (!m.every(Number.isFinite)) return undefined;
  }
  if (value.slice(last).replace(/[\s,]/g, '') || found === 0) return undefined;
  return m;
}

/** Boxes keep their shape under moves, scales and turns, but not under skews. */
function placeBox(m: Matrix, x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number; rotation?: number } | undefined {
  const sx = Math.hypot(m[0], m[1]); const sy = Math.hypot(m[2], m[3]);
  if (sx <= 0 || sy <= 0 || Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-3 * sx * sy) return undefined;
  const c = at(m, x + w / 2, y + h / 2);
  const nw = w * sx; const nh = h * sy;
  const rot = normalizeAngle((Math.atan2(m[1], m[0]) * 180) / Math.PI);
  return { x: c.x - nw / 2, y: c.y - nh / 2, w: nw, h: nh, ...(rot ? { rotation: rot } : {}) };
}

// ── Style ──────────────────────────────────────────────────────────────────────────────────────────

interface Style { fill?: string; stroke?: string; strokeWidth: number; fontSize: number; bold: boolean; font: FontChoice; anchor: 'start' | 'middle' | 'end' }
const ROOT_STYLE: Style = { fill: '#000000', strokeWidth: 1, fontSize: 16, bold: false, font: 'sans', anchor: 'start' };
const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'font-size', 'font-weight', 'font-family', 'text-anchor'] as const;

/** Which of Kalam's three typefaces a `font-family` list means, read from its generic family. Undefined when unclear. */
function fontOf(value: string): FontChoice | undefined {
  const names = value.toLowerCase().split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''));
  if (names.includes('monospace') || names.includes('ui-monospace')) return 'mono';
  if (names.includes('sans-serif')) return 'sans';
  if (names.includes('serif')) return 'serif';
  return undefined;
}

/** Presentation attributes plus a short `style="..."` list. Anything not on the list is ignored. */
function styleOf(node: XNode, parent: Style): Style {
  const raw: Record<string, string> = {};
  for (const k of STYLE_KEYS) if (node.attrs[k] !== undefined) raw[k] = node.attrs[k]!;
  const css = node.attrs.style;
  if (css && css.length <= 2000) {
    for (const decl of css.split(';')) {
      const k = decl.slice(0, decl.indexOf(':')).trim().toLowerCase();
      if ((STYLE_KEYS as readonly string[]).includes(k)) raw[k] = decl.slice(decl.indexOf(':') + 1).trim();
    }
  }
  const next: Style = { ...parent };
  if (raw.fill !== undefined) { const c = parseSvgColor(raw.fill); if (c === null) delete next.fill; else if (c) next.fill = c; }
  if (raw.stroke !== undefined) { const c = parseSvgColor(raw.stroke); if (c === null) delete next.stroke; else if (c) next.stroke = c; }
  const sw = length(raw['stroke-width']); if (sw !== undefined && sw >= 0) next.strokeWidth = sw;
  const fs = length(raw['font-size']); if (fs !== undefined && fs > 0) next.fontSize = fs;
  if (raw['font-weight'] !== undefined) next.bold = raw['font-weight'] === 'bold' || Number(raw['font-weight']) >= 600;
  if (raw['font-family'] !== undefined) next.font = fontOf(raw['font-family']) ?? next.font;
  const anchor = raw['text-anchor']; if (anchor === 'start' || anchor === 'middle' || anchor === 'end') next.anchor = anchor;
  return next;
}

// ── Walking the tree ───────────────────────────────────────────────────────────────────────────────

/** Tags that can run code, fetch things or carry content from elsewhere. Counted, never read. */
const BLOCKED = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'use', 'image', 'a', 'style', 'animate', 'animatemotion', 'animatetransform', 'set', 'audio', 'video', 'canvas']);
/** Containers that hold things for later use rather than things to draw. */
const SKIPPED_SILENTLY = new Set(['defs', 'clippath', 'mask', 'marker', 'pattern', 'symbol', 'filter', 'lineargradient', 'radialgradient', 'metadata', 'title', 'desc', 'switch']);
const GROUP_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Ctx {
  out: DrawingElement[];
  room: number;
  skipped: number;
  blocked: number;
  points: number;
  groups: Map<string, string>;
}

const INK = INK_COLORS[0]!.value;
const clampSize = (v: number): number => Math.min(60, Math.max(0.5, Math.round(v * 100) / 100));

const NUMERIC_FIELDS = ['x', 'y', 'w', 'h', 'size', 'fontSize', 'rotation', 'radius', 'headSize'] as const;
/** Every number the element carries is finite and within range. Hostile values (1e999, a huge scale) stop here. */
function inRange(el: DrawingElement): boolean {
  const fields = el as unknown as Record<string, unknown>;
  for (const k of NUMERIC_FIELDS) if (fields[k] !== undefined && !bounded(fields[k])) return false;
  return el.kind !== 'stroke' || el.points.every((p) => bounded(p.x) && bounded(p.y));
}

function push(ctx: Ctx, el: DrawingElement | undefined): void {
  if (!el || !inRange(el)) { ctx.skipped += 1; return; }
  if (ctx.out.length >= ctx.room) { ctx.skipped += 1; return; }
  ctx.out.push(el);
}

function sample(pts: Array<{ x: number; y: number }>, max: number): Array<{ x: number; y: number }> {
  if (pts.length <= max) return pts;
  return Array.from({ length: max }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (max - 1))]!);
}

function strokeElement(ctx: Ctx, pts: Array<{ x: number; y: number }>, st: Style, m: Matrix, group?: string): DrawingElement | undefined {
  if (pts.length < 2 || ctx.points + pts.length > SVG_IMPORT_LIMITS.maxTotalPoints) return undefined;
  ctx.points += pts.length;
  const moved = sample(pts.map((p) => at(m, p.x, p.y)), SVG_IMPORT_LIMITS.strokePoints);
  return { id: newId('el'), kind: 'stroke', tool: 'pen', color: st.stroke ?? st.fill ?? INK, size: st.stroke ? clampSize(st.strokeWidth * scaleOf(m)) : 1.5, points: moved, ...(group ? { groupId: group } : {}) };
}

/** Flattens `d` into one point list per sub-path. Curves become short straight pieces; arcs become one straight piece. */
export function flattenPath(d: string): Array<Array<{ x: number; y: number }>> {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:e[-+]?[0-9]+)?/gi) ?? [];
  const subs: Array<Array<{ x: number; y: number }>> = [];
  let cur: Array<{ x: number; y: number }> = [];
  let x = 0; let y = 0; let sx = 0; let sy = 0; let cmd = ''; let k = 0;
  let lastCtl: { x: number; y: number; kind: 'c' | 'q' } | undefined;
  let total = 0;
  // A number that is not finite or is absurdly large ends the path there, as a broken number does in a browser.
  const num = (): number | undefined => {
    if (k >= tokens.length || /[a-zA-Z]/.test(tokens[k]!)) return undefined;
    const v = Number(tokens[k++]);
    return Number.isFinite(v) && Math.abs(v) <= COORD * 10 ? v : undefined;
  };
  const add = (px: number, py: number) => { if (total++ < SVG_IMPORT_LIMITS.maxPathPoints * 8) cur.push({ x: px, y: py }); x = px; y = py; };
  const flush = () => { if (cur.length > 1) subs.push(cur); cur = []; };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const x0 = x; const y0 = y;
    for (let i = 1; i <= 8; i++) {
      const t = i / 8; const u = 1 - t;
      add(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
    }
    lastCtl = { x: x2, y: y2, kind: 'c' };
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    const x0 = x; const y0 = y;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6; const u = 1 - t;
      add(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
    }
    lastCtl = { x: x1, y: y1, kind: 'q' };
  };
  while (k < tokens.length && total < SVG_IMPORT_LIMITS.maxPathPoints * 8) {
    if (/[a-zA-Z]/.test(tokens[k]!)) cmd = tokens[k++]!;
    else if (!cmd || cmd === 'z' || cmd === 'Z') break;
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const ox = rel ? x : 0; const oy = rel ? y : 0;
    if (up === 'Z') { if (cur.length) add(sx, sy); flush(); lastCtl = undefined; continue; }
    if (up === 'M') {
      const a = num(); const b = num();
      if (a === undefined || b === undefined) break;
      flush(); add(ox + a, oy + b); sx = x; sy = y; cmd = rel ? 'l' : 'L'; lastCtl = undefined; continue;
    }
    if (cur.length === 0) cur.push({ x, y });
    if (up === 'L') { const a = num(); const b = num(); if (a === undefined || b === undefined) break; add(ox + a, oy + b); lastCtl = undefined; }
    else if (up === 'H') { const a = num(); if (a === undefined) break; add(ox + a, y); lastCtl = undefined; }
    else if (up === 'V') { const b = num(); if (b === undefined) break; add(x, oy + b); lastCtl = undefined; }
    else if (up === 'C') {
      const v = [num(), num(), num(), num(), num(), num()];
      if (v.some((n) => n === undefined)) break;
      cubic(ox + v[0]!, oy + v[1]!, ox + v[2]!, oy + v[3]!, ox + v[4]!, oy + v[5]!);
    } else if (up === 'S') {
      const v = [num(), num(), num(), num()];
      if (v.some((n) => n === undefined)) break;
      const c1 = lastCtl?.kind === 'c' ? { x: 2 * x - lastCtl.x, y: 2 * y - lastCtl.y } : { x, y };
      cubic(c1.x, c1.y, ox + v[0]!, oy + v[1]!, ox + v[2]!, oy + v[3]!);
    } else if (up === 'Q') {
      const v = [num(), num(), num(), num()];
      if (v.some((n) => n === undefined)) break;
      quad(ox + v[0]!, oy + v[1]!, ox + v[2]!, oy + v[3]!);
    } else if (up === 'T') {
      const v = [num(), num()];
      if (v.some((n) => n === undefined)) break;
      const c1 = lastCtl?.kind === 'q' ? { x: 2 * x - lastCtl.x, y: 2 * y - lastCtl.y } : { x, y };
      quad(c1.x, c1.y, ox + v[0]!, oy + v[1]!);
    } else if (up === 'A') {
      const v = [num(), num(), num(), num(), num(), num(), num()];
      if (v.some((n) => n === undefined)) break;
      add(ox + v[5]!, oy + v[6]!); lastCtl = undefined;
    } else break;
  }
  flush();
  return subs;
}

/** A pen stroke that Kalam wrote itself: the exact points travel in `data-kalam-points`, so nothing is lost. */
function nativeStroke(node: XNode, m: Matrix, ctx: Ctx, group?: string): DrawingElement | undefined {
  const nums = (node.attrs['data-kalam-points'] ?? '').match(NUMBER)?.map(Number) ?? [];
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length && pts.length < 20_000; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
  if (pts.length < 2 || ctx.points + pts.length > SVG_IMPORT_LIMITS.maxTotalPoints) return undefined;
  ctx.points += pts.length;
  const tool = node.attrs['data-kalam-tool'];
  const size = length(node.attrs['data-kalam-size']);
  const color = parseSvgColor(node.attrs['data-kalam-color'] ?? '') ?? INK;
  return {
    id: newId('el'), kind: 'stroke', tool: tool === 'marker' || tool === 'highlighter' ? tool : 'pen', color: color ?? INK,
    size: clampSize((size ?? 4) * scaleOf(m)), points: pts.map((p) => at(m, p.x, p.y)), ...(group ? { groupId: group } : {}),
  };
}

/** An arrow that Kalam wrote itself. Other programs see a line and two head strokes; Kalam gets one arrow back. */
function nativeArrow(node: XNode, m: Matrix, group?: string): DrawingElement | undefined {
  const box = (node.attrs['data-kalam-box'] ?? '').match(NUMBER)?.map(Number);
  if (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n) || Math.abs(n) > 100_000)) return undefined;
  const p = at(m, box[0]!, box[1]!); const q = at(m, box[0]! + box[2]!, box[1]! + box[3]!);
  const size = length(node.attrs['data-kalam-size']);
  const head = length(node.attrs['data-kalam-head']);
  const el: DrawingElement = {
    id: newId('el'), kind: 'arrow', x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y, color: parseSvgColor(node.attrs['data-kalam-color'] ?? '') ?? INK,
    size: clampSize((size ?? 4) * scaleOf(m)), ...(group ? { groupId: group } : {}),
  };
  return withProperties(el, head !== undefined ? { headSize: head * scaleOf(m) } : {});
}

/** A component stamp that Kalam wrote itself, so a round trip keeps what the person meant by it. */
function nativeStamp(node: XNode, m: Matrix, group?: string): DrawingElement | undefined {
  const component = node.attrs['data-kalam-component'];
  if (!STAMPS.some((s) => s.component === component)) return undefined;
  const box = (node.attrs['data-kalam-box'] ?? '').match(NUMBER)?.map(Number);
  if (!box || box.length !== 4 || box[2]! <= 0 || box[3]! <= 0) return undefined;
  const placed = placeBox(m, box[0]!, box[1]!, box[2]!, box[3]!);
  if (!placed) return undefined;
  const label = node.attrs['data-kalam-label']?.slice(0, 60);
  const turn = normalizeAngle((placed.rotation ?? 0) + (length(node.attrs['data-kalam-rotation']) ?? 0));
  return {
    id: newId('el'), kind: 'stamp', component: component as Extract<DrawingElement, { kind: 'stamp' }>['component'],
    x: placed.x, y: placed.y, w: placed.w, h: placed.h, ...(turn ? { rotation: turn } : {}),
    ...(label ? { label } : {}), ...(group ? { groupId: group } : {}),
  };
}

function textContent(node: XNode): string {
  return (node.text + node.children.filter((c) => c.name === 'tspan').map(textContent).join('')).replace(/\s+/g, ' ');
}

function walk(node: XNode, parent: Style, parentM: Matrix, ctx: Ctx, depth: number, inheritedGroup?: string): void {
  for (const child of node.children) {
    if (ctx.out.length >= ctx.room) { ctx.skipped += 1; continue; }
    const tag = child.name;
    if (BLOCKED.has(tag)) { ctx.blocked += 1; continue; }
    if (SKIPPED_SILENTLY.has(tag) || depth > SVG_IMPORT_LIMITS.maxDepth) continue;
    if (child.attrs.display === 'none' || child.attrs.visibility === 'hidden') continue;
    const t = parseTransform(child.attrs.transform);
    if (!t) { ctx.skipped += 1; continue; }
    const m = mul(parentM, t);
    if (!m.every(Number.isFinite)) { ctx.skipped += 1; continue; }
    const st = styleOf(child, parent);
    const rawGroup = child.attrs['data-kalam-group'];
    const group = rawGroup && GROUP_ID.test(rawGroup)
      ? (ctx.groups.get(rawGroup) ?? (ctx.groups.set(rawGroup, newId('grp')), ctx.groups.get(rawGroup)!))
      : inheritedGroup;
    const common = group ? { groupId: group } : {};
    const native = tag === 'g' ? child.attrs['data-kalam-kind'] : undefined;
    if (native === 'paper') continue; // the page colour and grid are the screen's own, not objects
    if (native === 'stroke') { push(ctx, nativeStroke(child, m, ctx, group)); continue; }
    if (native === 'stamp') { push(ctx, nativeStamp(child, m, group)); continue; }
    if (native === 'arrow') { push(ctx, nativeArrow(child, m, group)); continue; }
    const sw = st.stroke ? clampSize(st.strokeWidth * scaleOf(m)) : 1;
    const paint = st.stroke ?? st.fill;
    const a = (k: string, fallback = 0): number | undefined => (child.attrs[k] === undefined ? fallback : length(child.attrs[k]));
    switch (tag) {
      case 'svg': case 'g':
        walk(child, st, m, ctx, depth + 1, group);
        break;
      case 'rect': {
        const x = a('x'); const y = a('y'); const w = length(child.attrs.width); const h = length(child.attrs.height);
        const rx = a('rx', -1); const ry = a('ry', -1);
        if (x === undefined || y === undefined || !w || !h || w < 0 || h < 0 || !paint) { ctx.skipped += 1; break; }
        const box = placeBox(m, x, y, w, h);
        if (!box) { ctx.skipped += 1; break; }
        const r = (rx !== undefined && rx >= 0 ? rx : ry !== undefined && ry >= 0 ? ry : 0) * scaleOf(m);
        const el: DrawingElement = { id: newId('el'), kind: 'rect', ...box, color: paint, size: sw, ...common };
        push(ctx, withProperties(el, { ...(st.fill ? { fill: st.fill } : {}), radius: r }));
        break;
      }
      case 'circle': case 'ellipse': {
        const cx = a('cx'); const cy = a('cy');
        const rx = tag === 'circle' ? length(child.attrs.r) : length(child.attrs.rx);
        const ry = tag === 'circle' ? rx : length(child.attrs.ry);
        if (cx === undefined || cy === undefined || !rx || !ry || rx < 0 || ry < 0 || !paint) { ctx.skipped += 1; break; }
        const box = placeBox(m, cx - rx, cy - ry, rx * 2, ry * 2);
        if (!box) { ctx.skipped += 1; break; }
        const el: DrawingElement = { id: newId('el'), kind: 'ellipse', ...box, color: paint, size: sw, ...common };
        push(ctx, withProperties(el, st.fill ? { fill: st.fill } : {}));
        break;
      }
      case 'line': {
        const x1 = a('x1'); const y1 = a('y1'); const x2 = a('x2'); const y2 = a('y2');
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) { ctx.skipped += 1; break; }
        const p = at(m, x1, y1); const q = at(m, x2, y2);
        push(ctx, { id: newId('el'), kind: 'line', x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y, color: st.stroke ?? INK, size: sw, ...common });
        break;
      }
      case 'polyline': case 'polygon': {
        const nums = (child.attrs.points ?? '').match(NUMBER)?.map(Number) ?? [];
        const pts: Array<{ x: number; y: number }> = [];
        for (let i = 0; i + 1 < nums.length && pts.length < SVG_IMPORT_LIMITS.maxPathPoints; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
        if (tag === 'polygon' && pts.length > 2) pts.push(pts[0]!);
        push(ctx, strokeElement(ctx, pts, st, m, group));
        break;
      }
      case 'path': {
        const d = child.attrs.d;
        if (!d) { ctx.skipped += 1; break; }
        const subs = flattenPath(d).slice(0, 40);
        if (subs.length === 0) { ctx.skipped += 1; break; }
        // Several pieces of one path belong together, so they come in as a group.
        const g = group ?? (subs.length > 1 ? newId('grp') : undefined);
        for (const s of subs) push(ctx, strokeElement(ctx, s.slice(0, SVG_IMPORT_LIMITS.maxPathPoints), st, m, g));
        break;
      }
      case 'text': {
        const text = textContent(child).trim().slice(0, 400);
        const x = a('x'); const y = a('y');
        if (!text || x === undefined || y === undefined || !st.fill) { ctx.skipped += 1; break; }
        const size = textSize(text, st.fontSize, st.font, st.bold);
        const left = st.anchor === 'middle' ? x - size.w / 2 : st.anchor === 'end' ? x - size.w : x;
        const box = placeBox(m, left, y - st.fontSize * 0.82, size.w, size.h);
        if (!box) { ctx.skipped += 1; break; }
        const el: DrawingElement = {
          id: newId('el'), kind: 'text', x: box.x, y: box.y, text, color: st.fill,
          fontSize: Math.min(160, Math.max(8, st.fontSize * scaleOf(m))), ...(box.rotation ? { rotation: box.rotation } : {}), ...common,
        };
        push(ctx, withProperties(el, { ...(st.bold ? { bold: true } : {}), ...(st.font !== 'sans' ? { font: st.font } : {}) }));
        break;
      }
      default:
        break;
    }
  }
}

/** Moves and shrinks the imported shapes so they fit the page, keeping their proportions. */
function fitToPage(els: DrawingElement[], viewW: number, viewH: number): { els: DrawingElement[]; shrunk: boolean } {
  if (els.length === 0) return { els, shrunk: false };
  const box = unionBounds(els.map(elementAABB));
  const needW = Math.max(viewW, box.x + box.w); const needH = Math.max(viewH, box.y + box.h);
  const s = Math.min(1, PAGE_WIDTH / Math.max(needW, 1), PAGE_HEIGHT / Math.max(needH, 1));
  let out = els;
  if (s < 1) {
    out = els.map((el) => {
      const scaled = scaleElement(el, s, s, 0, 0);
      return 'size' in scaled ? { ...scaled, size: clampSize(scaled.size * s) } : scaled;
    });
  }
  const after = unionBounds(out.map(elementAABB));
  const dx = after.x < 0 ? -after.x : 0; const dy = after.y < 0 ? -after.y : 0;
  if (dx || dy) out = out.map((el) => translateElement(el, dx, dy));
  return { els: out, shrunk: s < 1 };
}

/**
 * Reads SVG text into drawing objects. `room` is how many more objects the page can hold. Never throws:
 * a file that cannot be used comes back as `{ ok: false, reason }` in plain words.
 */
export function importSvg(source: string, room: number = PAGE_OBJECT_CAP): SvgImportResult {
  if (typeof source !== 'string' || source.trim() === '') return { ok: false, reason: 'The file is empty.' };
  if (source.length > SVG_IMPORT_LIMITS.maxChars) return { ok: false, reason: 'This file is too large to open. The limit is about 1 MB.' };
  if (room <= 0) return { ok: false, reason: 'This screen is full. Delete some objects first.' };
  let tree: XNode;
  try {
    tree = parseXml(source);
  } catch (e) {
    return e instanceof Refuse && e.message === 'entities'
      ? { ok: false, reason: 'This file defines its own entities, which Kalam does not open.' }
      : { ok: false, reason: 'This does not look like a valid SVG file.' };
  }
  const svg = tree.children.find((c) => c.name === 'svg');
  if (!svg) return { ok: false, reason: 'This does not look like an SVG file.' };

  const vb = (svg.attrs.viewBox ?? '').match(NUMBER)?.map(Number);
  const hasBox = !!vb && vb.length === 4 && vb.every(bounded) && vb[2]! > 0 && vb[3]! > 0;
  const origin: Matrix = hasBox ? [1, 0, 0, 1, -vb![0]!, -vb![1]!] : IDENTITY;
  const ctx: Ctx = { out: [], room, skipped: 0, blocked: 0, points: 0, groups: new Map() };
  try {
    walk({ ...svg, children: [svg] }, ROOT_STYLE, origin, ctx, 0);
  } catch {
    return { ok: false, reason: 'This file could not be read.' };
  }
  if (ctx.out.length === 0) {
    return { ok: false, reason: ctx.blocked ? 'There was nothing Kalam could safely bring in. Scripts, links and outside pictures are left out.' : 'There were no simple shapes to bring in.' };
  }
  const fitted = fitToPage(ctx.out, hasBox ? vb![2]! : 0, hasBox ? vb![3]! : 0);
  const elements = [...dropOrphanGroups(fitted.els)];
  const notices: string[] = [];
  if (ctx.blocked) notices.push('Scripts, links, outside pictures and embedded content were left out.');
  if (ctx.skipped) notices.push(ctx.skipped === 1 ? 'One shape could not be brought in.' : `${ctx.skipped} shapes could not be brought in.`);
  if (fitted.shrunk) notices.push('The drawing was made smaller to fit the screen.');
  notices.push('Curves come in as pen strokes and fills may look different.');
  return { ok: true, elements, notices, skipped: ctx.skipped };
}
