/**
 * Which way each app moves between this device and the account. Pure and deterministic.
 *
 * A change is a design that differs from what both sides last agreed (hashes, not clocks), so a
 * device with a wrong clock never invents changes. Clocks (`updatedAt`) only pick the winner when
 * both sides changed the same app: last writer wins, and the losing design is kept in the Time
 * Machine by the engine. Deletes travel as tombstones.
 */
import type { AppSyncState, RemoteApp } from './model';

export interface LocalApp {
  id: string;
  /** designHash of the current design. */
  hash: string;
  updatedAt: number;
}

export type SyncAction =
  /** Send this device's design to the account. */
  | { kind: 'upload'; appId: string }
  /** Put the account's design on this device (new app, or a new version of an existing one). */
  | { kind: 'download'; appId: string; remote: RemoteApp }
  /** Both sides changed: the engine compares designs, then last writer wins. */
  | { kind: 'conflict'; appId: string; remote: RemoteApp }
  /** Deleted on this device: tell the account. */
  | { kind: 'tombstone'; appId: string }
  /** Deleted in the account (on another device): remove it here. */
  | { kind: 'remove_local'; appId: string; remote: RemoteApp }
  /** Only remember what the account says (a tombstone for an app this device never had). */
  | { kind: 'note'; appId: string; remote: RemoteApp };

export interface PlanInput {
  local: readonly LocalApp[];
  /** Account documents changed since the last pull. Apps not listed are unchanged since `state`. */
  pulled: readonly RemoteApp[];
  state: Readonly<Record<string, AppSyncState>>;
  /** Apps that live elsewhere (shared through Collaborative Apps). Never touched. */
  excluded?: ReadonlySet<string>;
}

export function planSync({ local, pulled, state, excluded }: PlanInput): SyncAction[] {
  const locals = new Map(local.map((a) => [a.id, a]));
  const remotes = new Map(pulled.map((r) => [r.id, r]));
  const ids = [...new Set([...locals.keys(), ...remotes.keys(), ...Object.keys(state)])].sort();
  const out: SyncAction[] = [];
  for (const appId of ids) {
    if (excluded?.has(appId)) continue;
    const l = locals.get(appId);
    const r = remotes.get(appId);
    const s = Object.prototype.hasOwnProperty.call(state, appId) ? state[appId] : undefined;
    const localChanged = !!l && (!s || l.hash !== s.localHash);
    const remoteChanged = !!r && (!s || r.specHash !== s.remoteHash || r.deleted !== s.deleted);

    if (l) {
      if (!r || !remoteChanged) {
        if (localChanged) out.push({ kind: 'upload', appId });
      } else if (r.deleted) {
        // Deleted elsewhere. A newer edit here brings it back; otherwise the delete wins.
        out.push(localChanged && l.updatedAt > r.updatedAt ? { kind: 'upload', appId } : { kind: 'remove_local', appId, remote: r });
      } else {
        out.push(localChanged ? { kind: 'conflict', appId, remote: r } : { kind: 'download', appId, remote: r });
      }
      continue;
    }

    if (!r) {
      if (s && !s.deleted) out.push({ kind: 'tombstone', appId });
    } else if (r.deleted) {
      if (!s || !s.deleted) out.push({ kind: 'note', appId, remote: r });
    } else if (!s || s.deleted || remoteChanged) {
      // New in the account, brought back elsewhere, or edited elsewhere after this device deleted it.
      out.push({ kind: 'download', appId, remote: r });
    } else {
      out.push({ kind: 'tombstone', appId });
    }
  }
  return out;
}

/** Local changes still waiting for the account (the offline queue). */
export function pendingCount(local: readonly LocalApp[], state: Readonly<Record<string, AppSyncState>>, excluded?: ReadonlySet<string>): number {
  return planSync({ local, pulled: [], state, excluded }).filter((a) => a.kind === 'upload' || a.kind === 'tombstone').length;
}
