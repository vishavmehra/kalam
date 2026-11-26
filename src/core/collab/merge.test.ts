import { describe, expect, it } from 'vitest';
import { fixtureSpec } from '../backup/test-fixtures';
import { gzipToBase64 } from '../bazaar/codec';
import { makeToken, newCloudId, parseToken, randomBase32 } from './invite';
import { designHash, localChanges, merge3, packSpec, sameValues, sharedDesign, syncable, unpackSpec } from './merge';
import { canAssign, canRemove, effectiveRole, invitableRoles } from './roles';

describe('merge3', () => {
  it('takes one-sided changes and reports two-sided clashes, keeping mine', () => {
    const base = { a: 1, b: 'x', c: true };
    expect(merge3(base, { a: 2, b: 'x', c: true }, { a: 1, b: 'y', c: true })).toEqual({ merged: { a: 2, b: 'y', c: true }, clashes: [] });
    expect(merge3(base, { ...base, a: 2 }, { ...base, a: 3 })).toEqual({ merged: { a: 2, b: 'x', c: true }, clashes: [{ field: 'a', mine: 2, theirs: 3 }] });
    expect(merge3(base, { ...base, a: 5 }, { ...base, a: 5 }).clashes).toEqual([]);
    expect(sameValues({ a: null }, {})).toBe(true);
  });
});

describe('syncable', () => {
  it('never lets photos or local media refs leave the device', () => {
    const collection = {
      fields: {
        title: { type: 'text' as const, label: 'T' },
        photo: { type: 'image' as const, label: 'P' },
        note: { type: 'text' as const, label: 'N' },
      },
    };
    expect(syncable({ title: 'a', photo: 'local:abc', note: 'local:xyz', stray: 'z' }, collection)).toEqual({ title: 'a' });
  });
});

describe('localChanges', () => {
  it('derives creates, updates and deletes from what the device last agreed with the cloud', () => {
    const spec = fixtureSpec('app_x');
    const row = (id: string, title: string) => ({ id, appId: 'app_x', collectionId: 'expenses', createdAt: 1, updatedAt: 1, values: { title, amount: 1 } });
    const tracked = {
      r1: { localId: 'l1', collectionId: 'expenses', version: 2, base: { title: 'same', amount: 1 }, deleted: false },
      r2: { localId: 'l2', collectionId: 'expenses', version: 1, base: { title: 'old', amount: 1 }, deleted: false },
      r3: { localId: 'l3', collectionId: 'expenses', version: 4, base: { title: 'gone', amount: 1 }, deleted: false },
      r4: { localId: 'l4', collectionId: 'expenses', version: 1, base: { title: 'parked', amount: 1 }, deleted: false },
    };
    const local = { expenses: [row('l1', 'same'), row('l2', 'new'), row('l5', 'fresh'), row('l4', 'mine')] };
    const conflicts = [{ id: 'r4', collectionId: 'expenses', kind: 'both_changed' as const, fields: [], theirs: {}, theirVersion: 2, theirActor: 'x', detectedAt: 1 }];
    const out = localChanges(local, { tracked, conflicts }, spec);
    expect(out.map((c) => [c.kind, c.remoteId, c.baseVersion])).toEqual([
      ['update', 'r2', 1], ['create', 'l5', 0], ['delete', 'r3', 4],
    ]);
  });
});

describe('design packing', () => {
  it('round-trips, ignores per-device fields in the hash, and rejects tampering', () => {
    const spec = fixtureSpec('app_one');
    const packed = packSpec(spec);
    if (!packed.ok) throw new Error('pack');
    const back = unpackSpec(packed);
    expect(back.ok && back.spec.name).toBe(spec.name);
    expect(back.ok && Object.values(back.spec.aiBlocks).every((b) => b.verified === 'unverified')).toBe(true);
    expect(designHash({ ...spec, id: 'app_two', version: 9, meta: { ...spec.meta, updatedAt: 5 } })).toBe(designHash(spec));
    expect(designHash({ ...spec, name: 'Other' })).not.toBe(designHash(spec));
    expect(unpackSpec({ specGz: packed.specGz, specHash: 'f'.repeat(64) })).toEqual({ ok: false, code: 'spec_invalid' });
    const evil = JSON.stringify({ ...spec, screens: 'run me' });
    expect(unpackSpec({ specGz: gzipToBase64(evil), specHash: packed.specHash })).toEqual({ ok: false, code: 'spec_invalid' });
  });
});

describe('invite codes', () => {
  it('parses codes and links, and rejects anything else', () => {
    const secret = randomBase32(Uint8Array.from({ length: 20 }, (_, i) => i * 11));
    const id = newCloudId('s', new Uint8Array(19).fill(7));
    const code = makeToken({ kind: 'app', id }, secret);
    expect(parseToken(code)).toEqual({ target: { kind: 'app', id }, secret });
    expect(parseToken(` https://kalam.app/join?c=${encodeURIComponent(code)} `)?.secret).toBe(secret);
    expect(parseToken(code.replace(/^s/, 't'))?.target.kind).toBe('team');
    expect(parseToken(`${id}.short`)).toBeUndefined();
    expect(parseToken('<script>')).toBeUndefined();
  });
});

describe('roles', () => {
  it('ranks and limits', () => {
    expect(effectiveRole(undefined, 'owner')).toBe('admin');
    expect(effectiveRole('viewer', 'editor')).toBe('editor');
    expect(effectiveRole('owner', 'viewer')).toBe('owner');
    expect(invitableRoles('owner')).toEqual(['admin', 'editor', 'viewer']);
    expect(invitableRoles('admin')).toEqual(['editor', 'viewer']);
    expect(invitableRoles('editor')).toEqual([]);
    expect(canAssign('admin', 'viewer', 'editor')).toBe(true);
    expect(canAssign('admin', 'editor', 'admin')).toBe(false);
    expect(canAssign('owner', 'admin', 'owner')).toBe(false);
    expect(canRemove('admin', 'admin')).toBe(false);
    expect(canRemove('owner', 'owner')).toBe(false);
  });
});

describe('shared design', () => {
  it('makes a required photo field optional, since photos never leave a device, and leaves the rest alone', () => {
    const spec = fixtureSpec('a');
    expect(sharedDesign(spec)).toBe(spec);
    const withPhoto = { ...spec, collections: { expenses: { ...spec.collections.expenses!, fields: { ...spec.collections.expenses!.fields, receipt: { type: 'image' as const, label: 'Receipt', required: true } } } } };
    const relaxed = sharedDesign(withPhoto);
    expect(relaxed.collections.expenses!.fields.receipt).toEqual({ type: 'image', label: 'Receipt' });
    expect(relaxed.collections.expenses!.fields.title).toEqual(spec.collections.expenses!.fields.title);
    expect(sharedDesign(relaxed)).toBe(relaxed);
  });
});
