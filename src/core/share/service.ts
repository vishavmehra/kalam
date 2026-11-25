/**
 * App-to-app sharing service (docs/14 §16). Apps stay walled off from each other (docs/09 §10.1). The
 * only way one app sees or fills another's lists is a link the person made, and every use is gated here:
 *
 *   link exists and is on  ->  kind of access matches (`read` shows, `write` sends)  ->  the person
 *   confirmed (sends)  ->  both apps still fit the link (fields and types)  ->  only mapped fields cross.
 *
 * Nothing here talks to a network. Nothing logs an entry's values: `log` only ever gets ids, counts and codes.
 */
import type { KalamRecord, RecordRepository, StoredApp } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import {
  checkLink, collectionLabel, collectionOf, fieldLabel, fieldOf, isFromBazaar, unmappedRequired, type LinkHealth, type LinkProblem,
} from './contract';
import { describeLink, humanize, SHARE_COPY } from './copy';
import {
  contractIdFor, isSharedRecordId, linkIdFrom, SHARED_ID_PREFIX, SHARE_CONTRACT_VERSION, SHARE_LIMITS,
  type ShareAccess, type ShareAuditEntry, type ShareField, type ShareLink,
} from './model';
import { entryTitle, projectValues } from './project';
import type { ShareLinkStore } from './store';

/** What may be written to a log: where, how many, which code. Never a value from an entry. */
export interface ShareLogEvent {
  event: 'link_created' | 'create_refused' | 'link_revoked' | 'link_removed' | 'read' | 'read_refused' | 'link_paused' | 'send' | 'send_refused';
  linkId?: string;
  appId?: string;
  count?: number;
  code?: string;
}

export interface ShareDeps {
  store: ShareLinkStore;
  apps: { get(id: string): Promise<StoredApp | undefined> };
  /** The ordinary, app-walled records. The service is the only code that reaches across apps with it. */
  records: Pick<RecordRepository, 'list' | 'insert' | 'update' | 'subscribe'>;
  /** A random string (at least 8 letters or digits) for new link ids. */
  newId: () => string;
  now?: () => number;
  log?: (event: ShareLogEvent) => void;
}

// ─── Creating links ───────────────────────────────────────────────────────────
export interface CreateLinkInput {
  sourceAppId: string;
  sourceCollection: string;
  destinationAppId: string;
  destinationCollection: string;
  access: ShareAccess;
  /** Source field to destination field. The type is taken from the source design, never from the caller. */
  fields: ReadonlyArray<{ source: string; target: string }>;
  /** True only after the person has seen what the link allows and agreed. */
  confirmed: boolean;
  /** The destination came from the Bazaar and the person said they trust it with this information. */
  acknowledgeBazaar?: boolean;
}
export type CreateRefusal =
  | 'not_confirmed' | 'same_app' | 'app_missing' | 'list_missing' | 'no_fields' | 'bad_fields' | 'too_many_links'
  | 'duplicate' | 'needs_bazaar_ack' | 'required_unmapped' | 'not_stored';
export type CreateResult =
  | { ok: true; link: ShareLink; message: string }
  | { ok: false; reason: CreateRefusal; message: string; problems?: LinkProblem[] };

// ─── Looking at links ─────────────────────────────────────────────────────────
export interface LinkView {
  link: ShareLink;
  /** Which side the asked-about app is on. */
  role: 'source' | 'destination';
  sourceName: string;
  destinationName: string;
  sourceList: string;
  destinationList: string;
  /** Source field labels, in link order. */
  fieldLabels: string[];
  health: LinkHealth;
  sourceFromBazaar: boolean;
  destinationFromBazaar: boolean;
  /** What the link allows, in sentences. */
  lines: string[];
}

// ─── Using links ──────────────────────────────────────────────────────────────
export interface SharedRead {
  ok: boolean;
  /** Entries as the destination app sees them: only mapped fields, read only, ids start with `shared:`. */
  rows: KalamRecord[];
  /** Links that could not be used right now, each with its plain reasons. */
  paused: Array<{ linkId: string; problems: LinkProblem[] }>;
  reason?: 'no_link';
  message?: string;
}

export type SendRefusal = 'not_confirmed' | 'no_link' | 'revoked' | 'read_only' | 'broken' | 'nothing_selected' | 'too_many';
export interface SendInput {
  recordIds: readonly string[];
  /** True only after the person confirmed this send. */
  confirmed: boolean;
  /** Also change entries that were sent before. Needs `confirmed` as well. */
  updateExisting?: boolean;
}
export interface SendOutcome {
  ok: boolean;
  reason?: SendRefusal;
  created: number;
  updated: number;
  skipped: Array<{ recordId: string; reason: 'not_found' | 'already_sent' }>;
  failed: Array<{ recordId: string; reason: 'invalid' | 'full' | 'error' }>;
  message: string;
  problems?: LinkProblem[];
}
export interface Sendable {
  id: string;
  title: string;
  /** Sent before and still in the destination. */
  alreadySent: boolean;
}
export type SendableResult =
  | { ok: true; items: Sendable[]; total: number }
  | { ok: false; reason: SendRefusal; message: string; problems?: LinkProblem[] };

export class SharedRecordReadOnlyError extends Error {
  readonly code = 'shared_record_read_only';
  constructor() {
    super(SHARE_COPY.readOnlyEntry);
    this.name = 'SharedRecordReadOnlyError';
  }
}

export interface ShareService {
  create(input: CreateLinkInput): Promise<CreateResult>;
  /** Links that involve `appId` on either side, with what each one allows and whether it still fits. */
  list(appId: string): Promise<LinkView[]>;
  /** Turns a link off at once. Safe to repeat. */
  revoke(linkId: string): Promise<{ ok: boolean; message: string }>;
  /** Deletes a link and its history. */
  forget(linkId: string): Promise<boolean>;
  /** Deletes every link of an app (the app was deleted). */
  removeForApp(appId: string): Promise<number>;
  /** Entries another app shares into `readerAppId`'s list `collectionId`. Empty when there is no link. */
  readShared(readerAppId: string, collectionId: string): Promise<SharedRead>;
  /** The gate: reading `sourceCollection` of another app. Refused unless a link says yes. */
  readFrom(readerAppId: string, sourceAppId: string, sourceCollection: string): Promise<SharedRead>;
  /** Entries a `write` link could send, newest first, with a short title each. */
  sendable(linkId: string): Promise<SendableResult>;
  send(linkId: string, input: SendInput): Promise<SendOutcome>;
  /** The ordinary records plus shared entries, read only. Hand this to the runtime of the destination app. */
  sharedRecords(base: RecordRepository): RecordRepository;
}

const isReadInto = (appId: string) => (l: ShareLink) => l.status === 'active' && l.access === 'read' && l.destinationAppId === appId;
const appends = (audit: readonly ShareAuditEntry[], entry: ShareAuditEntry): ShareAuditEntry[] =>
  [...audit, entry].slice(-SHARE_LIMITS.auditPerLink);

function failureOf(error: unknown): 'invalid' | 'full' | 'error' {
  const name = error instanceof Error ? error.name : '';
  if (name === 'RecordValidationError') return 'invalid';
  if (name === 'RecordLimitError') return 'full';
  return 'error';
}

export function createShareService(deps: ShareDeps): ShareService {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const log = (e: ShareLogEvent) => {
    try {
      deps.log?.(e);
    } catch {
      // A broken logger must never stop a share.
    }
  };

  /** Loads each app once per call. */
  const specLoader = () => {
    const cache = new Map<string, Promise<StoredApp | undefined>>();
    return (id: string): Promise<KalamSpec | undefined> => {
      if (!cache.has(id)) cache.set(id, deps.apps.get(id).catch(() => undefined));
      return cache.get(id)!.then((a) => a?.spec);
    };
  };

  async function readThrough(links: readonly ShareLink[], readerAppId: string): Promise<SharedRead> {
    const spec = specLoader();
    const rows: KalamRecord[] = [];
    const paused: SharedRead['paused'] = [];
    for (const link of links) {
      const health = checkLink(link, await spec(link.sourceAppId), await spec(link.destinationAppId));
      if (!health.ok) {
        paused.push({ linkId: link.id, problems: health.problems });
        log({ event: 'link_paused', linkId: link.id, appId: readerAppId, code: health.problems[0]?.code });
        continue;
      }
      for (const r of await deps.records.list(link.sourceAppId, link.sourceCollection)) {
        rows.push({
          id: `${SHARED_ID_PREFIX}${link.id}:${r.id}`,
          appId: readerAppId,
          collectionId: link.destinationCollection,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          values: projectValues(link, r.values),
        });
      }
    }
    log({ event: 'read', appId: readerAppId, count: rows.length });
    return { ok: true, rows, paused };
  }

  /** The first three gates: the link exists, is on, and is the kind that sends. */
  async function sendGate(linkId: string): Promise<{ ok: true; link: ShareLink } | { ok: false; reason: SendRefusal; message: string }> {
    const link = await store.get(linkId);
    if (!link) return { ok: false, reason: 'no_link', message: SHARE_COPY.send.no_link };
    if (link.status !== 'active') return { ok: false, reason: 'revoked', message: SHARE_COPY.send.revoked };
    if (link.access !== 'write') return { ok: false, reason: 'read_only', message: SHARE_COPY.send.read_only };
    return { ok: true, link };
  }

  async function healthy(link: ShareLink) {
    const spec = specLoader();
    const [source, destination] = [await spec(link.sourceAppId), await spec(link.destinationAppId)];
    const health = checkLink(link, source, destination);
    return { health, source, destination };
  }

  const service: ShareService = {
    async create(input) {
      const refuse = (reason: CreateRefusal, message: string, problems?: LinkProblem[]): CreateResult => {
        log({ event: 'create_refused', code: reason });
        return { ok: false, reason, message, ...(problems ? { problems } : {}) };
      };
      if (!input.confirmed) return refuse('not_confirmed', SHARE_COPY.create.not_confirmed);
      if (input.sourceAppId === input.destinationAppId) return refuse('same_app', SHARE_COPY.create.same_app);
      if (!input.fields.length) return refuse('no_fields', SHARE_COPY.create.no_fields);
      const spec = specLoader();
      const [source, destination] = [await spec(input.sourceAppId), await spec(input.destinationAppId)];
      if (!source || !destination) return refuse('app_missing', SHARE_COPY.create.app_missing);
      const from = collectionOf(source, input.sourceCollection);
      const to = collectionOf(destination, input.destinationCollection);
      if (!from || !to) return refuse('list_missing', SHARE_COPY.create.list_missing);

      // The agreed type is whatever the source design says now.
      const fields: ShareField[] = [];
      const missing: LinkProblem[] = [];
      for (const f of input.fields) {
        const sf = fieldOf(from, f.source);
        if (!sf) {
          missing.push({
            code: 'source_field_missing', field: f.source,
            message: SHARE_COPY.problem.source_field_missing({ source: source.name, destination: destination.name, field: humanize(f.source) }),
          });
        } else fields.push({ source: f.source, target: f.target, type: sf.type, label: sf.label });
      }
      if (missing.length) return refuse('bad_fields', SHARE_COPY.create.bad_fields, missing);
      // A field may be shared once, and a target may be filled once.
      if (new Set(fields.map((f) => f.source)).size < fields.length || new Set(fields.map((f) => f.target)).size < fields.length) {
        return refuse('bad_fields', SHARE_COPY.create.bad_fields);
      }

      const t = now();
      const id = linkIdFrom(deps.newId());
      if (!id) return refuse('not_stored', SHARE_COPY.create.not_stored);
      const link: ShareLink = {
        id,
        contractId: contractIdFor(input.sourceCollection, input.destinationCollection),
        contractVersion: SHARE_CONTRACT_VERSION,
        sourceAppId: input.sourceAppId,
        sourceCollection: input.sourceCollection,
        destinationAppId: input.destinationAppId,
        destinationCollection: input.destinationCollection,
        fields,
        access: input.access,
        status: 'active',
        createdAt: t,
        audit: [{ at: t, kind: 'created' }],
      };
      const health = checkLink(link, source, destination);
      if (!health.ok) return refuse('bad_fields', SHARE_COPY.create.bad_fields, health.problems);

      if (isFromBazaar(destination) && !input.acknowledgeBazaar) {
        return refuse('needs_bazaar_ack', SHARE_COPY.create.needs_bazaar_ack(destination.name));
      }
      if (input.access === 'write') {
        const [first] = unmappedRequired(to, fields.map((f) => f.target));
        if (first) return refuse('required_unmapped', SHARE_COPY.create.required_unmapped(destination.name, first));
      }
      const existing = [...(await store.forApp(input.sourceAppId)), ...(await store.forApp(input.destinationAppId))];
      const same = (l: ShareLink) =>
        l.status === 'active' && l.access === input.access && l.sourceAppId === input.sourceAppId && l.sourceCollection === input.sourceCollection &&
        l.destinationAppId === input.destinationAppId && l.destinationCollection === input.destinationCollection;
      if (existing.some(same)) return refuse('duplicate', SHARE_COPY.create.duplicate);
      for (const appId of [input.sourceAppId, input.destinationAppId]) {
        if ((await store.forApp(appId)).length >= SHARE_LIMITS.linksPerApp) return refuse('too_many_links', SHARE_COPY.create.too_many_links);
      }
      try {
        await store.put(link);
      } catch {
        return refuse('not_stored', SHARE_COPY.create.not_stored);
      }
      log({ event: 'link_created', linkId: link.id, code: link.access });
      return { ok: true, link, message: SHARE_COPY.create.done };
    },

    async list(appId) {
      const spec = specLoader();
      const out: LinkView[] = [];
      for (const link of await store.forApp(appId)) {
        const [source, destination] = [await spec(link.sourceAppId), await spec(link.destinationAppId)];
        const sourceName = source?.name ?? 'An app that was removed';
        const destinationName = destination?.name ?? 'An app that was removed';
        const from = source && collectionOf(source, link.sourceCollection);
        const sourceList = source ? collectionLabel(source, link.sourceCollection) : humanize(link.sourceCollection);
        const destinationList = destination ? collectionLabel(destination, link.destinationCollection) : humanize(link.destinationCollection);
        const fieldLabels = link.fields.map((f) => f.label ?? fieldLabel(from, f.source));
        out.push({
          link,
          role: link.sourceAppId === appId ? 'source' : 'destination',
          sourceName, destinationName, sourceList, destinationList, fieldLabels,
          health: checkLink(link, source, destination),
          sourceFromBazaar: isFromBazaar(source),
          destinationFromBazaar: isFromBazaar(destination),
          lines: describeLink({ access: link.access, source: sourceName, destination: destinationName, sourceList, destinationList, fields: fieldLabels }),
        });
      }
      return out;
    },

    async revoke(linkId) {
      const link = await store.get(linkId);
      if (!link) return { ok: false, message: SHARE_COPY.revoke.missing };
      if (link.status === 'revoked') return { ok: true, message: SHARE_COPY.revoke.done };
      const t = now();
      await store.put({ ...link, status: 'revoked', revokedAt: t, audit: appends(link.audit, { at: t, kind: 'revoked' }) });
      log({ event: 'link_revoked', linkId });
      return { ok: true, message: SHARE_COPY.revoke.done };
    },

    async forget(linkId) {
      const link = await store.get(linkId);
      if (!link) return false;
      await store.remove(linkId);
      log({ event: 'link_removed', linkId });
      return true;
    },

    async removeForApp(appId) {
      const n = await store.removeForApp(appId);
      if (n) log({ event: 'link_removed', appId, count: n });
      return n;
    },

    async readShared(readerAppId, collectionId) {
      const links = (await store.forApp(readerAppId)).filter((l) => isReadInto(readerAppId)(l) && l.destinationCollection === collectionId);
      return links.length ? readThrough(links, readerAppId) : { ok: true, rows: [], paused: [] };
    },

    async readFrom(readerAppId, sourceAppId, sourceCollection) {
      const links = (await store.forApp(readerAppId)).filter(
        (l) => isReadInto(readerAppId)(l) && l.sourceAppId === sourceAppId && l.sourceCollection === sourceCollection,
      );
      if (!links.length) {
        log({ event: 'read_refused', appId: readerAppId, code: 'no_link' });
        return { ok: false, rows: [], paused: [], reason: 'no_link', message: SHARE_COPY.send.no_link };
      }
      return readThrough(links, readerAppId);
    },

    async sendable(linkId) {
      const gate = await sendGate(linkId);
      if (!gate.ok) return gate;
      const { health } = await healthy(gate.link);
      if (!health.ok) return { ok: false, reason: 'broken', message: SHARE_COPY.send.broken, problems: health.problems };
      const { link } = gate;
      const sourceRows = (await deps.records.list(link.sourceAppId, link.sourceCollection)).sort((a, b) => b.createdAt - a.createdAt);
      const destIds = new Set((await deps.records.list(link.destinationAppId, link.destinationCollection)).map((r) => r.id));
      const ledger = new Map(link.sent ?? []);
      return {
        ok: true,
        total: sourceRows.length,
        items: sourceRows.slice(0, 200).map((r) => ({
          id: r.id,
          title: entryTitle(link, r.values),
          alreadySent: destIds.has(ledger.get(r.id) ?? ''),
        })),
      };
    },

    async send(linkId, input) {
      const empty = { created: 0, updated: 0, skipped: [], failed: [] };
      const stop = (reason: SendRefusal, message: string, problems?: LinkProblem[]): SendOutcome => {
        log({ event: 'send_refused', linkId, code: reason });
        return { ok: false, reason, message, ...empty, ...(problems ? { problems } : {}) };
      };
      const gate = await sendGate(linkId);
      if (!gate.ok) return stop(gate.reason, gate.message);
      const { link } = gate;
      if (!input.confirmed) return stop('not_confirmed', SHARE_COPY.send.not_confirmed);
      const { health, destination } = await healthy(link);
      if (!health.ok) {
        const t = now();
        await store.put({ ...link, audit: appends(link.audit, { at: t, kind: 'blocked', reason: health.problems[0]?.code.slice(0, 40) }) }).catch(() => undefined);
        return stop('broken', SHARE_COPY.send.broken, health.problems);
      }
      const ids = [...new Set(input.recordIds)];
      if (!ids.length) return stop('nothing_selected', SHARE_COPY.send.nothing_selected);
      if (ids.length > SHARE_LIMITS.sendBatch) return stop('too_many', SHARE_COPY.send.too_many);

      // Entries are looked up in the linked list only, so an id from anywhere else finds nothing.
      const sourceRows = new Map((await deps.records.list(link.sourceAppId, link.sourceCollection)).map((r) => [r.id, r]));
      const destIds = new Set((await deps.records.list(link.destinationAppId, link.destinationCollection)).map((r) => r.id));
      const ledger = new Map(link.sent ?? []);
      const out: SendOutcome = { ok: true, ...empty, skipped: [], failed: [], message: '' };
      for (const id of ids) {
        const row = sourceRows.get(id);
        if (!row) {
          out.skipped.push({ recordId: id, reason: 'not_found' });
          continue;
        }
        const values = projectValues(link, row.values);
        const copy = ledger.get(id);
        try {
          if (copy && destIds.has(copy)) {
            if (!input.updateExisting) {
              out.skipped.push({ recordId: id, reason: 'already_sent' });
              continue;
            }
            await deps.records.update(link.destinationAppId, link.destinationCollection, copy, values);
            out.updated++;
          } else {
            const made = await deps.records.insert(link.destinationAppId, link.destinationCollection, values);
            ledger.delete(id);
            ledger.set(id, made.id);
            out.created++;
          }
        } catch (error) {
          out.failed.push({ recordId: id, reason: failureOf(error) });
        }
      }
      const name = destination?.name ?? 'the other app';
      const parts = [SHARE_COPY.send.sent(out.created, out.updated, name)];
      if (out.skipped.length) parts.push(SHARE_COPY.send.skipped(out.skipped.length));
      if (out.failed.length) parts.push(SHARE_COPY.send.failed(out.failed.length, name));
      out.message = parts.join(' ');
      out.ok = out.failed.length === 0;
      const t = now();
      await store
        .put({
          ...link,
          sent: [...ledger].slice(-SHARE_LIMITS.sentLedger),
          audit: appends(link.audit, {
            at: t, kind: 'sent', count: out.created, updated: out.updated, ...(out.failed.length ? { reason: 'some_rejected' } : {}),
          }),
        })
        .catch(() => log({ event: 'send', linkId, code: 'audit_not_saved' }));
      log({ event: 'send', linkId, count: out.created + out.updated });
      return out;
    },

    sharedRecords(base) {
      const intoApp = async (appId: string) => (await store.forApp(appId)).filter(isReadInto(appId));
      return {
        async list(appId, collectionId) {
          const own = await base.list(appId, collectionId);
          const shared = await service.readShared(appId, collectionId);
          return shared.rows.length ? [...own, ...shared.rows] : own;
        },
        async listAll(appId) {
          const all = { ...(await base.listAll(appId)) };
          const byCollection = new Map<string, ShareLink[]>();
          for (const l of await intoApp(appId)) byCollection.set(l.destinationCollection, [...(byCollection.get(l.destinationCollection) ?? []), l]);
          for (const [collectionId, links] of byCollection) {
            const shared = await readThrough(links, appId);
            if (shared.rows.length) all[collectionId] = [...(all[collectionId] ?? []), ...shared.rows];
          }
          return all;
        },
        insert: (appId, collectionId, values) => base.insert(appId, collectionId, values),
        async update(appId, collectionId, id, values) {
          if (isSharedRecordId(id)) throw new SharedRecordReadOnlyError();
          return base.update(appId, collectionId, id, values);
        },
        async remove(appId, collectionId, id) {
          if (isSharedRecordId(id)) throw new SharedRecordReadOnlyError();
          return base.remove(appId, collectionId, id);
        },
        subscribe(appId, listener) {
          let disposed = false;
          const offOwn = base.subscribe(appId, listener);
          const sources = new Map<string, () => void>();
          const sync = async () => {
            const want = new Set((await intoApp(appId)).map((l) => l.sourceAppId));
            if (disposed) return;
            for (const [id, off] of sources) {
              if (want.has(id)) continue;
              off();
              sources.delete(id);
            }
            for (const id of want) if (!sources.has(id)) sources.set(id, deps.records.subscribe(id, listener));
          };
          const offLinks = store.subscribe(() => {
            void sync().then(() => { if (!disposed) listener(); }).catch(() => undefined);
          });
          void sync().catch(() => undefined);
          return () => {
            disposed = true;
            offOwn();
            offLinks();
            for (const off of sources.values()) off();
            sources.clear();
          };
        },
      };
    },
  };
  return service;
}
