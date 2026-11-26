/**
 * Installing a starter pack. Every app comes from a gallery template built on this device, so nothing is fetched and
 * it works with no network. Installing the same pack again adds only what is missing (docs/14 §20.4).
 */
import type { AppRepository, StoredApp } from '../contracts';
import { instantiateCatalogEntry } from '../templates/catalog';
import { PACK_UI } from './copy';
import { getStarterPack, type PackId } from './packs';

export interface PackInstallOptions {
  now: number;
  /** A fresh app id each call, e.g. `app_k3f9x2ab`. */
  newId: () => string;
  lang?: string;
  /** Apps already on the shelf. One made from the same template is left alone. An archived app is out of sight, so it does not count. */
  installed?: ReadonlyArray<Pick<StoredApp, 'origin' | 'spec' | 'archived'>>;
  /** Add a second copy of an app that is already there. */
  again?: boolean;
  /** Only these templates of the pack. */
  only?: readonly string[];
}

export interface PackInstallItem {
  templateId: string;
  title: string;
  status: 'ready' | 'already_installed' | 'failed';
  app?: StoredApp;
  error?: string;
}

export type PackPlan = { ok: true; items: PackInstallItem[] } | { ok: false; error: string };

/** An app made from this template is on the shelf. An archived one is hidden from the shelf, so it does not count. */
export const isTemplateOnShelf = (apps: PackInstallOptions['installed'], templateId: string): boolean =>
  !!apps?.some((a) => !a.archived && (a.origin.templateId === templateId || a.spec.meta.templateId === templateId));

/** What installing would do, without saving anything: one item per template of the pack. */
export function planPackInstall(packId: PackId | string, opts: PackInstallOptions): PackPlan {
  const pack = getStarterPack(packId);
  if (!pack) return { ok: false, error: 'That starter pack does not exist.' };
  const items: PackInstallItem[] = [];
  for (const templateId of pack.apps) {
    if (opts.only && !opts.only.includes(templateId)) continue;
    const built = instantiateCatalogEntry(templateId, { appId: opts.newId(), now: opts.now, lang: opts.lang ?? 'en' });
    if (!built.ok) { items.push({ templateId, title: templateId, status: 'failed', error: built.error }); continue; }
    const { spec, origin } = built.value;
    if (!opts.again && isTemplateOnShelf(opts.installed, templateId)) {
      items.push({ templateId, title: spec.name, status: 'already_installed' });
      continue;
    }
    items.push({
      templateId, title: spec.name, status: 'ready',
      app: { id: spec.id, spec, createdAt: opts.now, updatedAt: opts.now, origin: { ...origin } },
    });
  }
  return { ok: true, items };
}

export interface PackInstallResult {
  added: StoredApp[];
  alreadyInstalled: string[];
  failed: Array<{ templateId: string; error: string }>;
}

/**
 * Saves each new app. A failure on one app does not undo the others: every app is independent, and running the install
 * again adds only what is missing.
 */
export async function installStarterPack(
  store: { apps: Pick<AppRepository, 'save'> },
  packId: PackId | string,
  opts: PackInstallOptions,
): Promise<PackInstallResult | { error: string }> {
  const plan = planPackInstall(packId, opts);
  if (!plan.ok) return { error: plan.error };
  const result: PackInstallResult = { added: [], alreadyInstalled: [], failed: [] };
  for (const item of plan.items) {
    if (item.status === 'already_installed') { result.alreadyInstalled.push(item.templateId); continue; }
    if (item.status === 'failed' || !item.app) { result.failed.push({ templateId: item.templateId, error: item.error ?? 'It could not be built.' }); continue; }
    try {
      await store.apps.save(item.app, { summary: 'Created from a template', source: 'create', origin: 'user' });
      result.added.push(item.app);
    } catch {
      result.failed.push({ templateId: item.templateId, error: 'It could not be saved.' });
    }
  }
  return result;
}

export interface PackNotice {
  /** What went well, in green. */
  message?: string;
  /** What did not, in red. */
  failure?: string;
  /** Nothing went wrong, so the screen can move on. Otherwise it stays so the person reads this and can try again. */
  complete: boolean;
}

/** What to tell the person after an install, from all three counts (docs/14 §20.4). */
export function packInstallNotice(result: PackInstallResult): PackNotice {
  const { added, alreadyInstalled, failed } = result;
  const failure = failed.length ? PACK_UI.failed(failed.length) : undefined;
  if (added.length) {
    const message = alreadyInstalled.length ? PACK_UI.doneSome(added.length, alreadyInstalled.length) : PACK_UI.doneAll(added.length);
    return { message, ...(failure ? { failure } : {}), complete: !failure };
  }
  if (failure) return { failure, complete: false }; // nothing was added: never say the pack is already there
  return { message: PACK_UI.nothingNew, complete: true };
}
