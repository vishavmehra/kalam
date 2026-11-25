import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateLinkInput } from './service';
import { SharedRecordReadOnlyError } from './service';
import { isSharedRecordId, SHARE_LIMITS } from './model';
import {
  APP_C, APP_O, APP_X, customers, fakeRecords, NAME_PHONE, orders, rig, SENTINEL, specWith, storedApp, type Rig,
} from './test-kit';

afterEach(() => vi.restoreAllMocks());

const readInput = (patch: Partial<CreateLinkInput> = {}): CreateLinkInput => ({
  sourceAppId: APP_C, sourceCollection: 'customers', destinationAppId: APP_O, destinationCollection: 'orders',
  access: 'read', fields: NAME_PHONE, confirmed: true, ...patch,
});
const writeInput = (patch: Partial<CreateLinkInput> = {}) => readInput({ access: 'write', ...patch });

async function made(r: Rig, input: CreateLinkInput) {
  const res = await r.service.create(input);
  if (!res.ok) throw new Error(`create refused: ${res.reason}`);
  return res.link;
}

describe('creating a link', () => {
  it('needs the person to confirm, and stores nothing otherwise', async () => {
    const r = rig();
    const res = await r.service.create(readInput({ confirmed: false }));
    expect(res).toMatchObject({ ok: false, reason: 'not_confirmed' });
    expect(await r.store.list()).toEqual([]);
  });

  it('stores plain data with the types taken from the source design', async () => {
    const r = rig();
    const link = await made(r, readInput({ fields: [...NAME_PHONE, { source: 'city', target: 'city' }] }));
    expect(link).toMatchObject({
      sourceAppId: APP_C, destinationAppId: APP_O, access: 'read', status: 'active', contractId: 'customers-orders-v1', contractVersion: 1,
    });
    expect(link.fields).toEqual([
      { source: 'name', target: 'customer_name', type: 'text', label: 'Name' },
      { source: 'phone', target: 'phone', type: 'text', label: 'Phone' },
      { source: 'city', target: 'city', type: 'enum', label: 'City' },
    ]);
    expect(link.audit).toEqual([{ at: link.createdAt, kind: 'created' }]);
    expect(await r.store.get(link.id)).toEqual(link);
  });

  it.each<[string, Partial<CreateLinkInput>, string]>([
    ['the same app twice', { destinationAppId: APP_C }, 'same_app'],
    ['no fields', { fields: [] }, 'no_fields'],
    ['an app that is not there', { destinationAppId: 'app_gone' }, 'app_missing'],
    ['a list that is not there', { sourceCollection: 'ghosts' }, 'list_missing'],
    ['a source field that is not there', { fields: [{ source: 'ghost', target: 'phone' }] }, 'bad_fields'],
    ['a target field that is not there', { fields: [{ source: 'name', target: 'ghost' }] }, 'bad_fields'],
    ['a type that does not fit', { fields: [{ source: 'credit', target: 'phone' }] }, 'bad_fields'],
    ['one target filled twice', { fields: [{ source: 'name', target: 'phone' }, { source: 'phone', target: 'phone' }] }, 'bad_fields'],
    ['one field shared twice', { fields: [{ source: 'name', target: 'phone' }, { source: 'name', target: 'customer_name' }] }, 'bad_fields'],
  ])('refuses %s', async (_n, patch, reason) => {
    const r = rig();
    const res = await r.service.create(readInput(patch));
    expect(res).toMatchObject({ ok: false, reason });
    expect(await r.store.list()).toEqual([]);
  });

  it('explains a field problem in plain words', async () => {
    const r = rig();
    const res = await r.service.create(readInput({ fields: [{ source: 'credit', target: 'phone' }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems?.[0].message).toContain('"Phone" in Order Book is now text and cannot hold a number');
  });

  it('a link that sends must fill every required field of the destination', async () => {
    const r = rig();
    const res = await r.service.create(writeInput({ fields: [{ source: 'phone', target: 'phone' }] }));
    expect(res).toMatchObject({ ok: false, reason: 'required_unmapped' });
    if (!res.ok) expect(res.message).toBe('Order Book needs "Customer name" on every entry. Share a field into it, or it will not accept the entries.');
    // Viewing does not insert anything, so it does not care.
    expect((await r.service.create(readInput({ fields: [{ source: 'phone', target: 'phone' }] }))).ok).toBe(true);
  });

  it('does not make the same link twice, but a view and a send may coexist', async () => {
    const r = rig();
    await made(r, readInput());
    expect(await r.service.create(readInput())).toMatchObject({ ok: false, reason: 'duplicate' });
    expect((await r.service.create(writeInput())).ok).toBe(true);
  });

  it('caps the links of one app', async () => {
    const r = rig();
    for (let i = 0; i < SHARE_LIMITS.linksPerApp; i++) {
      await r.store.put({
        id: `lnk_filler${String(i).padStart(4, '0')}`, contractId: 'filler-v1', contractVersion: 1, sourceAppId: APP_C, sourceCollection: 'customers',
        destinationAppId: `app_dest${i}`, destinationCollection: 'orders', fields: [{ source: 'name', target: 'x', type: 'text' }],
        access: 'read', status: 'active', createdAt: i, audit: [],
      });
    }
    expect(await r.service.create(readInput())).toMatchObject({ ok: false, reason: 'too_many_links' });
  });

  it('an app from the Bazaar gets no special trust: the person must say so before it is given data', async () => {
    const bazaar = storedApp(specWith('app_bazaar', 'Bazaar Orders', { orders }, { source: 'import', basedOn: 'bazaar:l0123456789abcdefghi' }));
    const r = rig([bazaar]);
    const input = readInput({ destinationAppId: 'app_bazaar' });
    expect(await r.service.create(input)).toMatchObject({ ok: false, reason: 'needs_bazaar_ack' });
    expect((await r.service.create({ ...input, acknowledgeBazaar: true })).ok).toBe(true);
    const [view] = await r.service.list('app_bazaar');
    expect(view.destinationFromBazaar).toBe(true);
    expect(view.sourceFromBazaar).toBe(false);
  });
});

describe('who may read what', () => {
  async function withData() {
    const r = rig();
    await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '111', secret_note: SENTINEL, credit: 5 });
    await r.records.add(APP_C, 'customers', { name: 'Ravi', phone: '222' });
    await r.records.add(APP_X, 'customers', { name: 'Not yours', phone: '999' });
    r.records.reads.length = 0;
    return r;
  }

  it('gives nothing without a link, and never even looks at the other app', async () => {
    const r = await withData();
    expect(await r.service.readShared(APP_O, 'orders')).toEqual({ ok: true, rows: [], paused: [] });
    expect(await r.service.readFrom(APP_O, APP_C, 'customers')).toMatchObject({ ok: false, reason: 'no_link', rows: [] });
    expect(r.records.reads).toEqual([]);
  });

  it('a link between two apps gives no access to a third', async () => {
    const r = await withData();
    await made(r, readInput());
    expect(await r.service.readFrom(APP_X, APP_C, 'customers')).toMatchObject({ ok: false, reason: 'no_link' });
    expect(await r.service.readFrom(APP_O, APP_X, 'customers')).toMatchObject({ ok: false, reason: 'no_link' });
    expect(await r.service.readFrom(APP_O, APP_C, 'secret_other_list')).toMatchObject({ ok: false, reason: 'no_link' });
    expect(r.records.reads).toEqual([]);
  });

  it('a link reads one way: the source cannot read the destination through it', async () => {
    const r = await withData();
    await made(r, readInput());
    expect(await r.service.readFrom(APP_C, APP_O, 'orders')).toMatchObject({ ok: false, reason: 'no_link' });
  });

  it('shows only the mapped fields, as read-only entries of the destination', async () => {
    const r = await withData();
    const link = await made(r, readInput());
    const got = await r.service.readShared(APP_O, 'orders');
    expect(got.ok).toBe(true);
    expect(got.rows.map((x) => x.values)).toEqual([
      { customer_name: 'Asha', phone: '111' },
      { customer_name: 'Ravi', phone: '222' },
    ]);
    expect(JSON.stringify(got.rows)).not.toContain(SENTINEL);
    expect(got.rows[0]).toMatchObject({ appId: APP_O, collectionId: 'orders' });
    expect(got.rows.every((x) => isSharedRecordId(x.id) && x.id.startsWith(`shared:${link.id}:`))).toBe(true);
    expect(r.records.reads).toEqual([`${APP_C}/customers`]);
    // Through the gate with the source named, the same rows come back.
    expect((await r.service.readFrom(APP_O, APP_C, 'customers')).rows).toHaveLength(2);
  });

  it('a link that only sends does not let the destination read', async () => {
    const r = await withData();
    await made(r, writeInput());
    expect(await r.service.readShared(APP_O, 'orders')).toMatchObject({ rows: [] });
    expect(await r.service.readFrom(APP_O, APP_C, 'customers')).toMatchObject({ ok: false, reason: 'no_link' });
  });

  it('stops at once when the link is turned off', async () => {
    const r = await withData();
    const link = await made(r, readInput());
    expect((await r.service.readShared(APP_O, 'orders')).rows).toHaveLength(2);
    expect(await r.service.revoke(link.id)).toMatchObject({ ok: true });
    expect(await r.service.readShared(APP_O, 'orders')).toEqual({ ok: true, rows: [], paused: [] });
    expect(await r.service.readFrom(APP_O, APP_C, 'customers')).toMatchObject({ ok: false, reason: 'no_link' });
    // Safe to repeat, and the history says when.
    expect(await r.service.revoke(link.id)).toMatchObject({ ok: true });
    const stored = await r.store.get(link.id);
    expect(stored).toMatchObject({ status: 'revoked' });
    expect(stored?.audit.map((a) => a.kind)).toEqual(['created', 'revoked']);
    expect(await r.service.revoke('lnk_doesnotexist')).toMatchObject({ ok: false });
  });
});

describe('a link is checked on every use', () => {
  it('pauses with a plain message when a field is removed, and works again when it is back', async () => {
    const r = rig();
    await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '111' });
    await made(r, readInput());
    const original = r.apps.get(APP_C)!;

    const noPhone = { ...customers, fields: { name: customers.fields.name } };
    r.apps.set(APP_C, storedApp(specWith(APP_C, 'Customer Book', { customers: noPhone })));
    const paused = await r.service.readShared(APP_O, 'orders');
    expect(paused.rows).toEqual([]);
    expect(paused.paused).toHaveLength(1);
    expect(paused.paused[0].problems[0]).toMatchObject({ code: 'source_field_missing' });
    expect(paused.paused[0].problems[0].message).toBe('Customer Book no longer has the field "Phone".');

    r.apps.set(APP_C, original);
    expect((await r.service.readShared(APP_O, 'orders')).rows).toHaveLength(1);
  });

  it('pauses when a field changes type, so the wrong kind of value is never passed on', async () => {
    const r = rig();
    await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '111' });
    await made(r, readInput());
    const phoneNumber = { ...customers, fields: { ...customers.fields, phone: { type: 'number' as const, label: 'Phone' } } };
    r.apps.set(APP_C, storedApp(specWith(APP_C, 'Customer Book', { customers: phoneNumber })));
    const got = await r.service.readShared(APP_O, 'orders');
    expect(got.rows).toEqual([]);
    expect(got.paused[0].problems[0].code).toBe('source_type_changed');
  });

  it('shows broken links in the list with the reason', async () => {
    const r = rig();
    await made(r, readInput());
    r.apps.set(APP_O, storedApp(specWith(APP_O, 'Order Book', { orders: { ...orders, fields: { customer_name: orders.fields.customer_name } } })));
    const [view] = await r.service.list(APP_C);
    expect(view.health.ok).toBe(false);
    expect(view.role).toBe('source');
    expect(view.sourceName).toBe('Customer Book');
    expect(view.fieldLabels).toEqual(['Name', 'Phone']);
    expect(view.lines.join(' ')).toContain('cannot change or delete');
  });

  it('a missing source app pauses the link too', async () => {
    const r = rig();
    await made(r, readInput());
    r.apps.delete(APP_C);
    const got = await r.service.readShared(APP_O, 'orders');
    expect(got.paused[0].problems[0].code).toBe('source_app_missing');
  });
});

describe('sending entries', () => {
  async function ready() {
    const r = rig();
    const a = await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '111', secret_note: SENTINEL });
    const b = await r.records.add(APP_C, 'customers', { name: 'Ravi', phone: '222' });
    const other = await r.records.add(APP_X, 'customers', { name: 'Not yours' });
    const link = await made(r, writeInput());
    return { r, a, b, other, link };
  }

  it('a view only link refuses to send', async () => {
    const r = rig();
    const rec = await r.records.add(APP_C, 'customers', { name: 'Asha' });
    const link = await made(r, readInput());
    const out = await r.service.send(link.id, { recordIds: [rec.id], confirmed: true });
    expect(out).toMatchObject({ ok: false, reason: 'read_only', created: 0 });
    expect(r.records.rows.filter((x) => x.appId === APP_O)).toEqual([]);
    expect(await r.service.sendable(link.id)).toMatchObject({ ok: false, reason: 'read_only' });
  });

  it('needs the confirmation of the person', async () => {
    const { r, a, link } = await ready();
    expect(await r.service.send(link.id, { recordIds: [a.id], confirmed: false })).toMatchObject({ ok: false, reason: 'not_confirmed' });
    expect(r.records.rows.filter((x) => x.appId === APP_O)).toEqual([]);
  });

  it('sends only the mapped fields of the chosen entries and remembers what was sent', async () => {
    const { r, a, link } = await ready();
    const out = await r.service.send(link.id, { recordIds: [a.id], confirmed: true });
    expect(out).toMatchObject({ ok: true, created: 1, updated: 0, message: 'Sent to Order Book: 1 new entry.' });
    const sent = r.records.rows.filter((x) => x.appId === APP_O);
    expect(sent.map((x) => x.values)).toEqual([{ customer_name: 'Asha', phone: '111' }]);
    expect(JSON.stringify(sent)).not.toContain(SENTINEL);
    const stored = await r.store.get(link.id);
    expect(stored?.sent).toEqual([[a.id, sent[0].id]]);
    expect(stored?.audit.at(-1)).toMatchObject({ kind: 'sent', count: 1, updated: 0 });
  });

  it('does not send the same entry twice unless the person asks to update it', async () => {
    const { r, a, link } = await ready();
    await r.service.send(link.id, { recordIds: [a.id], confirmed: true });
    const again = await r.service.send(link.id, { recordIds: [a.id], confirmed: true });
    expect(again).toMatchObject({ created: 0, updated: 0, skipped: [{ recordId: a.id, reason: 'already_sent' }] });
    expect(r.records.rows.filter((x) => x.appId === APP_O)).toHaveLength(1);

    r.records.rows.find((x) => x.id === a.id)!.values.phone = '555';
    const update = await r.service.send(link.id, { recordIds: [a.id], confirmed: true, updateExisting: true });
    expect(update).toMatchObject({ created: 0, updated: 1, message: 'Sent to Order Book: 1 entry updated.' });
    expect(r.records.rows.filter((x) => x.appId === APP_O).map((x) => x.values.phone)).toEqual(['555']);
  });

  it('makes a fresh copy when the earlier one was deleted', async () => {
    const { r, a, link } = await ready();
    await r.service.send(link.id, { recordIds: [a.id], confirmed: true });
    r.records.rows.splice(r.records.rows.findIndex((x) => x.appId === APP_O), 1);
    expect(await r.service.send(link.id, { recordIds: [a.id], confirmed: true, updateExisting: true })).toMatchObject({ created: 1, updated: 0 });
  });

  it('cannot reach entries of another list or app by id', async () => {
    const { r, other, link } = await ready();
    const out = await r.service.send(link.id, { recordIds: [other.id, 'rec_nonsense'], confirmed: true });
    expect(out.created).toBe(0);
    expect(out.skipped.map((s) => s.reason)).toEqual(['not_found', 'not_found']);
    expect(r.records.rows.filter((x) => x.appId === APP_O)).toEqual([]);
  });

  it('reports entries the destination would not take, without showing their values', async () => {
    const { r, a, b, link } = await ready();
    const err = new Error(`Invalid record: phone: ${SENTINEL}`);
    err.name = 'RecordValidationError';
    r.records.failWith.next = err;
    const out = await r.service.send(link.id, { recordIds: [a.id, b.id], confirmed: true });
    expect(out).toMatchObject({ ok: false, created: 1, failed: [{ recordId: a.id, reason: 'invalid' }] });
    expect(out.message).toBe('Sent to Order Book: 1 new entry. Order Book would not take 1 entry.');
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
  });

  it('limits one send, and an empty choice sends nothing', async () => {
    const { r, link } = await ready();
    expect(await r.service.send(link.id, { recordIds: [], confirmed: true })).toMatchObject({ ok: false, reason: 'nothing_selected' });
    const many = Array.from({ length: SHARE_LIMITS.sendBatch + 1 }, (_, i) => `r${i}`);
    expect(await r.service.send(link.id, { recordIds: many, confirmed: true })).toMatchObject({ ok: false, reason: 'too_many' });
  });

  it('refuses a turned off link and a link that is paused, and records the block', async () => {
    const { r, a, link } = await ready();
    const noPhone = { ...customers, fields: { name: customers.fields.name } };
    r.apps.set(APP_C, storedApp(specWith(APP_C, 'Customer Book', { customers: noPhone })));
    const blocked = await r.service.send(link.id, { recordIds: [a.id], confirmed: true });
    expect(blocked).toMatchObject({ ok: false, reason: 'broken', problems: [{ code: 'source_field_missing' }] });
    expect((await r.store.get(link.id))?.audit.at(-1)).toMatchObject({ kind: 'blocked', reason: 'source_field_missing' });
    expect(r.records.rows.filter((x) => x.appId === APP_O)).toEqual([]);

    await r.service.revoke(link.id);
    expect(await r.service.send(link.id, { recordIds: [a.id], confirmed: true })).toMatchObject({ ok: false, reason: 'revoked' });
    expect(await r.service.send('lnk_doesnotexist', { recordIds: [a.id], confirmed: true })).toMatchObject({ ok: false, reason: 'no_link' });
  });

  it('lists what could be sent, newest first, saying what went before', async () => {
    const { r, a, b, link } = await ready();
    await r.service.send(link.id, { recordIds: [a.id], confirmed: true });
    const res = await r.service.sendable(link.id);
    expect(res).toMatchObject({ ok: true, total: 2 });
    if (res.ok) expect(res.items).toEqual([{ id: b.id, title: 'Ravi · 222', alreadySent: false }, { id: a.id, title: 'Asha · 111', alreadySent: true }]);
  });
});

describe('what the runtime sees', () => {
  async function runtime() {
    const r = rig();
    await r.records.add(APP_O, 'orders', { customer_name: 'Own order' });
    await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '111' });
    const link = await made(r, readInput());
    return { r, link, repo: r.service.sharedRecords(r.records.repo) };
  }

  it('adds shared entries after the app own entries, in the destination list only', async () => {
    const { r, repo } = await runtime();
    const list = await repo.list(APP_O, 'orders');
    expect(list.map((x) => x.values.customer_name)).toEqual(['Own order', 'Asha']);
    const all = await repo.listAll(APP_O);
    expect(all.orders).toHaveLength(2);
    // The source app is not changed by being shared.
    expect(await repo.list(APP_C, 'customers')).toHaveLength(1);
    expect(r.records.rows.filter((x) => x.appId === APP_O)).toHaveLength(1);
  });

  it('keeps shared entries read only', async () => {
    const { repo } = await runtime();
    const shared = (await repo.list(APP_O, 'orders')).find((x) => isSharedRecordId(x.id))!;
    await expect(repo.update(APP_O, 'orders', shared.id, { phone: 'x' })).rejects.toBeInstanceOf(SharedRecordReadOnlyError);
    await expect(repo.remove(APP_O, 'orders', shared.id)).rejects.toThrow('This entry comes from another app. Change it there.');
    const own = await repo.insert(APP_O, 'orders', { customer_name: 'Another' });
    await repo.update(APP_O, 'orders', own.id, { phone: '1' });
    await repo.remove(APP_O, 'orders', own.id);
  });

  it('tells the app when the source changes or the link is turned off, then stops', async () => {
    const { r, link, repo } = await runtime();
    const seen: string[] = [];
    const off = repo.subscribe(APP_O, () => seen.push('change'));
    await new Promise((res) => setTimeout(res, 0));
    await r.records.add(APP_C, 'customers', { name: 'Ravi' });
    expect(seen).toEqual(['change']);
    await r.service.revoke(link.id);
    await new Promise((res) => setTimeout(res, 0));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect((await repo.list(APP_O, 'orders')).map((x) => x.values.customer_name)).toEqual(['Own order']);
    const before = seen.length;
    await r.records.add(APP_C, 'customers', { name: 'Later' });
    expect(seen.length).toBe(before);
    off();
    await r.records.add(APP_O, 'orders', { customer_name: 'After off' });
    expect(seen.length).toBe(before);
  });
});

describe('deleting an app', () => {
  it('removes every link of that app, either side', async () => {
    const r = rig();
    await made(r, readInput());
    await made(r, writeInput());
    await made(r, readInput({ sourceAppId: APP_X, destinationAppId: APP_O }));
    expect(await r.store.list()).toHaveLength(3);
    expect(await r.service.removeForApp(APP_C)).toBe(2);
    expect((await r.store.list()).map((l) => l.sourceAppId)).toEqual([APP_X]);
    expect(await r.service.removeForApp(APP_O)).toBe(1);
    expect(await r.store.list()).toEqual([]);
    expect(await r.service.removeForApp(APP_O)).toBe(0);
  });

  it('forgetting a link deletes it with its history', async () => {
    const r = rig();
    const link = await made(r, readInput());
    expect(await r.service.forget(link.id)).toBe(true);
    expect(await r.service.forget(link.id)).toBe(false);
    expect(await r.service.list(APP_C)).toEqual([]);
  });
});

describe('what is written to logs and messages', () => {
  it('never contains an entry value', async () => {
    const console_ = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')];
    const r = rig();
    const a = await r.records.add(APP_C, 'customers', { name: SENTINEL, phone: SENTINEL, city: 'Delhi' });
    const seen: unknown[] = [];

    const read = await made(r, readInput());
    const send = await made(r, writeInput());
    seen.push(await r.service.list(APP_C), await r.service.list(APP_O));
    seen.push(await r.service.readFrom(APP_X, APP_C, 'customers'), await r.service.readFrom(APP_O, APP_X, 'customers'));
    const shared = await r.service.readShared(APP_O, 'orders');
    const readMessages = [shared.message, ...shared.paused.flatMap((p) => p.problems.map((x) => x.message))];
    seen.push(await r.service.send(send.id, { recordIds: [a.id], confirmed: false }));
    seen.push(await r.service.send(send.id, { recordIds: [a.id], confirmed: true }));
    seen.push(await r.service.send(send.id, { recordIds: [a.id], confirmed: true }));
    const b = await r.records.add(APP_C, 'customers', { name: SENTINEL });
    const err = new Error(`bad ${SENTINEL}`);
    err.name = 'RecordValidationError';
    r.records.failWith.next = err;
    seen.push(await r.service.send(send.id, { recordIds: [b.id], confirmed: true }));
    r.apps.set(APP_C, storedApp(specWith(APP_C, 'Customer Book', { customers: { fields: { name: customers.fields.name } } })));
    seen.push(await r.service.readShared(APP_O, 'orders'), await r.service.send(send.id, { recordIds: [a.id], confirmed: true }));
    seen.push(await r.service.sendable(send.id));
    seen.push(await r.service.create(readInput({ confirmed: false })));
    await r.service.revoke(read.id);
    await r.service.forget(send.id);
    await r.service.removeForApp(APP_C);

    expect(r.events.length).toBeGreaterThan(8);
    expect(JSON.stringify(r.events)).not.toContain(SENTINEL);
    expect(JSON.stringify(readMessages)).not.toContain(SENTINEL);
    for (const x of seen) expect(JSON.stringify(x)).not.toContain(SENTINEL);
    for (const spy of console_) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
    // Stored links never hold values either, only ids of entries.
    expect(JSON.stringify(await r.store.list())).not.toContain(SENTINEL);
  });

  it('a log event only carries ids, counts and codes', async () => {
    const r = rig();
    await r.records.add(APP_C, 'customers', { name: 'Asha' });
    const link = await made(r, writeInput());
    await r.service.send(link.id, { recordIds: ['x'], confirmed: true });
    for (const e of r.events) {
      expect(Object.keys(e).every((k) => ['event', 'linkId', 'appId', 'count', 'code'].includes(k))).toBe(true);
      expect(Object.values(e).every((v) => typeof v === 'string' || typeof v === 'number')).toBe(true);
    }
  });

  it('a broken logger never stops a share', async () => {
    const r = rig();
    const apps = r.apps;
    const { createShareService } = await import('./service');
    const svc = createShareService({
      store: r.store, apps: { get: async (id) => apps.get(id) }, records: fakeRecords().repo, newId: () => 'abcdefgh1234', log: () => { throw new Error('boom'); },
    });
    expect((await svc.create(readInput())).ok).toBe(true);
  });
});
