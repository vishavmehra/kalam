import { describe, expect, it } from 'vitest';

import type { DrawingDocument } from '@/core/contracts';

import { createDocument } from './document';
import {
  asNewDrawing, buildDrawingFile, DRAWING_FILE_FORMAT, DRAWING_FILE_MAX_CHARS, drawingFileName, parseDrawingFile, placedImageIds,
  type DrawingFileAsset,
} from './native-format';

const PNG = 'iVBORw0KGgo=';
function sample(): DrawingDocument {
  const doc = createDocument(1000, 'drw_a');
  const page = doc.pages[0]!;
  page.elements.push(
    { id: 'e1', kind: 'rect', x: 10, y: 10, w: 100, h: 60, color: '#2234C2', size: 4 },
    { id: 'e2', kind: 'text', x: 20, y: 90, text: 'सुनीता 98210', color: '#12172E', fontSize: 24 },
    { id: 'e3', kind: 'image', x: 30, y: 200, w: 120, h: 90, blobId: 'blob_1', alt: 'order book' },
  );
  return { ...doc, title: 'Tailor book' };
}
const asset = (id: string, extra: Partial<DrawingFileAsset> = {}): DrawingFileAsset => ({ id, mimeType: 'image/png', base64: PNG, ...extra });

describe('Kalam drawing file (D08-042)', () => {
  it('round-trips a drawing with its photo and its Hindi text', () => {
    const text = buildDrawingFile(sample(), [asset('blob_1'), asset('blob_unused')], 5);
    const parsed = parseDrawingFile(text);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.doc.title).toBe('Tailor book');
    expect(parsed.doc.pages[0]!.elements.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    const t = parsed.doc.pages[0]!.elements[1]!;
    expect(t.kind === 'text' && t.text).toBe('सुनीता 98210');
    expect(parsed.assets.map((a) => a.id)).toEqual(['blob_1']);
    expect(parsed.notices).toEqual([]);
  });

  it('carries only the photos the drawing places', () => {
    const parsed = JSON.parse(buildDrawingFile(sample(), [asset('blob_1'), asset('other')]));
    expect(parsed.format).toBe(DRAWING_FILE_FORMAT);
    expect(parsed.assets).toHaveLength(1);
    expect(placedImageIds(sample())).toEqual(['blob_1']);
  });

  it('refuses things that are not a Kalam drawing', () => {
    expect(parseDrawingFile('not json')).toEqual({ status: 'failed', problem: 'not_json' });
    expect(parseDrawingFile('{"format":"other","version":1}')).toEqual({ status: 'failed', problem: 'wrong_format' });
    expect(parseDrawingFile('[]')).toEqual({ status: 'failed', problem: 'wrong_format' });
    expect(parseDrawingFile(JSON.stringify({ format: DRAWING_FILE_FORMAT, version: 1, drawing: { id: 'x', pages: [] } }))).toEqual({ status: 'failed', problem: 'empty' });
    expect(parseDrawingFile('x'.repeat(DRAWING_FILE_MAX_CHARS + 1))).toEqual({ status: 'failed', problem: 'too_large' });
  });

  it('rebuilds the drawing field by field and says what it dropped', () => {
    const file = JSON.parse(buildDrawingFile(sample(), [asset('blob_1')]));
    file.drawing.pages[0].elements.push({ id: 'bad', kind: 'rect', x: 'a', y: 1, w: 1, h: 1 }, { id: 'evil', kind: 'script', code: 'alert(1)' });
    const parsed = parseDrawingFile(JSON.stringify(file));
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.doc.pages[0]!.elements.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(parsed.notices.some((n) => n.code === 'dropped')).toBe(true);
  });

  it('keeps only small PNG, JPEG or WebP photos in plain base64', () => {
    const file = JSON.parse(buildDrawingFile(sample(), [asset('blob_1')]));
    file.assets.push(
      { id: 'svg', mimeType: 'image/svg+xml', base64: PNG },
      { id: 'html', mimeType: 'text/html', base64: PNG },
      { id: 'bad64', mimeType: 'image/png', base64: '<script>' },
      { id: 'big', mimeType: 'image/png', base64: 'A'.repeat(6_000_001) },
      { id: 'blob_1', mimeType: 'image/png', base64: PNG },
      'junk', null,
    );
    const parsed = parseDrawingFile(JSON.stringify(file));
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.assets.map((a) => a.id)).toEqual(['blob_1']);
  });

  it('tells the person when a placed photo is not in the file', () => {
    const parsed = parseDrawingFile(buildDrawingFile(sample(), []));
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.notices).toEqual([{ code: 'photosMissing', count: 1 }]);
  });

  it('notes a file made by a newer Kalam', () => {
    const file = JSON.parse(buildDrawingFile(sample(), [asset('blob_1')]));
    file.version = 99;
    const parsed = parseDrawingFile(JSON.stringify(file));
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.notices).toContainEqual({ code: 'newer' });
  });

  it('opens as a new drawing with fresh ids, so nothing already on the device is overwritten', () => {
    const parsed = parseDrawingFile(buildDrawingFile(sample(), [asset('blob_1')]));
    if (parsed.status !== 'ok') throw new Error('expected ok');
    let n = 0;
    const made = asNewDrawing(parsed, (prefix) => `${prefix}_new${(n += 1)}`, 7);
    expect(made.doc.id).not.toBe('drw_a');
    expect(made.doc.createdAt).toBe(7);
    const img = made.doc.pages[0]!.elements.find((e) => e.kind === 'image');
    expect(img && img.kind === 'image' && img.blobId).toBe(made.assets[0]!.id);
    expect(made.assets[0]!.id).not.toBe('blob_1');
    expect(made.assets[0]!.base64).toBe(PNG);
  });

  it('names the file after the drawing, in any script', () => {
    expect(drawingFileName('Tailor book')).toBe('Tailor-book.kalamdraw');
    expect(drawingFileName('दर्ज़ी बुक')).toBe('दर्ज़ी-बुक.kalamdraw');
    expect(drawingFileName('  ///  ')).toBe('drawing.kalamdraw');
  });
});
