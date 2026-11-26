import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../backup/base64';
import {
  DEFAULT_IMPORT_BASE, IMPORT_LINK_PREFIX, MAX_FRAGMENT_CHARS, decodeAppFile, decodeImportLink, encodeImportLink,
} from './index';
import expenseTracker from '../../../tests/fixtures/specs/valid/expense-tracker.json';

// A JSON import (no node:fs), copied so no test can change the shared module object.
const spec = JSON.parse(JSON.stringify(expenseTracker)) as Record<string, unknown>;

const b64url = (bytes: Uint8Array) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const linkFor = (bytes: Uint8Array) => `${DEFAULT_IMPORT_BASE}#${IMPORT_LINK_PREFIX}${b64url(bytes)}`;

describe('import link', () => {
  it('round-trips a valid spec through the fragment', () => {
    const enc = encodeImportLink(spec);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(enc.url.startsWith(`${DEFAULT_IMPORT_BASE}#${IMPORT_LINK_PREFIX}`)).toBe(true);
    expect(enc.linkChars).toBeLessThan(enc.specBytes); // gzip pays for base64
    const dec = decodeImportLink(enc.url);
    expect(dec.ok).toBe(true);
    // Same design; provenance says "import" whatever the link claimed.
    // The fixture claims its AI block was verified on a device: a link cannot carry that claim.
    if (dec.ok) {
      expect({ ...dec.spec, meta: undefined, aiBlocks: undefined }).toEqual({ ...spec, meta: undefined, aiBlocks: undefined });
      expect(dec.spec.meta.generator).toEqual({ route: 'deterministic', provider: 'import' });
      expect(dec.spec.aiBlocks.categorise).toMatchObject({ kind: 'classify', verified: 'unverified' });
      expect(dec.spec.aiBlocks.categorise).not.toHaveProperty('verification');
    }
    // A bare fragment and a web base work too.
    expect(decodeImportLink(enc.fragment).ok).toBe(true);
    const web = encodeImportLink(spec, 'https://example.test/import?x=1#old');
    expect(web.ok && web.url.startsWith('https://example.test/import?x=1#k1.')).toBe(true);
  });

  it('makes the same link for the same app', () => {
    const a = encodeImportLink(spec);
    const b = encodeImportLink(JSON.stringify(spec));
    expect(a.ok && b.ok && a.url === b.url).toBe(true);
  });

  it('refuses to encode an invalid spec', () => {
    const bad = encodeImportLink({ ...spec, initialScreen: 'nowhere' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.code === 'UNKNOWN_SCREEN')).toBe(true);
  });

  it('rejects a link whose app was changed to carry blocked content', () => {
    const tampered = { ...spec, name: '<script>alert(1)</script>' };
    const dec = decodeImportLink(linkFor(gzipSync(strToU8(JSON.stringify(tampered)))));
    expect(dec.ok).toBe(false);
    if (!dec.ok) expect(dec.errors.some((e) => e.code === 'SECURITY_CONTENT')).toBe(true);
  });

  it('rejects unknown properties (strict schema)', () => {
    const dec = decodeImportLink(linkFor(gzipSync(strToU8(JSON.stringify({ ...spec, run: 'code' })))));
    expect(dec.ok).toBe(false);
    if (!dec.ok) expect(dec.errors.some((e) => e.code === 'UNKNOWN_PROPERTY')).toBe(true);
  });

  it('rejects damaged links without throwing', () => {
    const enc = encodeImportLink(spec);
    if (!enc.ok) throw new Error('fixture must encode');
    const data = enc.fragment.slice(IMPORT_LINK_PREFIX.length);
    const mid = Math.floor(data.length / 2);
    const flipped = data.slice(0, mid) + (data[mid] === 'A' ? 'B' : 'A') + data.slice(mid + 1);
    for (const input of [
      '', '#', 'kalam://import', '#k2.abc', `#${IMPORT_LINK_PREFIX}not*base64`, `#${IMPORT_LINK_PREFIX}${flipped}`,
      `#${IMPORT_LINK_PREFIX}${data.slice(0, -10)}`, `#${IMPORT_LINK_PREFIX}A`, 42 as unknown as string,
    ]) {
      const dec = decodeImportLink(input);
      expect(dec.ok).toBe(false);
      if (!dec.ok) expect(dec.message.length).toBeGreaterThan(0);
    }
  });

  it('caps size before and after inflating', () => {
    expect(decodeImportLink(`#${IMPORT_LINK_PREFIX}${'A'.repeat(MAX_FRAGMENT_CHARS)}`).ok).toBe(false);
    // 300 KB of spaces compresses to a few hundred bytes: the stated size stops it.
    const bomb = gzipSync(new Uint8Array(300_000).fill(32));
    const big = decodeImportLink(linkFor(bomb));
    expect(big.ok === false && /too large/.test(big.message)).toBe(true);
    // The same bomb with a trailer that lies about its size is cut off by the fixed buffer.
    const liar = bomb.slice();
    liar.set([0x10, 0, 0, 0], liar.length - 4);
    const lied = decodeImportLink(linkFor(liar));
    expect(lied.ok === false && /too large/.test(lied.message)).toBe(true);
  });
});

describe('app file', () => {
  it('reads a one-app kalam-backup or a bare spec, with claims reset', () => {
    for (const file of [{ format: 'kalam-backup', formatVersion: 1, apps: [{ spec }], records: [] }, spec]) {
      const r = decodeAppFile(file);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.spec.name).toBe(spec.name);
        expect(r.spec.meta.generator).toEqual({ route: 'deterministic', provider: 'import' });
        expect(r.spec.aiBlocks.categorise).toMatchObject({ verified: 'unverified' });
      }
    }
  });

  it('refuses other files without throwing', () => {
    for (const bad of [
      null, 42, 'text', [], { format: 'kalam-backup', apps: [] }, { format: 'kalam-backup', apps: [{ spec }, { spec }] },
      { format: 'kalam-backup', apps: [null] }, { ...spec, screens: 'nope' },
    ]) {
      expect(decodeAppFile(bad).ok, JSON.stringify(bad)?.slice(0, 40)).toBe(false);
    }
  });
});
