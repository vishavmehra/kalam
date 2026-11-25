/**
 * Validate and migrate a stored or imported drawing (docs/08 §13.5, §14.5). Stored drawings are
 * untrusted data: this builds a clean `DrawingDocument` field by field, drops anything it cannot
 * make sense of, clamps numbers, and upgrades old versions. It never throws.
 */
import type { DrawingDocument, DrawingElement, DrawingElementCommon, DrawingPage, DrawingPoint } from '@/core/contracts';
import {
  DEFAULT_PAGE_COLOR, DRAWING_SCHEMA_VERSION, HINTS, INK_COLORS, MAX_PAGES, PAGE_HEIGHT, PAGE_OBJECT_CAP, PAGE_WIDTH,
  type DrawingHint, type PageBackground,
} from './constants';
import { newId } from './document';
import { normalizeAngle } from './geometry';
import { parseProps } from './properties';

export interface MigrationResult {
  doc: DrawingDocument;
  /** Plain-language notes for the person, e.g. objects that could not be restored. */
  notices: string[];
  /** Objects that were damaged and left out. */
  dropped: number;
  fromVersion: number;
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MAX_COORD = 100_000;
const MAX_POINTS = 20_000;
const FALLBACK_INK = INK_COLORS[0]!.value;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const coord = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD ? v : undefined);
const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const colour = (v: unknown): string => (typeof v === 'string' && HEX.test(v) ? v : FALLBACK_INK);

function parseCommon(raw: Raw, kind: string): DrawingElementCommon {
  const c: DrawingElementCommon = {};
  const z = coord(raw.zIndex);
  if (z !== undefined) c.zIndex = z;
  if (raw.locked === true) c.locked = true;
  if (raw.hidden === true) c.hidden = true;
  if (typeof raw.hint === 'string' && (HINTS as readonly string[]).includes(raw.hint)) c.hint = raw.hint as DrawingHint;
  const g = str(raw.groupId, 64);
  if (g) c.groupId = g;
  const rot = coord(raw.rotation);
  if (rot !== undefined && kind !== 'stroke' && kind !== 'line' && kind !== 'arrow') {
    const n = normalizeAngle(rot);
    if (n !== 0) c.rotation = n;
  }
  return c;
}

function parsePoints(v: unknown): DrawingPoint[] {
  if (!Array.isArray(v)) return [];
  const out: DrawingPoint[] = [];
  for (const item of v.slice(0, MAX_POINTS)) {
    if (!isObj(item)) continue;
    const x = coord(item.x); const y = coord(item.y);
    if (x === undefined || y === undefined) continue;
    const pt: DrawingPoint = { x, y };
    if (typeof item.pressure === 'number' && item.pressure > 0 && item.pressure <= 1) pt.pressure = item.pressure;
    out.push(pt);
  }
  return out;
}

function parseElement(raw: unknown): DrawingElement | undefined {
  if (!isObj(raw) || typeof raw.kind !== 'string') return undefined;
  const kind: string = raw.kind;
  const id = str(raw.id, 128) || newId('el');
  const common = parseCommon(raw, kind);
  const x = coord(raw.x); const y = coord(raw.y);
  const w = coord(raw.w); const h = coord(raw.h);
  switch (kind) {
    case 'stroke': {
      const points = parsePoints(raw.points);
      if (points.length === 0) return undefined;
      const tool = raw.tool === 'marker' || raw.tool === 'highlighter' ? raw.tool : 'pen';
      return { ...common, id, kind: 'stroke', tool, points, color: colour(raw.color), size: clampNum(raw.size, 0.5, 200, 4) };
    }
    case 'rect': case 'ellipse': case 'line': case 'arrow':
      if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
      return { ...common, ...parseProps(raw, kind), id, kind, x, y, w, h, color: colour(raw.color), size: clampNum(raw.size, 0.5, 200, 4) };
    case 'text': {
      const text = str(raw.text, 2000);
      if (x === undefined || y === undefined || text === undefined) return undefined;
      return { ...common, ...parseProps(raw, 'text'), id, kind: 'text', x, y, text, color: colour(raw.color), fontSize: clampNum(raw.fontSize, 4, 400, 24) };
    }
    case 'stamp': {
      const component = str(raw.component, 40);
      if (!component || x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
      const label = str(raw.label, 80);
      return {
        ...common, id, kind: 'stamp', x, y, w: Math.abs(w), h: Math.abs(h),
        component: component as Extract<DrawingElement, { kind: 'stamp' }>['component'],
        ...(label !== undefined ? { label } : {}),
      };
    }
    case 'image': {
      const blobId = str(raw.blobId, 128);
      if (!blobId || x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
      const alt = str(raw.alt, 200);
      return { ...common, id, kind: 'image', x, y, w: Math.abs(w), h: Math.abs(h), blobId, ...(alt ? { alt } : {}) };
    }
    default:
      return undefined;
  }
}

function parsePage(raw: unknown, index: number, seen: Set<string>): { page: DrawingPage; dropped: number } | undefined {
  if (!isObj(raw)) return undefined;
  let id = str(raw.id, 128) || newId('pg');
  if (seen.has(id)) id = newId('pg');
  seen.add(id);
  const ids = new Set<string>();
  let dropped = 0;
  const elements: DrawingElement[] = [];
  const list = Array.isArray(raw.elements) ? raw.elements : [];
  list.forEach((item) => {
    const el = parseElement(item);
    if (!el) { dropped += 1; return; }
    const unique = ids.has(el.id) ? { ...el, id: newId('el') } : el;
    ids.add(unique.id);
    elements.push(unique);
  });
  // Version 1 had no stacking numbers. Array order is the stacking order, so number it.
  const ordered = elements.map((el, i) => (el.zIndex === i ? el : { ...el, zIndex: i }));
  const page: DrawingPage = {
    id,
    title: str(raw.title, 60)?.trim() || `Screen ${index + 1}`,
    width: clampNum(raw.width, 100, 4000, PAGE_WIDTH),
    height: clampNum(raw.height, 100, 8000, PAGE_HEIGHT),
    elements: ordered,
  };
  const bg = raw.background;
  if (bg === 'plain' || bg === 'grid' || bg === 'dots') page.background = bg as PageBackground;
  if (typeof raw.backgroundColor === 'string' && HEX.test(raw.backgroundColor) && raw.backgroundColor !== DEFAULT_PAGE_COLOR) {
    page.backgroundColor = raw.backgroundColor;
  }
  return { page, dropped };
}

/** Returns undefined when `raw` is not a usable drawing at all. */
export function migrateDrawing(raw: unknown, now = Date.now()): MigrationResult | undefined {
  if (!isObj(raw) || !Array.isArray(raw.pages) || raw.pages.length === 0) return undefined;
  const id = str(raw.id, 128);
  if (!id) return undefined;

  const fromVersion = typeof raw.schemaVersion === 'number' && Number.isFinite(raw.schemaVersion) ? Math.floor(raw.schemaVersion) : 1;
  const notices: string[] = [];
  const seen = new Set<string>();
  const pages: DrawingPage[] = [];
  let dropped = 0;
  raw.pages.forEach((p, i) => {
    const parsed = parsePage(p, i, seen);
    if (parsed) { pages.push(parsed.page); dropped += parsed.dropped; } else dropped += 1;
  });
  if (pages.length === 0) return undefined;

  if (dropped > 0) notices.push(dropped === 1 ? 'One damaged object could not be restored.' : `${dropped} damaged objects could not be restored.`);
  if (fromVersion > DRAWING_SCHEMA_VERSION) notices.push('This drawing was made with a newer version of Kalam. Some parts may be missing.');
  if (pages.length > MAX_PAGES) notices.push(`This drawing has more than ${MAX_PAGES} screens. You can open them, but not add more.`);
  if (pages.some((p) => p.elements.length > PAGE_OBJECT_CAP)) notices.push('A screen has more objects than usual. Delete some before adding more.');

  const created = coord(raw.createdAt) ?? now;
  const activePageId = typeof raw.activePageId === 'string' && pages.some((p) => p.id === raw.activePageId) ? raw.activePageId : pages[0]!.id;
  const doc: DrawingDocument = {
    id,
    title: str(raw.title, 60)?.trim() || 'Untitled sketch',
    createdAt: created,
    updatedAt: coord(raw.updatedAt) ?? created,
    pages,
    schemaVersion: DRAWING_SCHEMA_VERSION,
    activePageId,
  };
  return { doc, notices, dropped, fromVersion };
}
