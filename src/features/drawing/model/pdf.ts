/**
 * A small PDF writer for multi-page export (docs/08 §14.1). No library: each page is one JPEG picture of the
 * drawn page, placed to fill a PDF page. Pictures keep every script and photo exactly as the canvas shows
 * them, which a PDF with its own text and fonts could not do for Hindi, Tamil and the other scripts without
 * embedding fonts. The trade is that PDF text cannot be selected. The title is stored as UTF-16 so any
 * script reads correctly in a PDF viewer's document properties.
 *
 * ponytail: raster pages. Vector PDF needs font embedding per script; add it only if selectable text matters.
 */
export interface PdfPage {
  /** A complete JPEG file (baseline or progressive, RGB or grey). */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  pxWidth: number;
  pxHeight: number;
  /** Page size in PDF points (1/72 inch). */
  widthPt: number;
  heightPt: number;
  /** 1 for greyscale JPEG, 3 for RGB. Default 3. */
  components?: 1 | 3;
}

/** A drawing page is `px` logical pixels; at 96 dpi that is 0.75 PDF points each. */
export const PX_TO_PT = 0.75;

const enc = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

const pt = (n: number): string => String(Math.round(n * 100) / 100);

/** `<FEFF...>` hex string of UTF-16BE, the way PDF stores text that is not plain ASCII. */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Builds the PDF file bytes. Throws when there are no pages. */
export function buildPdf(pages: readonly PdfPage[], title: string, now: Date = new Date()): Uint8Array {
  if (pages.length === 0) throw new Error('There are no pages to put in the PDF.');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}`);
    if (stream) {
      push('\nstream\n');
      push(stream);
      push('\nendstream');
    }
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfTextString(title)} /Producer (Kalam) /CreationDate (${pdfDate(now)}) >>`);
  pages.forEach((p, i) => {
    const page = 4 + i * 3; const content = page + 1; const image = page + 2;
    const w = pt(p.widthPt); const h = pt(p.heightPt);
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    const draw = enc(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    object(content, `<< /Length ${draw.length} >>`, draw);
    object(
      image,
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.pxWidth)} /Height ${Math.round(p.pxHeight)} /ColorSpace /${p.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,
      p.jpeg,
    );
  });

  const count = 4 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
