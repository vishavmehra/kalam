/**
 * `AccountRemote` over Cloud Firestore, named database `kalam`. Decisions live in `@/core/account-sync`;
 * this file only moves documents, and parses everything it reads back. firestore.rules allow each
 * path only to its signed-in, non-guest owner and check every field and size.
 *
 *   users/{uid}/apps/{appId}                 app design + tombstone
 *   users/{uid}/account/records              pointer to the newest complete records backup
 *   users/{uid}/backups/records_{set}_{n}    encrypted records backup, one chunk per document (B1's area)
 */
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, where,
  type DocumentData, type Firestore, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { ACCOUNT_LIMITS, recordsPointerSchema, remoteAppSchema, type AccountRemote, type RemoteApp } from '@/core/account-sync';

const millis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);

/** A write made offline waits for the connection; give up after a while so the next pass can retry it. */
const WRITE_TIMEOUT_MS = 30_000;
function timed<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Timed out'), { code: 'unavailable' })), WRITE_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const partId = (set: string, part: number) => `records_${set}_${part}`;

export function createAccountRemote(firestore: () => Firestore | undefined): AccountRemote {
  const db = (): Firestore => {
    const f = firestore();
    if (!f) throw Object.assign(new Error('Firebase is not configured'), { code: 'not_set_up' });
    return f;
  };
  const appDoc = (uid: string, id: string) => doc(db(), 'users', uid, 'apps', id);
  const pointerDoc = (uid: string) => doc(db(), 'users', uid, 'account', 'records');
  const part = (uid: string, set: string, n: number) => doc(db(), 'users', uid, 'backups', partId(set, n));

  return {
    async pullApps(uid, since) {
      const out: RemoteApp[] = [];
      let after: QueryDocumentSnapshot | undefined;
      for (;;) {
        const snap = await getDocs(query(
          collection(db(), 'users', uid, 'apps'),
          where('syncedAt', '>=', Timestamp.fromMillis(since)),
          orderBy('syncedAt'),
          ...(after ? [startAfter(after)] : []),
          limit(ACCOUNT_LIMITS.pageSize),
        ));
        for (const d of snap.docs) {
          const x = d.data();
          const parsed = remoteAppSchema.safeParse({ ...x, id: d.id, syncedAt: millis(x.syncedAt) });
          if (parsed.success) out.push(parsed.data); // malformed documents are skipped, never applied
        }
        if (snap.docs.length < ACCOUNT_LIMITS.pageSize) return out;
        after = snap.docs.at(-1);
      }
    },
    putApp: (uid, id, d) => timed(setDoc(appDoc(uid, id), { ...d, syncedAt: serverTimestamp() })),
    deleteApp: (uid, id) => timed(deleteDoc(appDoc(uid, id))),

    async getRecordsPointer(uid) {
      const snap = await getDoc(pointerDoc(uid));
      if (!snap.exists()) return null;
      const x: DocumentData = snap.data();
      const parsed = recordsPointerSchema.safeParse({ ...x, updatedAt: millis(x.updatedAt) });
      return parsed.success ? parsed.data : null;
    },
    putRecordsPointer: (uid, p) => timed(setDoc(pointerDoc(uid), { ...p, updatedAt: serverTimestamp() })),
    deleteRecordsPointer: (uid) => timed(deleteDoc(pointerDoc(uid))),

    putRecordsPart: (uid, set, n, parts, text) =>
      timed(setDoc(part(uid, set, n), {
        format: 'kalam-encrypted-backup', formatVersion: 1, ciphertext: text,
        manifest: { kind: 'account-records', set, part: n, parts }, updatedAt: serverTimestamp(),
      })),
    async getRecordsPart(uid, set, n) {
      const snap = await getDoc(part(uid, set, n));
      const x = snap.data();
      const ok = !!x && typeof x.ciphertext === 'string' && x.manifest?.set === set && x.manifest?.part === n;
      return ok ? (x.ciphertext as string) : null;
    },
    deleteRecordsPart: (uid, set, n) => timed(deleteDoc(part(uid, set, n))),
  };
}
