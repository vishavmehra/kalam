import { describe, expect, it } from 'vitest';
import type { StoredApp } from '@/core/contracts';
import type { KalamCollection, KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { getDatabase } from '@/infrastructure/storage/database';
import { getShareService, sharedRecordRepository } from './use-share';

const people: KalamCollection = { label: 'People', fields: { name: { type: 'text', label: 'Name' } } };
const jobs: KalamCollection = { label: 'Jobs', fields: { who: { type: 'text', label: 'Who' } } };

function design(id: string, name: string, collectionId: string, collection: KalamCollection): KalamSpec {
  const spec = {
    id, schemaVersion: '1.0.0', version: 1, name, lang: 'en',
    theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
    collections: { [collectionId]: collection },
    screens: [{ id: 'home', title: name, children: [{ id: 'all', type: 'list', source: collectionId, primary: Object.keys(collection.fields)[0] }] }],
    initialScreen: 'home', actions: {}, aiBlocks: {}, intents: {}, meta: { createdAt: 1 },
  };
  const checked = validateSpec(spec);
  if (!checked.ok || !checked.spec) throw new Error('test design invalid');
  return checked.spec;
}
const stored = (spec: KalamSpec): StoredApp => ({ id: spec.id, spec, createdAt: 1, updatedAt: 1, origin: { route: 'manual' } });

describe('the services the screens and the runtime use', () => {
  it('are built once over the real device database, and deleting an app removes its links', async () => {
    const db = getDatabase();
    for (const s of [design('app_people', 'People Book', 'people', people), design('app_jobs', 'Job Book', 'jobs', jobs)]) {
      await db.apps.save(stored(s), { summary: 'Created', source: 'create' });
    }
    const service = getShareService();
    expect(getShareService()).toBe(service);
    expect(sharedRecordRepository(db.records)).toBe(sharedRecordRepository(db.records));

    await db.records.insert('app_people', 'people', { name: 'Asha' });
    const walled = sharedRecordRepository(db.records);
    expect(await walled.list('app_jobs', 'jobs')).toEqual([]);

    const made = await service.create({
      sourceAppId: 'app_people', sourceCollection: 'people', destinationAppId: 'app_jobs', destinationCollection: 'jobs',
      access: 'read', fields: [{ source: 'name', target: 'who' }], confirmed: true,
    });
    expect(made.ok).toBe(true);
    // Ids come from the secure random source and satisfy the link id rule.
    expect(made.ok && made.link.id).toMatch(/^lnk_[a-z0-9]{8,32}$/);
    expect((await walled.list('app_jobs', 'jobs')).map((r) => r.values)).toEqual([{ who: 'Asha' }]);

    await db.apps.remove('app_people');
    expect(await service.list('app_jobs')).toEqual([]);
    expect(await walled.list('app_jobs', 'jobs')).toEqual([]);
  });
});
