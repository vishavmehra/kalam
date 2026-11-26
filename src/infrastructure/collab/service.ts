/**
 * The one collaboration engine for the whole app, over this device's database, Firestore (database
 * `kalam`) and Firebase Auth, plus the scheduler that keeps shared apps in sync.
 *
 * Local first: with no shared app on the device the scheduler only reads local state and never
 * touches Firebase. Sync runs when Kalam starts, when the connection comes back, when the app returns
 * to the foreground, a couple of seconds after an entry changes, and once a minute while open.
 */
import { AppState } from 'react-native';
import { createCollabEngine, type CollabEngine } from '@/core/collab';
import { generateId } from '@/core/pipeline/create-application';
import { getKalamFirestore } from '@/infrastructure/firebase/firestore';
import { secureRandomBytes } from '@/infrastructure/storage/database';
import { getServices } from '@/services';
import { createFirestoreRemote } from './firestore-remote';
import { callCollabJoin } from './functions';
import { createAsyncStorageCollabStore } from './state-store';

let engine: CollabEngine | undefined;

const suffix = () => Array.from(secureRandomBytes(6), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

export function getCollabService(): CollabEngine {
  if (engine) return engine;
  const services = getServices();
  const auth = services.auth;
  engine = createCollabEngine({
    remote: createFirestoreRemote({ firestore: getKalamFirestore, uid: () => auth.current()?.uid, join: callCollabJoin, randomSuffix: suffix }),
    store: createAsyncStorageCollabStore(),
    apps: services.db.apps,
    // The device repository itself: entries written by sync must not look like new local edits.
    records: services.db.records,
    online: () => services.network.online(),
    user: () => {
      const u = auth.current();
      // The public name only, never the email (docs/12 §13.4).
      return u ? { uid: u.uid, name: (u.displayName ?? '').replace(/[<>]/g, '').trim().slice(0, 40), isAnonymous: u.isAnonymous } : null;
    },
    randomBytes: secureRandomBytes,
    newAppId: () => generateId('app'),
  });
  return engine;
}

const EDIT_DELAY_MS = 2_000;
// ponytail: polling once a minute; Firestore snapshot listeners would make changes appear live.
const POLL_MS = 60_000;

/** Starts background sync. Returns stop. Mount once at the app root. */
export function startCollabSync(): () => void {
  const collab = getCollabService();
  const services = getServices();
  const watching = new Map<string, () => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  let running: Promise<void> | undefined;

  const later = (appId: string) => {
    clearTimeout(timers.get(appId));
    timers.set(appId, setTimeout(() => {
      timers.delete(appId);
      if (!stopped) void collab.sync(appId);
    }, EDIT_DELAY_MS));
  };

  /** Listens for entry changes in each shared app; changes written by sync itself are ignored. */
  async function rewire(): Promise<number> {
    const spaces = await collab.spaces();
    const ids = new Set(spaces.map((s) => s.localAppId));
    for (const [id, off] of watching) {
      if (!ids.has(id)) {
        off();
        watching.delete(id);
      }
    }
    for (const id of ids) {
      if (watching.has(id)) continue;
      watching.set(id, services.db.records.subscribe(id, () => {
        if (collab.status(id).phase !== 'syncing') later(id);
      }));
    }
    return ids.size;
  }

  const syncAll = () => {
    if (stopped || running) return running;
    running = (async () => {
      try {
        if (!(await rewire())) return;
        if (!services.network.online()) {
          for (const s of await collab.spaces()) await collab.refresh(s.localAppId);
          return;
        }
        await services.auth.ready();
        await collab.syncAll();
        await rewire();
      } catch {
        // Sync problems show on each app's badge; the scheduler keeps going.
      } finally {
        running = undefined;
      }
    })();
    return running;
  };

  void collab.load().then(() => syncAll(), () => undefined);
  const offNetwork = services.network.subscribe((online) => {
    if (online) void syncAll();
  });
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncAll();
  });
  const offEngine = collab.subscribe(() => void rewire());
  const poll = setInterval(() => {
    if (AppState.currentState !== 'background') void syncAll();
  }, POLL_MS);

  return () => {
    stopped = true;
    clearInterval(poll);
    offNetwork();
    offEngine();
    appState.remove();
    for (const t of timers.values()) clearTimeout(t);
    for (const off of watching.values()) off();
    watching.clear();
  };
}

/** Viewer copies refuse writes with a plain message. Wrap the runtime's record repository with this. */
export const collabGuardedRecords = (() => {
  let last: { base: Parameters<CollabEngine['guard']>[0]; repo: ReturnType<CollabEngine['guard']> } | undefined;
  return (base: Parameters<CollabEngine['guard']>[0]) => {
    if (last?.base !== base) last = { base, repo: getCollabService().guard(base) };
    return last.repo;
  };
})();
