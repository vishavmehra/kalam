import { describe, expect, it } from 'vitest';
import type { StoredApp } from '@/core/contracts';
import { shelfView } from './model';

const app = (id: string, name: string, extra: Partial<StoredApp> = {}): StoredApp => ({
  id, createdAt: 1, updatedAt: 1, origin: { route: 'manual' },
  spec: { id, name, description: `${name} notes`, meta: {}, collections: {}, screens: [] } as unknown as StoredApp['spec'],
  ...extra,
});
const all = { query: '', sort: 'recent', category: 'all', archived: false } as const;

describe('shelfView', () => {
  const apps = [app('a', 'Zinc Book'), app('b', 'Apple Book', { pinned: true }), app('c', 'Old Book', { archived: true })];

  it('keeps the store order and hides archived apps on the main shelf', () => {
    expect(shelfView(apps, all).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('shows only archived apps when the archive is open, whatever the category', () => {
    expect(shelfView(apps, { ...all, archived: true }).map((a) => a.id)).toEqual(['c']);
    expect(shelfView(apps, { ...all, archived: true, category: 'shop' }).map((a) => a.id)).toEqual(['c']);
  });

  it('sorts by name with pinned apps first', () => {
    expect(shelfView(apps, { ...all, sort: 'name' }).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('searches names and descriptions, ignoring case and outer spaces', () => {
    expect(shelfView(apps, { ...all, query: '  APPLE ' }).map((a) => a.id)).toEqual(['b']);
    expect(shelfView(apps, { ...all, query: 'zinc book notes' }).map((a) => a.id)).toEqual(['a']);
    expect(shelfView(apps, { ...all, query: 'nothing like it' })).toEqual([]);
  });

  it('does not change the list it is given', () => {
    const before = apps.map((a) => a.id);
    shelfView(apps, { ...all, sort: 'name' });
    expect(apps.map((a) => a.id)).toEqual(before);
  });
});
