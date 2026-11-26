/**
 * Kalam's own drawing file, ".kalamdraw" (docs/08 §14.1, §14.5): one JSON document with every screen, object and placed
 * photo, so a drawing can be kept, moved to another phone or sent to someone and opened again with nothing lost. SVG and
 * PDF are for other programs; this one is for Kalam.
 *
 * A file is untrusted: it is size-limited, its drawing is rebuilt field by field by `migrateDrawing`, and each photo must
 * be a small PNG, JPEG or WebP in plain base64. Opening it always makes a NEW drawing and never overwrites one.
 * Pure TypeScript.
 */
import type { DrawingDocument } from '@/core/contracts';
import { DRAWING_SCHEMA_VERSION } from './constants';
import { pageImageIds } from './document';
import { migrateDrawing } from './migrate';

export const DRAWING_FILE_FORMAT = 'kalam-drawing';
export const DRAWING_FILE_VERSION = 1;
export const DRAWING_FILE_EXTENSION = '.kalamdraw';
export const DRAWING_FILE_MIME = 'application/json';
/** Longest file that is read, in characters. A drawing with a few photos is well under this. */
export const DRAWING_FILE_MAX_CHARS = 24_000_000;
const MAX_ASSETS = 60;
const MAX_ASSET_CHARS = 6_000_000;
const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface DrawingFileAsset { id: string; mimeType: (typeof ASSET_TYPES)[number]; base64: string }

/** Why a file was refused, as a code the screen turns into words. */
export type DrawingFileProblem = 'too_large' | 'not_json' | 'wrong_format' | 'empty';
/** Things worth telling the person after a successful open. */
export type DrawingFileNotice = { code: 'dropped'; count: number } | { code: 'newer' } | { code: 'photosMissing'; count: number };

export type ParsedDrawingFile =
  | { status: 'ok'; doc: DrawingDocument; assets: DrawingFileAsset[]; notices: DrawingFileNotice[] }
  | { status: 'failed'; problem: DrawingFileProblem };

/** Photo ids placed anywhere in a document, once each. */
export function placedImageIds(doc: Pick<DrawingDocument, 'pages'>): string[] {
  return [...new Set(doc.pages.flatMap(pageImageIds))];
}

/** Text of the file for `doc` and the photos it places (only those; unused photos are not carried along). */
export function buildDrawingFile(doc: DrawingDocument, assets: readonly DrawingFileAsset[], now = Date.now()): string {
  const used = new Set(placedImageIds(doc));
  return JSON.stringify({
    format: DRAWING_FILE_FORMAT,
    version: DRAWING_FILE_VERSION,
    exportedAt: now,
    drawing: doc,
    assets: assets.filter((a) => used.has(a.id)),
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanAssets(raw: unknown): DrawingFileAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: DrawingFileAsset[] = [];
  const seen = new Set<string>();
  for (const a of raw.slice(0, MAX_ASSETS)) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.base64 !== 'string' || typeof a.mimeType !== 'string') continue;
    if (!a.id || a.id.length > 128 || seen.has(a.id)) continue;
    const mimeType = ASSET_TYPES.find((m) => m === a.mimeType);
    if (!mimeType || a.base64.length > MAX_ASSET_CHARS || !BASE64.test(a.base64)) continue;
    seen.add(a.id);
    out.push({ id: a.id, mimeType, base64: a.base64 });
  }
  return out;
}

export function parseDrawingFile(text: string, now = Date.now()): ParsedDrawingFile {
  if (text.length > DRAWING_FILE_MAX_CHARS) return { status: 'failed', problem: 'too_large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'failed', problem: 'not_json' };
  }
  if (!isObj(raw) || raw.format !== DRAWING_FILE_FORMAT || typeof raw.version !== 'number') return { status: 'failed', problem: 'wrong_format' };
  const migrated = migrateDrawing(raw.drawing, now);
  if (!migrated) return { status: 'failed', problem: 'empty' };
  const assets = cleanAssets(raw.assets);
  const have = new Set(assets.map((a) => a.id));
  const missing = placedImageIds(migrated.doc).filter((id) => !have.has(id)).length;
  const notices: DrawingFileNotice[] = [];
  if (migrated.dropped > 0) notices.push({ code: 'dropped', count: migrated.dropped });
  if (raw.version > DRAWING_FILE_VERSION || migrated.fromVersion > DRAWING_SCHEMA_VERSION) notices.push({ code: 'newer' });
  if (missing > 0) notices.push({ code: 'photosMissing', count: missing });
  return { status: 'ok', doc: migrated.doc, assets, notices };
}

/**
 * The drawing as a new one of this device's own: a fresh drawing id, and a fresh id for every photo so nothing in the
 * photo store is overwritten or shared with another drawing. `newId` makes the ids.
 */
export function asNewDrawing(
  parsed: Extract<ParsedDrawingFile, { status: 'ok' }>, newId: (prefix: string) => string, now = Date.now(),
): { doc: DrawingDocument; assets: DrawingFileAsset[] } {
  const ids = new Map(parsed.assets.map((a) => [a.id, newId('blob')] as const));
  const doc: DrawingDocument = {
    ...parsed.doc,
    id: newId('drw'),
    createdAt: now,
    updatedAt: now,
    pages: parsed.doc.pages.map((p) => ({
      ...p,
      elements: p.elements.map((el) => (el.kind === 'image' ? { ...el, blobId: ids.get(el.blobId) ?? el.blobId } : el)),
    })),
  };
  return { doc, assets: parsed.assets.map((a) => ({ ...a, id: ids.get(a.id)! })) };
}

/** File name for a saved drawing: letters and numbers of any script, dashes for spaces. */
export function drawingFileName(title: string): string {
  const base = title.trim().replace(/[^\p{L}\p{M}\p{N}\-_ ]+/gu, '').replace(/\s+/g, '-').slice(0, 48);
  return `${base || 'drawing'}${DRAWING_FILE_EXTENSION}`;
}
