import { describe, expect, it } from 'vitest';
import { APP_C, APP_O, APP_X, orders, rig, SENTINEL, specWith } from '@/core/share/test-kit';
import { createShareController } from './controller';
import { SHARE_UI } from './copy';
import { emptyDraft, withOtherApp, type Draft } from './model';

/** A controller for the customer app, wired to the same stores the service uses. */
function setup(failListing = false) {
  const r = rig();
  const state = { fail: failListing };
  const controller = createShareController({
    service: r.service,
    appId: APP_C,
    listApps: async () => {
      if (state.fail) throw new Error('disk');
      return [...r.apps.values()];
    },
    onLinksChanged: (l) => r.store.subscribe(l),
  });
  const customerSpec = r.apps.get(APP_C)!.spec;
  const orderSpec = r.apps.get(APP_O)!.spec;
  /** A draft that sends customers to orders. */
  const sendDraft = (): Draft => ({ ...withOtherApp(emptyDraft('send_to'), customerSpec, { id: APP_O, spec: orderSpec }), mapping: { name: 'customer_name', phone: 'phone' } });
  const viewDraft = (): Draft => withOtherApp(emptyDraft('let_view'), customerSpec, { id: APP_O, spec: orderSpec });
  return { r, controller, state, customerSpec, sendDraft, viewDraft };
}

describe('loading', () => {
  it('lists links and the other apps, leaving this app out', async () => {
    const { controller } = setup();
    expect(controller.getState().phase).toBe('loading');
    await controller.refresh();
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.views).toEqual([]);
    expect(s.others.map((o) => o.id).sort()).toEqual([APP_O, APP_X]);
  });

  it('says so when the device cannot be read, and recovers on the next try', async () => {
    const { controller, state } = setup(true);
    await controller.refresh();
    expect(controller.getState().phase).toBe('failed');
    state.fail = false;
    await controller.refresh();
    expect(controller.getState().phase).toBe('ready');
  });

  it('tells listeners when the state changes, and stops after stop', async () => {
    const { controller, r } = setup();
    let calls = 0;
    controller.subscribe(() => calls++);
    await controller.refresh();
    const afterLoad = calls;
    expect(afterLoad).toBeGreaterThan(0);
    controller.stop();
    await r.service.removeForApp(APP_C);
    await controller.refresh();
    expect(calls).toBe(afterLoad);
  });
});

describe('making and ending links', () => {
  it('makes a link from the draft and shows it', async () => {
    const { controller, viewDraft, customerSpec } = setup();
    await controller.refresh();
    const made = await controller.create(viewDraft(), customerSpec);
    expect(made.ok).toBe(true);
    await controller.refresh();
    const [view] = controller.getState().views;
    expect(view.role).toBe('source');
    expect(view.link.access).toBe('read');
  });

  it('keeps the list current when a link changes somewhere else in the app', async () => {
    const { controller, viewDraft, customerSpec, r } = setup();
    controller.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const made = await controller.create(viewDraft(), customerSpec);
    if (!made.ok) throw new Error('expected a link');
    await r.service.revoke(made.link.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    // No manual refresh: the store told the controller.
    expect(controller.getState().views[0].link.status).toBe('revoked');
    controller.stop();
  });

  it('refuses a draft with no other app chosen, without calling the service', async () => {
    const { controller, customerSpec, r } = setup();
    const result = await controller.create(emptyDraft('send_to'), customerSpec);
    expect(result).toMatchObject({ ok: false, message: SHARE_UI.form.blockers.pickApp });
    expect(await r.store.list()).toEqual([]);
  });

  it('turns a link off at once and then removes it', async () => {
    const { controller, viewDraft, customerSpec, r } = setup();
    await controller.refresh();
    const made = await controller.create(viewDraft(), customerSpec);
    if (!made.ok) throw new Error('expected a link');
    expect((await controller.revoke(made.link.id)).ok).toBe(true);
    expect((await r.store.get(made.link.id))?.status).toBe('revoked');
    expect((await controller.forget(made.link.id)).ok).toBe(true);
    expect(await r.store.get(made.link.id)).toBeUndefined();
    expect(await controller.forget(made.link.id)).toEqual({ ok: false, message: SHARE_UI.actionFailed });
  });

  it('a draft that names a field the other app cannot hold is refused with the reason', async () => {
    const { controller, customerSpec, r, sendDraft } = setup();
    await controller.refresh();
    // The phone field of the order app becomes a number after the draft was made.
    const drift = specWith(APP_O, 'Order Book', { orders: { ...orders, fields: { ...orders.fields, phone: { type: 'number', label: 'Phone' } } } });
    const draft = { ...sendDraft(), mapping: { phone: 'phone' } };
    r.apps.set(APP_O, { ...r.apps.get(APP_O)!, spec: drift });
    await controller.refresh();
    const result = await controller.create(draft, customerSpec);
    expect(result.ok).toBe(false);
    expect(await r.store.list()).toEqual([]);
  });
});

describe('sending entries', () => {
  it('sends the chosen entries after confirmation and shows the link history', async () => {
    const { controller, sendDraft, customerSpec, r } = setup();
    await controller.refresh();
    const made = await controller.create(sendDraft(), customerSpec);
    if (!made.ok) throw new Error('expected a link');
    const row = await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '98100' });
    const list = await controller.sendable(made.link.id);
    expect(list.ok && list.items.map((i) => i.id)).toEqual([row.id]);

    const out = await controller.send(made.link.id, [row.id], false);
    expect(out).toMatchObject({ ok: true, created: 1 });
    expect((await r.records.repo.list(APP_O, 'orders'))[0].values).toEqual({ customer_name: 'Asha', phone: '98100' });
    const view = controller.getState().views.find((v) => v.link.id === made.link.id);
    expect(view).toBeDefined();
  });

  it('a link that only shows entries cannot be used to send', async () => {
    const { controller, viewDraft, customerSpec, r } = setup();
    await controller.refresh();
    const made = await controller.create(viewDraft(), customerSpec);
    if (!made.ok) throw new Error('expected a link');
    const row = await r.records.add(APP_C, 'customers', { name: 'Asha' });
    expect(await controller.sendable(made.link.id)).toMatchObject({ ok: false, reason: 'read_only' });
    expect(await controller.send(made.link.id, [row.id], false)).toMatchObject({ ok: false, reason: 'read_only', created: 0 });
    expect(await r.records.repo.list(APP_O, 'orders')).toEqual([]);
  });

  it('a link that is turned off stops sending at once', async () => {
    const { controller, sendDraft, customerSpec, r } = setup();
    await controller.refresh();
    const made = await controller.create(sendDraft(), customerSpec);
    if (!made.ok) throw new Error('expected a link');
    const row = await r.records.add(APP_C, 'customers', { name: 'Asha', phone: '1' });
    await controller.revoke(made.link.id);
    expect(await controller.send(made.link.id, [row.id], false)).toMatchObject({ ok: false, reason: 'revoked' });
    expect(await r.records.repo.list(APP_O, 'orders')).toEqual([]);
  });

  it('shows a plain message, never an error, when the service throws', async () => {
    const { controller, r } = setup();
    r.service.send = async () => {
      throw new Error(`disk failed for ${SENTINEL}`);
    };
    r.service.sendable = async () => {
      throw new Error(`disk failed for ${SENTINEL}`);
    };
    const out = await controller.send('lnk_missing0001', ['x'], false);
    expect(out.ok).toBe(false);
    expect(out.message).toBe(SHARE_UI.actionFailed);
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
    const list = await controller.sendable('lnk_missing0001');
    expect(JSON.stringify(list)).not.toContain(SENTINEL);
  });
});

describe('what the screens never hold', () => {
  it('state carries names and counts, not entry values', async () => {
    const { controller, viewDraft, customerSpec, r } = setup();
    await r.records.add(APP_C, 'customers', { name: SENTINEL });
    await controller.create(viewDraft(), customerSpec);
    await controller.refresh();
    expect(JSON.stringify(controller.getState().views)).not.toContain(SENTINEL);
  });
});
