import { gzipSync, strFromU8, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_SPEECH } from '@/core/contracts';
import { createWebDatabase } from '@/infrastructure/storage/database.web';
import { base64ToBytes, bytesToBase64 } from './base64';
import { deriveKey, encrypt, sha256Hex } from './crypto';
import { encodeEnvelope, headerAad, type Envelope } from './envelope';
import { BackupConflictError, BackupError } from './errors';
import { collectionToCsv, exportAppJson, exportFileName, exportRecordsJson } from './exports';
import { unpackPayload } from './payload';
import { createBackupService } from './service';
import { fixtureApp, fixtureSpec, PNG_BASE64 } from './test-fixtures';

const PASS = 'mango tea ledger window';
const FAST = { iterations: 2_000, minIterations: 1_000 };
const create = { summary: 'Created', source: 'create' } as const;
let n = 0;
const freshDb = () => createWebDatabase(`backup-test-${++n}-${Date.now()}`);

async function populated() {
  const db = freshDb();
  const app = await db.apps.save(fixtureApp(fixtureSpec()), create);
  await db.apps.save({ ...app, spec: { ...app.spec, name: 'Shop expenses' } }, { summary: 'Renamed', source: 'edit' });
  await db.apps.save(fixtureApp(fixtureSpec('app_ledger', 'Ledger')), create);
  await db.records.insert('app_expenses', 'expenses', { title: 'Tea', amount: 2, category: 'Food' });
  await db.records.insert('app_ledger', 'expenses', { title: 'Rent', amount: 500 });
  await db.state.set('app_expenses', 'cups', 3);
  await db.drawings.save({
    id: 'drw_1', title: 'Shop sketch', createdAt: 1, updatedAt: 2, schemaVersion: 2,
    pages: [{ id: 'pg_1', title: 'Home', width: 360, height: 640, elements: [{ id: 'el_1', kind: 'image', x: 0, y: 0, w: 10, h: 10, blobId: 'drw_img' }] }],
  });
  await db.blobs.put({ id: 'drw_img', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 'drw_1' });
  await db.blobs.put({ id: 'draft_img', kind: 'image', mimeType: 'image/png', base64: PNG_BASE64, ownerId: 's_draft' });
  await db.aiCache.set('cached', { label: 'Food' }, { taskType: 'classify', source: 'on_device' });
  await db.settings.update({
    onboarded: true, language: 'hi', allowCloud: false, accessModes: { ...DEFAULT_SETTINGS.accessModes, large: true },
    speech: { ...DEFAULT_SPEECH, rate: 1.25, keepRecordings: true },
  });
  return db;
}

const envelopeOf = (bytes: Uint8Array) => JSON.parse(strFromU8(bytes)) as Envelope;
const reencode = (env: Envelope) => strToU8(JSON.stringify(env));
const codeOf = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (err: unknown) => err);
  expect(e).toBeInstanceOf(BackupError);
  return (e as BackupError).code;
};

describe('encrypted backup round trip', () => {
  it('exports ciphertext only and restores apps, history, records, state, drawings, files and safe settings', async () => {
    const source = await populated();
    const { bytes, manifest } = await createBackupService({ db: source, ...FAST }).exportEncrypted(PASS);
    expect(manifest).toMatchObject({ format: 'kalam-encrypted-backup', formatVersion: 1, appCount: 2, recordCount: 2 });
    expect(manifest.includes).toEqual(['apps', 'versions', 'records', 'state', 'drawings', 'settings']);
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/);
    const text = strFromU8(bytes);
    for (const secret of ['Tea', 'Shop expenses', 'my private shop notes', PASS]) expect(text).not.toContain(secret);
    const env = envelopeOf(bytes);
    expect(env).toMatchObject({ algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 2_000, compression: 'gzip' });
    expect(base64ToBytes(env.salt)).toHaveLength(16);
    expect(base64ToBytes(env.iv)).toHaveLength(12);

    const target = freshDb();
    const service = createBackupService({ db: target, ...FAST });
    const preview = await service.preview(bytes, PASS);
    expect(preview.apps.map((a) => [a.name, a.records, a.versions])).toEqual([['Shop expenses', 1, 2], ['Ledger', 1, 1]]);
    expect(preview).toMatchObject({ conflicts: [], drawingCount: 1, settingsIncluded: true, skipped: { apps: 0, versions: 0, records: 0, drawings: 0, files: 0 } });
    expect(await target.apps.list()).toEqual([]); // preview writes nothing

    const summary = await service.importEncrypted(bytes, PASS);
    expect(summary).toMatchObject({ apps: 2, records: 2, skippedApps: 0, skippedRecords: 0, replacedApps: 0, keptLocalApps: 0, drawings: 1, settingsApplied: true });
    expect((await target.versions.materialize('app_expenses', 1))?.name).toBe('Expenses');
    expect((await target.versions.materialize('app_expenses', 2))?.name).toBe('Shop expenses');
    expect((await target.records.list('app_expenses', 'expenses')).map((r) => r.values.title)).toEqual(['Tea']);
    expect(await target.state.all('app_expenses')).toEqual({ cups: 3 });
    expect((await target.drawings.get('drw_1'))?.pages[0].elements[0]).toMatchObject({ kind: 'image', blobId: 'drw_img' });
    expect((await target.blobs.get('drw_img'))?.base64).toBe(PNG_BASE64);
    expect(await target.blobs.get('draft_img')).toBeUndefined(); // drafts are temporary
    expect(await target.aiCache.size()).toBe(0); // AI cache is never backed up

    const settings = await target.settings.get();
    expect(settings).toMatchObject({ language: 'hi', accessModes: { large: true }, allowCloud: true, onboarded: false });
    expect(settings.speech).toMatchObject({ rate: 1.25, keepRecordings: false }); // a restore never widens retention

    const restored = (await target.apps.get('app_expenses'))?.spec;
    expect(restored?.aiBlocks.sort_it.verified).toBe('unverified'); // R-09
    expect(restored?.meta.generator).toEqual({ route: 'deterministic', provider: 'import' });
  });

  it('uses PBKDF2 at 310,000 iterations by default and refuses weaker files', async () => {
    const db = freshDb();
    await db.apps.save(fixtureApp(fixtureSpec()), create);
    const service = createBackupService({ db });
    const started = Date.now();
    const { bytes } = await service.exportEncrypted(PASS);
    const exportMs = Date.now() - started;
    expect(envelopeOf(bytes).iterations).toBe(310_000);
    expect((await service.preview(bytes, PASS)).apps).toHaveLength(1);
    console.info(`[backup] export at 310k iterations took ${exportMs} ms in Node`);

    const weak = await createBackupService({ db, ...FAST }).exportEncrypted(PASS);
    expect(await codeOf(service.preview(weak.bytes, PASS))).toBe('not_a_backup');
  }, 30_000);

  it('derives identical keys with the platform PBKDF2 and the JS one, so web backups open on Android', async () => {
    const salt = new Uint8Array(16).fill(3);
    const native = await deriveKey(PASS, salt, 5_000);
    expect(bytesToBase64(await deriveKey(PASS, salt, 5_000, { native: false }))).toBe(bytesToBase64(native));
    // A passphrase typed with a composed or a decomposed accent gives the same key.
    expect(bytesToBase64(await deriveKey('café ledger book', salt, 1_000))).toBe(bytesToBase64(await deriveKey('café ledger book', salt, 1_000, { native: false })));
  });

  it('rejects a wrong passphrase clearly and writes nothing', async () => {
    const { bytes } = await createBackupService({ db: await populated(), ...FAST }).exportEncrypted(PASS);
    const target = freshDb();
    const service = createBackupService({ db: target, ...FAST });
    const error = await service.preview(bytes, 'mango tea ledger door').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    expect((error as BackupError).code).toBe('wrong_passphrase_or_damaged');
    expect((error as Error).message).toMatch(/Check the passphrase/);
    expect(await codeOf(service.importEncrypted(bytes, 'wrong passphrase here'))).toBe('wrong_passphrase_or_damaged');
    expect(await target.apps.list()).toEqual([]);
  });

  it('detects changed ciphertext, nonce, salt or header (GCM tag + associated data)', async () => {
    const { bytes } = await createBackupService({ db: await populated(), ...FAST }).exportEncrypted(PASS);
    const service = createBackupService({ db: freshDb(), ...FAST });
    const env = envelopeOf(bytes);
    const flip = (b64: string, at: number) => {
      const raw = base64ToBytes(b64);
      raw[at] ^= 1;
      return bytesToBase64(raw);
    };
    const cases: Array<[Envelope, string]> = [
      [{ ...env, ciphertext: flip(env.ciphertext, 40) }, 'wrong_passphrase_or_damaged'],
      [{ ...env, ciphertext: flip(env.ciphertext, base64ToBytes(env.ciphertext).length - 1) }, 'wrong_passphrase_or_damaged'],
      [{ ...env, iv: flip(env.iv, 0) }, 'wrong_passphrase_or_damaged'],
      [{ ...env, salt: flip(env.salt, 3) }, 'wrong_passphrase_or_damaged'],
      [{ ...env, iterations: 2_001 }, 'wrong_passphrase_or_damaged'],
      [{ ...env, ciphertext: env.ciphertext.slice(0, 40) }, 'wrong_passphrase_or_damaged'],
      [{ ...env, formatVersion: 2 } as unknown as Envelope, 'unsupported_version'],
      [{ ...env, algorithm: 'ChaCha20-Poly1305' } as unknown as Envelope, 'unsupported_version'],
      [{ ...env, iterations: 10 }, 'not_a_backup'],
      [{ ...env, iterations: 50_000_000 }, 'not_a_backup'],
      [{ ...env, iv: 'AAAA' }, 'not_a_backup'],
    ];
    for (const [changed, code] of cases) expect(await codeOf(service.preview(reencode(changed), PASS))).toBe(code);
    expect(await codeOf(service.preview(strToU8('{"format":"something else"}'), PASS))).toBe('not_a_backup');
    expect(await codeOf(service.preview(strToU8('not json at all'), PASS))).toBe('not_a_backup');
    expect(await codeOf(service.preview(bytes.subarray(0, bytes.length - 5), PASS))).toBe('not_a_backup');
    expect(await codeOf(service.preview(new Uint8Array(0), PASS))).toBe('not_a_backup');
  });

  it('checks the manifest checksum after decryption', async () => {
    const payload = strToU8(JSON.stringify({ format: 'kalam-backup-data', formatVersion: 1, apps: [], versions: [], records: [], state: [], drawings: [], blobs: [] }));
    const manifest = { format: 'kalam-encrypted-backup', formatVersion: 1, createdAt: 1, appCount: 0, recordCount: 0, includes: ['apps'], checksum: sha256Hex(strToU8('other')) };
    const plaintext = gzipSync(strToU8(`${JSON.stringify(manifest)}\n${strFromU8(payload)}`));
    const salt = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(12).fill(9);
    const header = {
      format: 'kalam-encrypted-backup', formatVersion: 1, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 2_000,
      salt: bytesToBase64(salt), iv: bytesToBase64(iv), compression: 'gzip',
    } as const;
    const key = await deriveKey(PASS, salt, 2_000);
    const file = encodeEnvelope({ ...header, ciphertext: bytesToBase64(encrypt(key, iv, plaintext, headerAad(header))) });
    expect(await codeOf(createBackupService({ db: freshDb(), ...FAST }).preview(file, PASS))).toBe('damaged');
  });

  it('refuses a compressed payload that claims to be huge before inflating it', () => {
    const gz = gzipSync(strToU8('{}\n{}'));
    const bomb = gz.slice();
    bomb.set([0xff, 0xff, 0xff, 0x7f], bomb.length - 4);
    expect(() => unpackPayload(bomb)).toThrow(BackupError);
    expect((() => { try { unpackPayload(bomb); } catch (e) { return (e as BackupError).code; } })()).toBe('too_large');
    const lying = gz.slice();
    lying.set([1, 0, 0, 0], lying.length - 4);
    expect((() => { try { unpackPayload(lying); } catch (e) { return (e as BackupError).code; } })()).toBe('damaged');
  });

  it('never overwrites a local app without an explicit choice (docs/14 §15.6)', async () => {
    const { bytes } = await createBackupService({ db: await populated(), ...FAST }).exportEncrypted(PASS);
    const setup = async () => {
      const db = freshDb();
      await db.apps.save(fixtureApp(fixtureSpec('app_expenses', 'My expenses')), create);
      await db.records.insert('app_expenses', 'expenses', { title: 'Local tea', amount: 9 });
      return db;
    };

    const asked = await setup();
    const service = createBackupService({ db: asked, ...FAST });
    expect((await service.preview(bytes, PASS)).conflicts).toEqual([{ id: 'app_expenses', name: 'Shop expenses', localName: 'My expenses' }]);
    const conflict = await service.importEncrypted(bytes, PASS).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(BackupConflictError);
    expect((conflict as BackupConflictError).conflicts.map((c) => c.localName)).toEqual(['My expenses']);
    expect((await asked.apps.list()).map((a) => a.id)).toEqual(['app_expenses']); // nothing written

    const kept = await service.importEncrypted(bytes, PASS, { overwrite: false });
    expect(kept).toMatchObject({ apps: 1, keptLocalApps: 1, replacedApps: 0 });
    expect((await asked.apps.get('app_expenses'))?.spec.name).toBe('My expenses');
    expect((await asked.records.list('app_expenses', 'expenses')).map((r) => r.values.title)).toEqual(['Local tea']);
    expect((await asked.apps.get('app_ledger'))?.spec.name).toBe('Ledger');

    const replacedDb = await setup();
    const replaced = await createBackupService({ db: replacedDb, ...FAST }).importEncrypted(bytes, PASS, { overwrite: true, restoreSettings: false });
    expect(replaced).toMatchObject({ apps: 2, replacedApps: 1, settingsApplied: false });
    expect((await replacedDb.apps.get('app_expenses'))?.spec.name).toBe('Shop expenses');
    expect((await replacedDb.records.list('app_expenses', 'expenses')).map((r) => r.values.title)).toEqual(['Tea']);
    expect((await replacedDb.settings.get()).language).toBe('en');
  });

  it('backs up and restores only the apps the person chose', async () => {
    const source = await populated();
    const service = createBackupService({ db: source, ...FAST });
    const { bytes, manifest } = await service.exportEncrypted(PASS, { appIds: ['app_ledger'], includeSettings: false });
    expect(manifest).toMatchObject({ appCount: 1, recordCount: 1 });
    expect(manifest.includes).not.toContain('settings');
    const preview = await createBackupService({ db: freshDb(), ...FAST }).preview(bytes, PASS);
    expect(preview.apps.map((a) => a.id)).toEqual(['app_ledger']);
    expect(preview.drawingCount).toBe(1);

    const everything = (await service.exportEncrypted(PASS)).bytes;
    const target = freshDb();
    const res = await createBackupService({ db: target, ...FAST }).importEncrypted(everything, PASS, { appIds: ['app_expenses'] });
    expect(res.apps).toBe(1);
    expect((await target.apps.list()).map((a) => a.id)).toEqual(['app_expenses']);
    expect(await target.records.list('app_ledger', 'expenses')).toEqual([]);
  });

  it('refuses short passphrases and a broken random source', async () => {
    const db = freshDb();
    expect(await codeOf(createBackupService({ db, ...FAST }).exportEncrypted('short'))).toBe('weak_passphrase');
    const zeros = createBackupService({ db, ...FAST, randomBytes: (len) => new Uint8Array(len) });
    expect(await codeOf(zeros.exportEncrypted(PASS))).toBe('random_unavailable');
  });

  it('survives random corruption: every damaged file is refused and nothing is written (fuzz)', async () => {
    const { bytes } = await createBackupService({ db: await populated(), ...FAST }).exportEncrypted(PASS);
    const target = freshDb();
    const service = createBackupService({ db: target, ...FAST });
    let seed = 42;
    const rand = (max: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % max);
    for (let i = 0; i < 40; i++) {
      const copy = bytes.slice();
      for (let k = 0; k <= i % 3; k++) copy[rand(copy.length)] = 32 + rand(95);
      if (copy.every((b, j) => b === bytes[j])) continue;
      await expect(service.importEncrypted(copy, PASS)).rejects.toBeInstanceOf(BackupError);
    }
    expect(await target.apps.list()).toEqual([]);
  });
});

describe('portable exports', () => {
  it('writes spreadsheet-safe CSV', () => {
    const spec = fixtureSpec();
    const csv = collectionToCsv(spec.collections.expenses, [
      { id: 'r1', appId: spec.id, collectionId: 'expenses', createdAt: 0, updatedAt: 0, values: { title: 'Tea, "masala"', amount: -2.5, paid: true } },
      { id: 'r2', appId: spec.id, collectionId: 'expenses', createdAt: 0, updatedAt: 0, values: { title: '=HYPERLINK("http://evil")', amount: 3, category: 'Food', paid: false } },
      { id: 'r3', appId: spec.id, collectionId: 'expenses', createdAt: 0, updatedAt: 0, values: { title: 'line\nbreak', amount: 0 } },
    ]);
    expect(csv.startsWith('﻿Title,Amount,Category,Paid,Added,Changed\r\n')).toBe(true);
    const rows = csv.slice(1).split('\r\n');
    expect(rows[1]).toMatch(/^"Tea, ""masala""",-2.5,,Yes,\d{4}-\d{2}-\d{2} \d{2}:\d{2},/);
    expect(rows[2]).toMatch(/^"'=HYPERLINK\(""http:\/\/evil""\)",3,Food,No,/);
    expect(csv).toContain('"line\nbreak",0,,,');
    expect(collectionToCsv(spec.collections.expenses, [], { bom: false })).toBe('Title,Amount,Category,Paid,Added,Changed\r\n');
    expect(exportFileName('Kirana: credit book!', 'records', 'csv')).toBe('Kirana-credit-book-records.csv');
  });

  it('exports one app as JSON: design only by default, records only when asked, and it imports back', async () => {
    const db = freshDb();
    const app = await db.apps.save(fixtureApp(fixtureSpec()), create);
    await db.records.insert(app.id, 'expenses', { title: 'Tea', amount: 2 });
    const design = exportAppJson(app, { now: 5 });
    expect(design).toMatchObject({ format: 'kalam-backup', formatVersion: 1, exportedAt: 5, records: [], state: [] });
    expect(JSON.stringify(design)).not.toContain('my private shop notes');

    const records = await db.records.list(app.id, 'expenses');
    const full = exportAppJson(app, { records: [...records, { ...records[0], id: 'other', appId: 'app_other' }], state: { cups: 2 } });
    expect(full.records).toHaveLength(1);
    expect(full.state).toEqual([{ appId: app.id, key: 'cups', value: 2 }]);

    const target = freshDb();
    expect(await target.importAll(JSON.parse(JSON.stringify(full)))).toMatchObject({ apps: 1, records: 1 });
    expect((await target.records.list(app.id, 'expenses'))[0].values.title).toBe('Tea');

    const recordsOnly = exportRecordsJson(app, records, 7);
    expect(recordsOnly).toMatchObject({ format: 'kalam-records', exportedAt: 7, app: { id: app.id, name: 'Expenses' } });
    expect(recordsOnly.collections.expenses.fields.amount).toEqual({ label: 'Amount', type: 'number' });
    expect(recordsOnly.collections.expenses.records.map((r) => r.values.title)).toEqual(['Tea']);
    expect(JSON.stringify(recordsOnly)).not.toContain('screens');
  });
});
