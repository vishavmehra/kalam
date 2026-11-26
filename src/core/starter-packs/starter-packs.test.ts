import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredApp } from '../contracts';
import { validateSpec } from '../spec/validate';
import { getCatalogEntry } from '../templates/catalog';
import {
  PACK_COPY, PACK_IDS, PACK_UI, STARTER_PACKS, getStarterPack, installStarterPack, isTemplateOnShelf, packInstallNotice,
  packSuggestedModes, planPackInstall, type PackInstallOptions,
} from './index';

const NOW = 1_794_950_000_000;
let n = 0;
const opts = (extra: Partial<PackInstallOptions> = {}): PackInstallOptions => ({ now: NOW, newId: () => `app_pack${++n}`, ...extra });

function memoryStore(failAt: number[] = []) {
  const saved: StoredApp[] = [];
  let calls = 0;
  return {
    saved,
    store: {
      apps: {
        async save(app: StoredApp) {
          if (failAt.includes(calls++)) throw new Error('disk full');
          saved.push(app);
          return app;
        },
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the five packs', () => {
  it('are retail and kirana, tailoring, education, clinics and home', () => {
    expect(PACK_IDS).toEqual(['retail_kirana', 'tailoring', 'education', 'clinics', 'home']);
    expect(STARTER_PACKS.map((p) => p.id)).toEqual([...PACK_IDS]);
  });

  it('each has a target user, a welcome, a short walk through and tips', () => {
    for (const p of STARTER_PACKS) {
      expect(p.audience.length, p.id).toBeGreaterThan(30);
      expect(p.welcome, p.id).toMatch(/no signal/);
      expect(p.steps.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.tips.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.apps.length, p.id).toBeGreaterThanOrEqual(3);
      expect(new Set(p.apps).size, p.id).toBe(p.apps.length);
    }
  });

  it('hold the apps docs/14 §20.2 names', () => {
    const has = (id: string, want: string[]) => expect(getStarterPack(id)!.apps).toEqual(expect.arrayContaining(want));
    has('tailoring', ['tailor_book', 'tailor_order_book', 'delivery_tracker', 'payment_ledger']);
    has('retail_kirana', ['inventory_manager', 'kirana_credit_book', 'daily_sales', 'supplier_list']);
    has('education', ['student_register', 'attendance_register', 'fee_tracker', 'homework_tracker']);
    has('clinics', ['appointment_tracker', 'visit_register', 'followup_list']);
  });

  it('only point at templates that exist, and every one of them is tested in the gallery', () => {
    for (const p of STARTER_PACKS) for (const id of p.apps) expect(getCatalogEntry(id), `${p.id}: ${id}`).toBeDefined();
  });

  it('is written in plain words: no em dashes, no exclamation marks, no hype', () => {
    const text = JSON.stringify([PACK_COPY, PACK_UI.installAll(3), PACK_UI.doneSome(2, 1), PACK_UI.failed(2)]);
    expect(text).not.toMatch(/—|–|!/);
    expect(text).not.toMatch(/seamless|unlock|leverage|empower|supercharge|revolution|cutting-edge|game-chang|delve|elevate/i);
  });

  it('keeps the clinic pack honest about what it is', () => {
    const clinic = getStarterPack('clinics')!;
    expect(clinic.notice).toMatch(/give no medical advice/);
    expect(clinic.notice).toMatch(/not a medical record system/);
    expect(JSON.stringify(clinic)).not.toMatch(/certified|hipaa|compliant|secure medical/i);
    for (const id of clinic.apps) {
      const spec = getCatalogEntry(id)!.build({ appId: 'app_c', now: NOW, lang: 'en' });
      expect(JSON.stringify(spec), id).toMatch(/not a medical record system/);
    }
  });

  it('offers the access modes of its apps once', () => {
    expect(packSuggestedModes(getStarterPack('clinics')!)).toEqual(['large']);
    expect(packSuggestedModes(getStarterPack('home')!).sort()).toEqual(['large', 'readAloud']);
  });
});

describe('installing a pack with no network', () => {
  it('adds every app, valid, independent and marked as made from its template', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('the network must not be used'); });
    vi.stubGlobal('fetch', fetchSpy);
    for (const pack of STARTER_PACKS) {
      const m = memoryStore();
      const r = await installStarterPack(m.store, pack.id, opts());
      expect('error' in r, pack.id).toBe(false);
      if ('error' in r) continue;
      expect(r.failed).toEqual([]);
      expect(r.added.map((a) => a.origin.templateId)).toEqual([...pack.apps]);
      expect(new Set(r.added.map((a) => a.id)).size).toBe(pack.apps.length);
      for (const app of r.added) {
        expect(validateSpec(app.spec).ok, `${pack.id}: ${app.spec.name}`).toBe(true);
        expect(app.origin).toMatchObject({ route: 'template', provider: 'deterministic' });
        expect(app.spec.meta.basedOn).toBeUndefined();
        expect(JSON.stringify(app.spec)).not.toMatch(/Sample Person|Ramesh|Meena/); // no example entries are copied in
        expect(app.creationInput).toBeUndefined();
      }
      expect(m.saved).toHaveLength(pack.apps.length);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the example entries every pack app shows are made up, and clearly so', () => {
    for (const pack of STARTER_PACKS) {
      for (const id of pack.apps) {
        const text = JSON.stringify(getCatalogEntry(id)!.sample);
        expect(text, id).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
        expect(text, id).not.toMatch(/\b\d{10}\b/);
      }
    }
  });
});

describe('installing a pack again', () => {
  it('adds only what is missing', async () => {
    const m = memoryStore();
    const first = await installStarterPack(m.store, 'tailoring', opts({ only: ['tailor_book', 'payment_ledger'] }));
    if ('error' in first) throw new Error(first.error);
    expect(first.added).toHaveLength(2);

    const second = await installStarterPack(m.store, 'tailoring', opts({ installed: m.saved }));
    if ('error' in second) throw new Error(second.error);
    expect(second.added.map((a) => a.origin.templateId)).toEqual(['tailor_order_book', 'delivery_tracker']);
    expect(second.alreadyInstalled).toEqual(['tailor_book', 'payment_ledger']);

    const third = await installStarterPack(m.store, 'tailoring', opts({ installed: m.saved }));
    if ('error' in third) throw new Error(third.error);
    expect(third.added).toEqual([]);
    expect(third.alreadyInstalled).toHaveLength(4);
  });

  it('recognises an app by its template even after the person renamed it', async () => {
    const m = memoryStore();
    await installStarterPack(m.store, 'clinics', opts({ only: ['visit_register'] }));
    const renamed = m.saved.map((a) => ({ ...a, spec: { ...a.spec, name: 'Front desk book' } }));
    const plan = planPackInstall('clinics', opts({ installed: renamed }));
    expect(plan.ok && plan.items.find((i) => i.templateId === 'visit_register')?.status).toBe('already_installed');
  });

  it('adds a second copy only when asked', () => {
    const m = [{ origin: { route: 'template' as const, templateId: 'visit_register' }, spec: { meta: { templateId: 'visit_register' } } as never }];
    const plan = planPackInstall('clinics', opts({ installed: m, again: true }));
    expect(plan.ok && plan.items.every((i) => i.status === 'ready')).toBe(true);
  });
});

describe('when something goes wrong', () => {
  it('one app failing to save does not undo the others, and a retry adds only the missing one', async () => {
    const m = memoryStore([1]);
    const r = await installStarterPack(m.store, 'clinics', opts());
    if ('error' in r) throw new Error(r.error);
    expect(r.added.map((a) => a.origin.templateId)).toEqual(['appointment_tracker', 'followup_list']);
    expect(r.failed).toEqual([{ templateId: 'visit_register', error: 'It could not be saved.' }]);

    const retry = await installStarterPack(m.store, 'clinics', opts({ installed: m.saved }));
    if ('error' in retry) throw new Error(retry.error);
    expect(retry.added.map((a) => a.origin.templateId)).toEqual(['visit_register']);
  });

  it('an unknown pack is refused in plain words', async () => {
    const r = await installStarterPack(memoryStore().store, 'nope', opts());
    expect(r).toEqual({ error: 'That starter pack does not exist.' });
    expect(planPackInstall('nope', opts()).ok).toBe(false);
  });
});

describe('what the person is told after an install', () => {
  const install = async (packId: string, failAt: number[] = [], extra: Partial<PackInstallOptions> = {}) => {
    const r = await installStarterPack(memoryStore(failAt).store, packId, opts(extra));
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it('every app saved: one green line, and the screen can move on', async () => {
    expect(packInstallNotice(await install('clinics'))).toEqual({ message: PACK_UI.doneAll(3), complete: true });
  });

  it('nothing could be saved: only the failure, never "already on your shelf"', async () => {
    const notice = packInstallNotice(await install('clinics', [0, 1, 2]));
    expect(notice).toEqual({ failure: PACK_UI.failed(3), complete: false });
    expect(notice.message).toBeUndefined();
  });

  it('some saved and some did not: both lines, and the screen stays so the failure is read', async () => {
    expect(packInstallNotice(await install('clinics', [1]))).toEqual({ message: PACK_UI.doneAll(2), failure: PACK_UI.failed(1), complete: false });
  });

  it('some were already there and one failed', async () => {
    const m = memoryStore();
    await installStarterPack(m.store, 'clinics', opts({ only: ['visit_register'] }));
    const r = await install('clinics', [0], { installed: m.saved });
    expect(packInstallNotice(r)).toEqual({ message: PACK_UI.doneSome(1, 1), failure: PACK_UI.failed(1), complete: false });
  });

  it('every app was already there and none failed: says so', async () => {
    const m = memoryStore();
    await installStarterPack(m.store, 'clinics', opts());
    expect(packInstallNotice(await install('clinics', [], { installed: m.saved }))).toEqual({ message: PACK_UI.nothingNew, complete: true });
  });
});

describe('archived apps', () => {
  it('an archived app is out of sight, so it does not count as on the shelf', async () => {
    const m = memoryStore();
    await installStarterPack(m.store, 'clinics', opts({ only: ['visit_register'] }));
    const archived = m.saved.map((a) => ({ ...a, archived: true as const }));
    expect(isTemplateOnShelf(m.saved, 'visit_register')).toBe(true);
    expect(isTemplateOnShelf(archived, 'visit_register')).toBe(false);
    const plan = planPackInstall('clinics', opts({ installed: archived }));
    expect(plan.ok && plan.items.find((i) => i.templateId === 'visit_register')?.status).toBe('ready');
  });
});

describe('packs read well on a card', () => {
  it('counts apps in words', () => {
    expect(PACK_UI.appsIn(1)).toBe('1 app');
    expect(PACK_UI.appsIn(5)).toBe('5 apps');
    expect(PACK_UI.installAll(5)).toBe('Add all 5 apps');
    expect(PACK_UI.doneSome(2, 1)).toBe('2 apps added. 1 was already on your shelf.');
  });
});
