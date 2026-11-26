/**
 * The one "my apps in my account" engine for the whole app, over this device's database, Firestore
 * (database `kalam`) and Firebase Auth, plus the scheduler that keeps it in step.
 *
 * Local first: until the person answers the question on this device, the scheduler only reads local
 * state and never touches Firestore. Sync runs a few seconds after an app, record or value changes,
 * when Kalam starts, on sign-in, when the connection comes back, when Kalam returns to the
 * foreground, and once a minute while open. It never blocks using an app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { accountLocalSchema, createAccountSync, emptyLocal, type AccountSync, type AccountSyncStore } from '@/core/account-sync';
import { installedFrom, rememberInstalled } from '@/infrastructure/bazaar/cache';
import { getCollabService } from '@/infrastructure/collab/service';
import { getKalamFirestore } from '@/infrastructure/firebase/firestore';
import { getDatabase, secureRandomBytes } from '@/infrastructure/storage/database';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';
import { createAccountRemote } from './firestore-remote';

const storeKey = (uid: string) => `kalam.accountSync.v1.${uid}`;

/** Per-account state on this device (AsyncStorage: localStorage on web). A damaged row reads as empty, never as a delete. */
export function createAccountStore(): AccountSyncStore {
  return {
    async get(uid) {
      try {
        const raw = await AsyncStorage.getItem(storeKey(uid));
        const parsed = accountLocalSchema.safeParse(raw ? JSON.parse(raw) : undefined);
        return parsed.success ? parsed.data : emptyLocal();
      } catch {
        return emptyLocal();
      }
    },
    put: (uid, data) => AsyncStorage.setItem(storeKey(uid), JSON.stringify(data)),
  };
}

let engine: AccountSync | undefined;

export function getAccountSync(): AccountSync {
  if (engine) return engine;
  const services = getServices();
  const db = getDatabase(); // the same device database as services.db, with the backup store
  engine = createAccountSync({
    remote: createAccountRemote(getKalamFirestore),
    store: createAccountStore(),
    apps: db.apps,
    versions: db.versions,
    records: db.records,
    state: db.state,
    backup: db,
    online: () => services.network.online(),
    randomBytes: secureRandomBytes,
    // Shared apps already live in the cloud through Collaborative Apps; they are not copied again.
    excluded: async () => new Set((await getCollabService().spaces()).map((s) => s.localAppId)),
    bazaar: { get: installedFrom, set: rememberInstalled },
    onLocalAppsChanged: () => void useAppsStore.getState().refresh().catch(() => undefined),
  });
  return engine;
}

const CHANGE_DELAY_MS = 3_000;
// ponytail: polling once a minute; a Firestore snapshot listener on users/{uid}/apps would make other devices' changes appear live.
const POLL_MS = 60_000;

/** Starts background sync. Returns stop. Mount once at the app root (AccountSyncPrompt does it). */
export function startAccountSync(): () => void {
  const sync = getAccountSync();
  const services = getServices();
  const db = getDatabase();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watching = new Map<string, () => void>();

  const run = () => {
    if (!stopped) void sync.sync();
  };
  const later = (ms = CHANGE_DELAY_MS) => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  const changed = () => {
    void sync.noteLocalChange().catch(() => undefined);
    later();
  };

  /** Records and saved values of every app feed the encrypted records backup. */
  const rewire = (ids: readonly string[]) => {
    const keep = new Set(ids);
    for (const [id, off] of watching) {
      if (!keep.has(id)) {
        off();
        watching.delete(id);
      }
    }
    for (const id of keep) {
      if (watching.has(id)) continue;
      const offRecords = db.records.subscribe(id, changed);
      const offState = db.state.subscribe(id, changed);
      watching.set(id, () => {
        offRecords();
        offState();
      });
    }
  };

  const setUser = () => {
    const u = services.auth.current();
    return sync.setUser(u ? { uid: u.uid, isAnonymous: u.isAnonymous } : null).then(() => later(0), () => undefined);
  };
  void services.auth.ready().then(setUser, () => undefined);
  void db.apps.list().then((apps) => !stopped && rewire(apps.map((a) => a.id)), () => undefined);

  const offAuth = services.auth.subscribe(() => void setUser());
  const offNetwork = services.network.subscribe((online) => {
    if (online) later(0);
  });
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') later(0);
  });
  const offApps = useAppsStore.subscribe((s, prev) => {
    if (s.apps === prev.apps) return;
    rewire(s.apps.map((a) => a.id));
    changed();
  });
  const poll = setInterval(() => {
    if (AppState.currentState !== 'background') run();
  }, POLL_MS);

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(poll);
    offAuth();
    offNetwork();
    offApps();
    appState.remove();
    for (const off of watching.values()) off();
    watching.clear();
  };
}
