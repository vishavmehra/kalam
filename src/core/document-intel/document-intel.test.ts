import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import type { AIBlockService, AIErrorCode, AIExecutionResult, RecordValue } from '../contracts';
import type { KalamField, KalamSpec } from '../spec/schema';
import { createAIBlockService } from '../tasks/ai-block-service';
import {
  applyPatch, areaMarks, buildReviewFields, chosenRecords, confirmField, editField, extractPdfPages, fieldText, isReady, jpegInfo, markDuplicates,
  newBatch, parseNotes, readPages, recordValues, splitPhotoOutput, summarize, takeSuggestion, type BatchItem, type DocumentPage,
} from './index';

// A tiny order-slip app: one photo step that fills the "orders" list.
const fields: Record<string, KalamField> = {
  customer: { type: 'text', label: 'Customer', required: true },
  chest: { type: 'number', label: 'Chest', min: 20, max: 80 },
  delivery: { type: 'date', label: 'Delivery' },
};
const spec = {
  schemaVersion: '1.1', id: 'app_slips0001', name: 'Slips', lang: 'en', version: 1,
  collections: { orders: { label: 'Orders', fields } },
  aiBlocks: { slip: { kind: 'extractFromPhoto', prompt: 'Read the slip.', verified: 'unverified', target: 'orders' } },
  screens: [], home: 'home',
} as unknown as KalamSpec;
const NOW = new Date('2026-11-25T10:00:00');
const IMAGE = { mimeType: 'image/jpeg' as const, base64: '/9j/AAAA' };
const ids = ['customer', 'chest', 'delivery'];

describe('photo step reading notes', () => {
  const reply = {
    customer: 'Raju', chest: 40, delivery: 'Friday', sleeve: 5,
    _reading: [
      { field: 'customer', confidence: 'high', area: 'top_left' },
      { field: 'chest', confidence: 'low', area: 'center' },
      { field: 'chest', confidence: 'high' }, // repeat: ignored
      { field: 'ghost', confidence: 'high' }, // not a field: ignored
      { field: 'customer', confidence: 'certain', area: 'nowhere' }, // junk values: ignored
    ],
  };
  const run = async (raw: unknown) => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw }) });
    const res = await createAIBlockService({ ai }).run({ appId: spec.id, blockId: 'slip', block: spec.aiBlocks.slip, spec, formValues: {}, image: IMAGE });
    return { ai, res };
  };

  it('returns confidence and place per field, flags low confidence as uncertain, and keeps unfit text apart', async () => {
    const { ai, res } = await run(reply);
    expect(res.output).toEqual({ customer: 'Raju', chest: 40 });
    expect(res.fieldReadings).toEqual({ customer: { confidence: 'high', area: 'top_left' }, chest: { confidence: 'low', area: 'center' } });
    expect(res.uncertainFields).toEqual(['chest']);
    // "Friday" has no clock at read time, so it is kept as text to clarify, not guessed.
    expect(res.unreadFields).toEqual({ delivery: 'Friday' });
    expect(ai.calls[0].req.system).toContain('_reading');
  });

  it('leaves everything out when the model gives no notes', async () => {
    const { res } = await run({ customer: 'Raju' });
    expect(res.output).toEqual({ customer: 'Raju' });
    expect(res.fieldReadings).toBeUndefined();
    expect(res.unreadFields).toBeUndefined();
    expect(res.uncertainFields).toBeUndefined();
  });

  it('survives hostile notes', () => {
    expect(parseNotes('nope', ids)).toEqual({});
    expect(parseNotes([null, 4, { field: 7 }, { field: 'customer', area: 'top' }], ids)).toEqual({ customer: { area: 'top' } });
    expect(splitPhotoOutput({ a: 1, _reading: '{not json' }).reading).toEqual({ notes: {}, unread: {} });
    expect(splitPhotoOutput({ a: 1, _reading: JSON.stringify({ notes: { a: { confidence: 'sure' } }, unread: {} }) }).reading.notes).toEqual({});
  });
});

describe('review of one record', () => {
  const read = (extra: Partial<AIExecutionResult<Record<string, RecordValue>>> = {}) => buildReviewFields(
    ids, fields,
    {
      output: { customer: 'Raju', chest: 40 },
      fieldReadings: { customer: { confidence: 'high', area: 'top_left' }, chest: { confidence: 'low', area: 'center' } },
      uncertainFields: ['chest'], unreadFields: { delivery: 'Friday' }, ...extra,
    },
    NOW,
  );

  it('keeps value, confidence, place and validation per field', () => {
    const f = read();
    expect(f.map((x) => [x.id, x.value, x.confidence, x.area, x.issue, x.unsure])).toEqual([
      ['customer', 'Raju', 'high', 'top_left', undefined, false],
      ['chest', 40, 'low', 'center', undefined, true],
      ['delivery', undefined, undefined, undefined, 'ambiguous_date', false],
    ]);
    // 25 Nov 2026 is a Wednesday, so the next Friday is the 27th. Offered, not applied.
    expect(f[2]).toMatchObject({ read: 'Friday', suggestion: '2026-11-27' });
  });

  it('is not ready until the unsure value is checked and the ambiguous date is settled', () => {
    let f = read();
    expect(isReady(f)).toBe(false);
    f = confirmField(f, 'chest');
    expect(isReady(f)).toBe(false); // the date is still open
    f = confirmField(f, 'delivery'); // a field with a problem cannot just be confirmed
    expect(f[2].issue).toBe('ambiguous_date');
    f = takeSuggestion(f, 'delivery', fields, NOW);
    expect(f[2]).toMatchObject({ value: '2026-11-27', checked: true });
    expect(f[2].issue).toBeUndefined();
    expect(isReady(f)).toBe(true);
    expect(recordValues(f)).toEqual({ customer: 'Raju', chest: 40, delivery: '2026-11-27' });
  });

  it('flags invalid and missing values, and a correction clears them', () => {
    let f = buildReviewFields(ids, fields, { output: { chest: 40 }, unreadFields: { chest: '400' } }, NOW);
    expect(f.find((x) => x.id === 'customer')?.issue).toBe('missing'); // required and empty
    f = editField(f, 'customer', ' Raju ', fields, NOW);
    expect(f[0]).toMatchObject({ value: 'Raju', checked: true });
    f = editField(f, 'chest', '400', fields, NOW);
    expect(f[1]).toMatchObject({ issue: 'invalid', read: '400' }); // out of range: never saved
    expect(isReady(f)).toBe(false);
    f = editField(f, 'chest', '', fields, NOW); // leave it empty
    expect(f[1].issue).toBeUndefined();
    expect(isReady(f)).toBe(true);
    expect(fieldText(editField(f, 'chest', '4.', fields, NOW)[1])).toBe('4.'); // typing is not rewritten
  });

  it('maps fields to page areas and marks the ones that need a look', () => {
    expect(areaMarks(read())).toEqual({
      top_left: { fields: ['customer'], attention: false },
      center: { fields: ['chest'], attention: true },
    });
  });
});

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
/** A marker-valid JPEG header: SOI, SOF0 with the size and component count, EOI. Not decodable, but enough for the reader. */
const jpeg = (w: number, h: number, components = 3) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 255, w >> 8, w & 255, components, 0, 0, 0, 0xff, 0xd9]);
const imageObject = (n: number, data: Uint8Array, filter = '/DCTDecode') =>
  cat(text(`${n} 0 obj\n<< /Type /XObject /Subtype /Image /Filter ${filter} /Length ${data.length} >>\nstream\r\n`), data, text('\r\nendstream\nendobj\n'));

describe('scanned PDF pages', () => {
  const pdf = (...objs: Uint8Array[]) => cat(text('%PDF-1.4\n'), ...objs, text('trailer\n<< /Root 1 0 R >>\n%%EOF'));

  it('reads the JPEG page pictures in file order and skips small, CMYK and non-JPEG pictures', () => {
    const r = extractPdfPages(pdf(
      imageObject(4, jpeg(1200, 1600)),
      imageObject(5, jpeg(120, 60)), // a logo
      imageObject(6, jpeg(1000, 1400, 4)), // CMYK
      imageObject(7, jpeg(1000, 1400), '[/FlateDecode /DCTDecode]'), // compressed twice
      imageObject(8, jpeg(900, 1300)),
    ));
    expect(r.ok && r.pages.map((p) => [p.width, p.height])).toEqual([[1200, 1600], [900, 1300]]);
    expect(r.ok && r.skipped).toBe(3);
    expect(r.ok && Array.from(r.pages[0].jpeg.subarray(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('reads a PDF written by a real PDF writer (Pillow), byte for byte', () => {
    const file = new Uint8Array(readFileSync(new URL('../../../tests/fixtures/document-intel/scan-2pages.pdf', import.meta.url)));
    const declared = [...Array.from(file, (c) => String.fromCharCode(c)).join('').matchAll(/\/Subtype \/Image[^>]*?\/Length (\d+)/g)].map((m) => Number(m[1]));
    const r = extractPdfPages(file);
    expect(declared).toHaveLength(2);
    expect(r.ok && r.pages.map((p) => [p.width, p.height, p.jpeg.length])).toEqual([[480, 640, declared[0]], [520, 700, declared[1]]]);
    expect(r.ok && r.skipped).toBe(0);
    expect(r.ok && r.pages.every((p) => p.jpeg[0] === 0xff && p.jpeg[1] === 0xd8 && p.jpeg.at(-2) === 0xff && p.jpeg.at(-1) === 0xd9)).toBe(true);
  });

  it('keeps only the page limit', () => {
    const r = extractPdfPages(pdf(imageObject(4, jpeg(800, 800)), imageObject(5, jpeg(800, 800)), imageObject(6, jpeg(800, 800))), 2);
    expect(r.ok && r.pages.length).toBe(2);
    expect(r.ok && r.skipped).toBe(1);
  });

  it('says why a file cannot be used', () => {
    expect(extractPdfPages(text('hello'))).toEqual({ ok: false, reason: 'not_pdf' });
    expect(extractPdfPages(pdf(text('1 0 obj\n<< /Type /Page >>\nendobj\n')))).toEqual({ ok: false, reason: 'no_pages' });
    expect(extractPdfPages(cat(pdf(imageObject(4, jpeg(800, 800))), text('/Encrypt 9 0 R')))).toEqual({ ok: false, reason: 'encrypted' });
  });

  it('reads JPEG sizes and refuses other bytes', () => {
    expect(jpegInfo(jpeg(640, 480))).toEqual({ width: 640, height: 480, components: 3 });
    expect(jpegInfo(text('GIF89a'))).toBeUndefined();
  });
});

const pages = (n: number): DocumentPage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, image: { ...IMAGE, base64: `/9j/P${i}` }, name: 'slips.pdf', page: i + 1, pages: n }));
const serviceFor = (answers: Array<Record<string, unknown> | { error: 'offline' | 'timeout' }>): Pick<AIBlockService, 'run'> => {
  let n = 0;
  return {
    async run() {
      const a = answers[n++];
      if ('error' in a) return { success: false, provider: 'none', source: 'cloud', latencyMs: 1, fallbackUsed: false, errorCode: a.error as AIErrorCode };
      return {
        success: true, provider: 'firebase', source: 'on_device', latencyMs: 1, fallbackUsed: false, output: a as Record<string, RecordValue>,
        fieldReadings: { customer: { confidence: 'high', area: 'top' } },
      };
    },
  };
};
const ctx = (service: Pick<AIBlockService, 'run'>, extra: { signal?: AbortSignal; existing?: Array<Record<string, RecordValue>> } = {}) =>
  ({ service, spec, blockId: 'slip', appId: spec.id, now: NOW, ...extra });

/** Runs a read the way the screen does: every patch goes onto the latest list. */
async function read(items: BatchItem[], c: ReturnType<typeof ctx>, seen: BatchItem[][] = []): Promise<BatchItem[]> {
  let list = items;
  await readPages(list, c, (i, patch) => { list = applyPatch(list, i, patch, c.existing); seen.push(list); });
  return list;
}

describe('batch reading', () => {
  it('turns pages into records with progress, and approval is the only way in', async () => {
    const seen: BatchItem[][] = [];
    const items = await read(
      newBatch(pages(3)),
      ctx(serviceFor([{ customer: 'Raju', chest: 40 }, { customer: 'Meena', chest: 36 }, { customer: 'Raju', chest: 40 }])),
      seen,
    );
    expect(seen.some((l) => l.some((i) => i.status === 'reading'))).toBe(true);
    expect(items.map((i) => i.status)).toEqual(['read', 'read', 'read']);
    expect(items[2].duplicate).toBe('batch'); // the same slip twice
    expect(summarize(items)).toMatchObject({ total: 3, read: 3, savable: 2, duplicates: 1 });
    // The duplicate is left out unless the person includes it.
    expect(chosenRecords(items).map((r) => r.values.customer)).toEqual(['Raju', 'Meena']);
    expect(chosenRecords(items.map((i, k) => (k === 2 ? { ...i, accepted: true } : i)))).toHaveLength(3);
    expect(chosenRecords(items)[1].source).toEqual({ name: 'slips.pdf', page: 2 });
  });

  it('does not save a record that still needs the person', async () => {
    const items = await read(newBatch(pages(1)), ctx(serviceFor([{ chest: 40 }])));
    expect(items[0].fields.find((f) => f.id === 'customer')?.issue).toBe('missing');
    expect(summarize(items)).toMatchObject({ read: 1, toFix: 1, savable: 0 });
    expect(chosenRecords(items)).toEqual([]);
  });

  it('marks records that already exist in the list', () => {
    const f = buildReviewFields(ids, fields, { output: { customer: 'Raju', chest: 40 } }, NOW);
    const item: BatchItem = { page: pages(1)[0], status: 'read', fields: f };
    expect(markDuplicates([item], [{ customer: 'raju', chest: 40, delivery: '2026-01-01' }])[0].duplicate).toBe('existing');
    expect(markDuplicates([item], [{ customer: 'Raju', chest: 41 }])[0].duplicate).toBeUndefined();
  });

  it('keeps pages that failed, stops when the cause will repeat, and retries what is left', async () => {
    const first = await read(newBatch(pages(3)), ctx(serviceFor([{ customer: 'Raju' }, { error: 'timeout' }, { error: 'offline' }])));
    expect(first.map((i) => [i.status, i.error])).toEqual([['read', undefined], ['failed', 'timeout'], ['failed', 'offline']]);
    const again = await read(first, ctx(serviceFor([{ customer: 'Meena' }, { customer: 'Asha' }])));
    expect(again.map((i) => i.status)).toEqual(['read', 'read', 'read']);
    expect(again[0].fields[0].value).toBe('Raju'); // an already read page is not read again
  });

  it('stops at an offline page and leaves the rest waiting', async () => {
    const items = await read(newBatch(pages(3)), ctx(serviceFor([{ error: 'offline' }])));
    expect(items.map((i) => i.status)).toEqual(['failed', 'waiting', 'waiting']);
  });

  it('cancelling keeps what was read and sends the page in flight back to waiting', async () => {
    const ac = new AbortController();
    const service: Pick<AIBlockService, 'run'> = {
      async run() {
        ac.abort();
        return { success: true, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false, output: { customer: 'Raju' } };
      },
    };
    const items = await read(newBatch(pages(2)), ctx(service, { signal: ac.signal }));
    expect(items.map((i) => i.status)).toEqual(['waiting', 'waiting']);
  });

  it('puts the cancel signal and the page on the model call', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { customer: 'Raju' } }) });
    const ac = new AbortController();
    await read(newBatch(pages(1)), ctx(createAIBlockService({ ai }), { signal: ac.signal }));
    expect(ai.calls[0].req.signal).toBe(ac.signal);
    expect(ai.calls[0].req.images?.[0].base64).toBe('/9j/P0');
  });
});
