/** Hooks that run the storage actions with the toast and the shelf refresh the screens need. */
import { useCallback, useState } from 'react';

import { generateId } from '@/core/pipeline/create-application';
import { cloneDoneMessage, type CloneRequest } from '@/core/clone';
import type { StoredApp } from '@/core/contracts';
import { installStarterPack, type PackInstallResult } from '@/core/starter-packs';
import type { InstallChoices } from '@/core/templates/catalog';
import { ARCHIVE_CHANGE, withArchived } from '@/core/templates/catalog/shelf';
import { useToast } from '@/design';
import { getDatabase } from '@/infrastructure/storage/database';
import { useAppsStore } from '@/state/apps-store';

import { cloneApp, installTemplate } from './actions';
import { copy } from './copy';

const ids = () => ({ newId: () => generateId('app'), now: Date.now() });

/** Adds an app made from a gallery template. Resolves to the new app, or undefined after telling the person why not. */
export function useInstallTemplate() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const install = useCallback(
    async (entryId: string, choices: InstallChoices): Promise<StoredApp | undefined> => {
      setBusy(true);
      try {
        const r = await installTemplate(getDatabase(), entryId, choices, ids());
        if (!r.ok) {
          toast.show({ message: r.error, tone: 'danger' });
          return undefined;
        }
        await useAppsStore.getState().refresh();
        toast.show({ message: copy.preview.added(r.app.spec.name), tone: 'success' });
        return r.app;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { install, busy };
}

/** Adds the apps of a starter pack that are not on the shelf yet. */
export function useInstallPack() {
  const [busy, setBusy] = useState(false);
  const install = useCallback(async (packId: string): Promise<PackInstallResult | { error: string }> => {
    setBusy(true);
    try {
      const result = await installStarterPack(getDatabase(), packId, { ...ids(), installed: useAppsStore.getState().apps });
      await useAppsStore.getState().refresh();
      return result;
    } catch {
      return { error: copy.preview.failed };
    } finally {
      setBusy(false);
    }
  }, []);
  return { install, busy };
}

/** Makes a copy of an app and says so, including anything that stayed behind. Resolves to the copy, or undefined after telling the person why not. */
export function useCloneApp() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const clone = useCallback(
    async (source: StoredApp, request: CloneRequest): Promise<StoredApp | undefined> => {
      setBusy(true);
      try {
        const r = await cloneApp(getDatabase(), source, request, ids());
        if (!r.ok) {
          toast.show({ message: r.error, tone: 'danger' });
          return undefined;
        }
        await useAppsStore.getState().refresh();
        const done = cloneDoneMessage(r.app.spec.name, r.outcome);
        toast.show({ message: done.message, tone: done.partial ? 'info' : 'success' });
        return r.app;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { clone, busy };
}

/**
 * Moves an app into the archive or back to the shelf. Nothing is deleted either way. The app is read again from the
 * database first, because the shelf's copy can be older than what is stored (opened time, checks, pin).
 */
export function useArchiveApp() {
  const toast = useToast();
  return useCallback(
    async (app: Pick<StoredApp, 'id'>, archived: boolean): Promise<boolean> => {
      try {
        const fresh = await getDatabase().apps.get(app.id);
        if (!fresh) throw new Error('gone');
        await useAppsStore.getState().save(withArchived(fresh, archived), ARCHIVE_CHANGE);
        toast.show({ message: archived ? copy.shelf.archived : copy.shelf.unarchived, tone: 'success' });
        return true;
      } catch {
        toast.show({ message: copy.shelf.archiveFailed, tone: 'danger' });
        return false;
      }
    },
    [toast],
  );
}
