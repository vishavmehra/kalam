/**
 * Collaboration state on this device (docs/14 §24 `collaborators`, `syncOperations`): which apps are
 * shared, the version and values each entry last had in the cloud, open conflicts, teams and the
 * "access ended" notices. AsyncStorage works on web (localStorage) and on Android and iOS. Rows are
 * validated on the way out; a damaged row reads as "not shared", which never deletes anything.
 *
 * ponytail: one JSON row per shared app. A shared app with thousands of long entries should move to a
 * table in the device database (schema change owned by storage) if localStorage's ~5 MB gets tight.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  endedNoticeSchema, localSpaceSchema, localTeamSchema, type CollabStateStore, type EndedNotice, type LocalSpace, type LocalTeam,
} from '@/core/collab';

const INDEX = 'kalam.collab.spaces.v1';
const TEAMS = 'kalam.collab.teams.v1';
const NOTICES = 'kalam.collab.notices.v1';
const spaceKey = (localAppId: string) => `kalam.collab.space.v1.${localAppId}`;

async function read(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
const write = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));
const ids = async (): Promise<string[]> => {
  const v = await read(INDEX);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};
function valid<T>(rows: unknown, schema: { safeParse(v: unknown): { success: boolean; data?: T } }): T[] {
  return (Array.isArray(rows) ? rows : []).flatMap((r) => {
    const p = schema.safeParse(r);
    return p.success && p.data ? [p.data] : [];
  });
}

export function createAsyncStorageCollabStore(): CollabStateStore {
  // Writes go one at a time so the index and rows never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const get = async (localAppId: string): Promise<LocalSpace | undefined> => {
    const p = localSpaceSchema.safeParse(await read(spaceKey(localAppId)));
    return p.success ? p.data : undefined;
  };
  return {
    async list() {
      const out: LocalSpace[] = [];
      for (const id of await ids()) {
        const s = await get(id);
        if (s) out.push(s);
      }
      return out;
    },
    get,
    put: (space) => serial(async () => {
      const row = localSpaceSchema.parse(space);
      await write(spaceKey(row.localAppId), row);
      const all = await ids();
      if (!all.includes(row.localAppId)) await write(INDEX, [...all, row.localAppId]);
    }),
    remove: (localAppId) => serial(async () => {
      await AsyncStorage.removeItem(spaceKey(localAppId));
      await write(INDEX, (await ids()).filter((x) => x !== localAppId));
    }),
    teams: async () => valid<LocalTeam>(await read(TEAMS), localTeamSchema),
    putTeam: (team) => serial(async () => {
      const row = localTeamSchema.parse(team);
      const rest = valid<LocalTeam>(await read(TEAMS), localTeamSchema).filter((t) => t.teamId !== row.teamId);
      await write(TEAMS, [...rest, row]);
    }),
    removeTeam: (teamId) => serial(async () => {
      await write(TEAMS, valid<LocalTeam>(await read(TEAMS), localTeamSchema).filter((t) => t.teamId !== teamId));
    }),
    notices: async () => valid<EndedNotice>(await read(NOTICES), endedNoticeSchema),
    addNotice: (n) => serial(async () => {
      await write(NOTICES, [...valid<EndedNotice>(await read(NOTICES), endedNoticeSchema), endedNoticeSchema.parse(n)].slice(-10));
    }),
    clearNotices: () => serial(() => AsyncStorage.removeItem(NOTICES)),
  };
}
