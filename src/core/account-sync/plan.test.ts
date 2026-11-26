import { describe, expect, it } from 'vitest';
import type { AppSyncState, RemoteApp } from './model';
import { pendingCount, planSync, type LocalApp } from './plan';

const remote = (id: string, over: Partial<RemoteApp> = {}): RemoteApp => ({
  id, name: id, icon: null, version: 1, specGz: 'x'.repeat(24), specHash: 'r'.repeat(64), updatedAt: 100, syncedAt: 100,
  deleted: false, route: 'template', bazaar: null, ...over,
});
const tomb = (id: string, updatedAt = 100): RemoteApp => remote(id, { specGz: null, specHash: null, deleted: true, updatedAt });
const agreed = (over: Partial<AppSyncState> = {}): AppSyncState => ({ localHash: 'L', remoteHash: 'r'.repeat(64), remoteUpdatedAt: 100, deleted: false, ...over });
const app = (id: string, hash = 'L', updatedAt = 100): LocalApp => ({ id, hash, updatedAt });
const kinds = (input: Parameters<typeof planSync>[0]) => planSync(input).map((a) => `${a.kind}:${a.appId}`);

describe('planSync', () => {
  it('uploads new and changed local apps, ignores agreed ones', () => {
    expect(kinds({ local: [app('a'), app('b', 'L2'), app('c')], pulled: [], state: { b: agreed(), c: agreed() } })).toEqual(['upload:a', 'upload:b']);
  });

  it('downloads new and changed account apps', () => {
    const state = { b: agreed() };
    expect(kinds({ local: [app('b')], pulled: [remote('a'), remote('b', { specHash: 'n'.repeat(64) })], state })).toEqual(['download:a', 'download:b']);
  });

  it('both sides changed is a conflict for the engine to settle', () => {
    expect(kinds({ local: [app('a', 'L2')], pulled: [remote('a', { specHash: 'n'.repeat(64) })], state: { a: agreed() } })).toEqual(['conflict:a']);
    // A first sync with the same app on both sides compares designs too.
    expect(kinds({ local: [app('a')], pulled: [remote('a')], state: {} })).toEqual(['conflict:a']);
  });

  it('a local delete becomes a tombstone, unless the account copy changed since', () => {
    expect(kinds({ local: [], pulled: [], state: { a: agreed() } })).toEqual(['tombstone:a']);
    expect(kinds({ local: [], pulled: [remote('a', { specHash: 'n'.repeat(64) })], state: { a: agreed() } })).toEqual(['download:a']);
  });

  it('a delete in the account removes the local copy, unless it was edited here later', () => {
    expect(kinds({ local: [app('a')], pulled: [tomb('a', 200)], state: { a: agreed() } })).toEqual(['remove_local:a']);
    expect(kinds({ local: [app('a', 'L2', 300)], pulled: [tomb('a', 200)], state: { a: agreed() } })).toEqual(['upload:a']);
    expect(kinds({ local: [app('a', 'L2', 100)], pulled: [tomb('a', 200)], state: { a: agreed() } })).toEqual(['remove_local:a']);
  });

  it('remembers tombstones of apps it never had and sends nothing twice', () => {
    expect(kinds({ local: [], pulled: [tomb('a')], state: {} })).toEqual(['note:a']);
    expect(kinds({ local: [], pulled: [tomb('a')], state: { a: agreed({ deleted: true, remoteHash: null }) } })).toEqual([]);
  });

  it('never touches excluded (shared) apps, not even with a tombstone', () => {
    expect(kinds({ local: [], pulled: [], state: { a: agreed() }, excluded: new Set(['a']) })).toEqual([]);
  });

  it('counts the offline queue', () => {
    expect(pendingCount([app('a'), app('b', 'L2')], { b: agreed(), c: agreed() })).toBe(3);
  });
});
