import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { bytesToBase64 } from '../backup/base64';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import {
  applyReviewChange, canMove, diffSpecs, gunzipFromBase64, gzipToBase64, imageSize, isCompatible, makerActions,
  preparePublication, priceLabel, ratingAverage, sanitizeSvg, sha256Hex, validatePrice, validateReviewInput,
  validateScreenshot, type PublishForm,
} from './index';

const spec = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} invalid`);
  return r.spec;
};
const form: PublishForm = {
  title: 'Daily expenses', description: 'Write down what you spend each day and see the monthly total.',
  category: 'finance', tags: ['money'], license: 'remix_allowed',
};

describe('codec: hash + gzip (docs/12 §16.2)', () => {
  it('hashes UTF-8 text with SHA-256', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('round-trips text, including Indic scripts', () => {
    const text = JSON.stringify({ name: 'हिसाब किताब', n: [1, 2, 3] });
    expect(gunzipFromBase64(gzipToBase64(text), 100_000)).toBe(text);
  });
  it('refuses zip bombs and garbage', () => {
    expect(() => gunzipFromBase64(gzipToBase64('x'.repeat(200_000)), 100_000)).toThrow(/too large/);
    expect(() => gunzipFromBase64('bm90IGd6aXA=', 100_000)).toThrow();
  });
});

describe('SVG sanitiser (docs/12 §9.3, §24.8)', () => {
  const ok = '<svg viewBox="0 0 24 24" width="24" height="24"><title>Coin</title><circle cx="12" cy="12" r="10" fill="#315C4C"/><path d="M8 12h8" stroke="#fff" stroke-width="2" class="x"/></svg>';
  it('keeps a plain icon and rebuilds it from parsed tokens', () => {
    const r = sanitizeSvg(ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain('viewBox="0 0 24 24"');
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.svg).not.toContain('class='); // unknown attributes are dropped
    expect(r.svg).toContain('<title>Coin</title>');
  });
  it.each([
    ['script element', '<svg><script>alert(1)</script></svg>'],
    ['event handler', '<svg onload="alert(1)"><circle r="1"/></svg>'],
    ['link', '<svg><a href="https://x.example"><circle r="1"/></a></svg>'],
    ['xlink use', '<svg><use xlink:href="#a"/></svg>'],
    ['style attribute', '<svg><circle r="1" style="fill:red"/></svg>'],
    ['foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['external paint', '<svg><circle r="1" fill="url(https://evil.example/x)"/></svg>'],
    ['javascript url', '<svg><circle r="1" fill="javascript:alert(1)"/></svg>'],
    ['data url', '<svg><circle r="1" fill="data:image/png;base64,AA"/></svg>'],
    ['doctype entity', '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>'],
    ['stray text', '<svg>hello<circle r="1"/></svg>'],
    ['content after root', '<svg></svg><svg></svg>'],
    ['unclosed', '<svg><g></svg>'],
    ['not svg', '<html></html>'],
  ])('rejects %s', (_label, input) => {
    expect(sanitizeSvg(input).ok).toBe(false);
  });
  it('allows local gradient references only', () => {
    const r = sanitizeSvg('<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="4" height="4" fill="url(#g)"/></svg>');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.svg).toContain('<linearGradient id="g">');
  });
});

describe('screenshot checks (docs/11 §11.6)', () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(40);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return bytesToBase64(b);
  };
  const jpeg = (w: number, h: number) => {
    const b = new Uint8Array(64);
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    b.set([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255], 20);
    return bytesToBase64(b);
  };
  const webpX = (w: number, h: number) => {
    const b = new Uint8Array(40);
    b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24);
    return bytesToBase64(b);
  };
  it('reads real dimensions from PNG, JPEG and WebP headers', () => {
    expect(validateScreenshot({ mimeType: 'image/png', base64: png(360, 720) })).toMatchObject({ ok: true, screenshot: { width: 360, height: 720 } });
    expect(validateScreenshot({ mimeType: 'image/jpeg', base64: jpeg(540, 960) })).toMatchObject({ ok: true, screenshot: { width: 540, height: 960 } });
    expect(imageSize(Uint8Array.from(atob(webpX(300, 600)), (c) => c.charCodeAt(0)))).toEqual({ mimeType: 'image/webp', width: 300, height: 600 });
  });
  it('rejects mismatched types, odd sizes and non-images', () => {
    expect(validateScreenshot({ mimeType: 'image/jpeg', base64: png(360, 720) }).ok).toBe(false);
    expect(validateScreenshot({ mimeType: 'image/png', base64: png(4000, 720) }).ok).toBe(false);
    expect(validateScreenshot({ mimeType: 'image/png', base64: png(40, 40) }).ok).toBe(false);
    expect(validateScreenshot({ mimeType: 'image/png', base64: png(100, 900) }).ok).toBe(false); // too thin
    expect(validateScreenshot({ mimeType: 'image/png', base64: bytesToBase64(new TextEncoder().encode('<svg onload=alert(1)>')) }).ok).toBe(false);
    expect(validateScreenshot({ mimeType: 'image/png', base64: 'A'.repeat(140_000) }).ok).toBe(false);
  });
});

describe('reviews (docs/12 §14)', () => {
  it('moves the aggregate by exactly the review change', () => {
    const a = applyReviewChange({ ratingSum: 0, ratingCount: 0 }, null, 4);
    expect(a).toEqual({ ratingSum: 4, ratingCount: 1, ratingAvg: 4 });
    const b = applyReviewChange(a, null, 5);
    expect(b).toEqual({ ratingSum: 9, ratingCount: 2, ratingAvg: 4.5 });
    expect(applyReviewChange(b, 5, 2)).toEqual({ ratingSum: 6, ratingCount: 2, ratingAvg: 3 });
    expect(applyReviewChange(b, 4, null)).toEqual({ ratingSum: 5, ratingCount: 1, ratingAvg: 5 });
    expect(() => applyReviewChange({ ratingSum: 0, ratingCount: 0 }, 3, null)).toThrow();
    expect(ratingAverage(14, 3)).toBe(4.7);
  });
  it('accepts 1 to 5 stars and plain text only', () => {
    expect(validateReviewInput(5, 'Very useful for my shop.')).toBeUndefined();
    expect(validateReviewInput(0, '')).toMatch(/1 to 5/);
    expect(validateReviewInput(3, '<img src=x onerror=alert(1)>')).toMatch(/< or >/);
  });
});

describe('listing state machine (docs/12 §18.3)', () => {
  it('lets makers move between their own states but never out of suspension', () => {
    expect(canMove('draft', 'pending_validation', 'maker')).toBe(true);
    expect(canMove('published', 'unpublished', 'maker')).toBe(true);
    expect(canMove('published', 'suspended', 'maker')).toBe(false);
    expect(canMove('suspended', 'published', 'maker')).toBe(false);
    expect(canMove('published', 'suspended', 'moderator')).toBe(true);
    expect(makerActions('suspended')).toEqual([]);
    expect(makerActions('unpublished')).toContain('show_again');
  });
});

describe('price and compatibility', () => {
  it('validates credit prices', () => {
    expect(validatePrice(0)).toBeUndefined();
    expect(validatePrice(25)).toBeUndefined();
    expect(validatePrice(-1)).toBeDefined();
    expect(validatePrice(1.5)).toBeDefined();
    expect(validatePrice(1001)).toBeDefined();
    expect(priceLabel(0)).toBe('Free');
    expect(priceLabel(1)).toBe('1 credit');
  });
  it('accepts only specs this build can read', () => {
    expect(isCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isCompatible('1.2.0', '1.0.0')).toBe(false);
    expect(isCompatible('2.0.0', '1.0.0')).toBe(false);
  });
  it('publishes the chosen price, language and a sanitised icon; refuses an unsafe icon', () => {
    const s = spec('expense-tracker');
    const r = preparePublication({
      spec: s, form: { ...form, price: 30, iconSvg: '<svg viewBox="0 0 2 2"><rect width="2" height="2"/></svg>' },
      listingId: 'labcdefghij012345678', makerUid: 'u', makerName: 'A',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.price).toBe(30);
      expect(r.draft.lang).toBe(s.lang);
      expect(r.draft.iconSvg).toContain('<rect');
      expect(r.specGz.length).toBeLessThan(r.specJson.length);
    }
    const bad = preparePublication({ spec: s, form: { ...form, iconSvg: '<svg onload="x()"></svg>' }, listingId: 'labcdefghij012345678', makerUid: 'u', makerName: 'A' });
    expect(bad.ok).toBe(false);
    const lang = preparePublication({ spec: s, form: { ...form, lang: 'zz' }, listingId: 'labcdefghij012345678', makerUid: 'u', makerName: 'A' });
    expect(lang.ok).toBe(false);
  });
});

describe('update differences (docs/12 §10.3)', () => {
  it('is empty for the same design and readable for changes', () => {
    const a = spec('expense-tracker');
    expect(diffSpecs(a, a)).toEqual([]);
    const [first] = a.screens;
    const b: KalamSpec = { ...a, name: 'Spend book', screens: [...a.screens, { ...first!, id: 'extra_screen', title: 'Extra' }] };
    const d = diffSpecs(a, b);
    expect(d).toContain('Renamed from "' + a.name + '" to "Spend book".');
    expect(d).toContain('New screen: Extra.');
    const [cid] = Object.keys(a.collections);
    const fields = { ...a.collections[cid!]!.fields };
    const [fid] = Object.keys(fields);
    delete fields[fid!];
    const c: KalamSpec = { ...a, collections: { ...a.collections, [cid!]: { ...a.collections[cid!]!, fields } } };
    expect(diffSpecs(a, c).some((line) => line.startsWith('Removed field from'))).toBe(true);
  });
});
