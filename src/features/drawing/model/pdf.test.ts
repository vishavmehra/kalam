import { describe, expect, it } from 'vitest';
import { buildPdf, pdfTextString, PX_TO_PT, type PdfPage } from './pdf';

const latin1 = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join('');
/** A few bytes that look like a JPEG start and end. The writer never decodes them. */
const fakeJpeg = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  b[0] = 0xff; b[1] = 0xd8; b[n - 2] = 0xff; b[n - 1] = 0xd9;
  for (let i = 2; i < n - 2; i++) b[i] = (i * 7) % 251;
  return b;
};
const page = (n: number, px = 800): PdfPage => ({ jpeg: fakeJpeg(n), pxWidth: px, pxHeight: px * 2, widthPt: 400 * PX_TO_PT, heightPt: 800 * PX_TO_PT });

describe('PDF writer', () => {
  it('writes a valid single-page file with a header, trailer and end marker', () => {
    const bytes = buildPdf([page(500)], 'My sketch', new Date(Date.UTC(2026, 10, 25, 9, 30, 0)));
    const text = latin1(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 1');
    expect(text).toContain('/MediaBox [0 0 300 600]');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('(D:20261125093000Z)');
    expect(text).toContain('/Width 800 /Height 1600');
  });

  it('puts every page in order and every byte offset in the table where its object starts', () => {
    const bytes = buildPdf([page(300), page(400), page(1000)], 'Three screens');
    const text = latin1(bytes);
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(3);
    expect(text).toContain('/Count 3');
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const table = text.slice(start).split('\n');
    const total = Number(/^0 (\d+)$/.exec(table[1]!)![1]);
    expect(total).toBe(4 + 3 * 3);
    expect(table[2]).toBe('0000000000 65535 f ');
    for (let n = 1; n < total; n++) {
      const offset = Number(table[2 + n]!.slice(0, 10));
      expect(text.slice(offset, offset + `${n} 0 obj`.length), `object ${n}`).toBe(`${n} 0 obj`);
    }
  });

  it('keeps each picture byte for byte, between stream markers of the right length', () => {
    const jpeg = fakeJpeg(777);
    const bytes = buildPdf([{ ...page(10), jpeg }], 'x');
    const text = latin1(bytes);
    const at = text.indexOf('/Length 777');
    expect(at).toBeGreaterThan(0);
    const from = text.indexOf('stream\n', at) + 'stream\n'.length;
    expect(Array.from(bytes.slice(from, from + 777))).toEqual(Array.from(jpeg));
    expect(text.slice(from + 777, from + 777 + 10)).toBe('\nendstream');
  });

  it('stores the title as UTF-16 so any script reads correctly', () => {
    expect(pdfTextString('Ab')).toBe('<FEFF00410062>');
    expect(pdfTextString('कुल')).toBe('<FEFF091509410932>');
    const text = latin1(buildPdf([page(100)], 'कुल'));
    expect(text).toContain('/Title <FEFF091509410932>');
  });

  it('draws the picture across the whole page', () => {
    const text = latin1(buildPdf([page(100)], 'x'));
    expect(text).toContain('q 300 0 0 600 0 0 cm /Im0 Do Q');
  });

  it('refuses an empty document', () => {
    expect(() => buildPdf([], 'x')).toThrow(/no pages/);
  });
});
