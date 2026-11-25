import { describe, expect, it } from 'vitest';
import { APP_C, APP_O, customers, orders, specWith } from '@/core/share/test-kit';
import { SHARE_UI } from './copy';
import {
  checkDraft, chooseAllEntries, chosenFields, collectionsOf, emptyDraft, entriesToChange, formatWhen, historyLine, INTENT_ROLE, sidesOf,
  SHARE_INTENTS, suggestedMapping, targetChoices, toCreateInput, toggleEntry, withCollection, withIntent, withOtherApp, withTarget,
  type Draft,
} from './model';

const customerApp = specWith(APP_C, 'Customer Book', { customers });
const orderApp = specWith(APP_O, 'Order Book', { orders });
const bazaarOrders = specWith(APP_O, 'Bazaar Orders', { orders }, { source: 'import', basedOn: 'bazaar:l0123456789abcdefghi' });

/** The person is in the customer app and sends entries to the order app. */
const sending = (patch: Partial<Draft> = {}): Draft => ({
  intent: 'send_to', otherAppId: APP_O, sourceCollection: 'customers', destinationCollection: 'orders',
  mapping: { name: 'customer_name', phone: 'phone' }, acknowledgeBazaar: false, ...patch,
});

describe('intents', () => {
  it('every choice maps to a side of the link and a kind of access', () => {
    expect(SHARE_INTENTS.map((i) => [i, INTENT_ROLE[i].thisApp, INTENT_ROLE[i].access])).toEqual([
      ['view_from', 'destination', 'read'],
      ['let_view', 'source', 'read'],
      ['send_to', 'source', 'write'],
      ['receive_from', 'destination', 'write'],
    ]);
  });

  it('puts this app on the right side', () => {
    expect(sidesOf(emptyDraft('send_to'), customerApp, orderApp)).toEqual({ source: customerApp, destination: orderApp });
    expect(sidesOf(emptyDraft('view_from'), orderApp, customerApp)).toEqual({ source: customerApp, destination: orderApp });
  });

  it('every intent has words of its own, with no dashes or exclamation marks', () => {
    for (const i of SHARE_INTENTS) {
      const t = SHARE_UI.intent[i];
      expect(t.label.length).toBeGreaterThan(10);
      expect(`${t.label} ${t.description}`).not.toMatch(/[—–!]/);
    }
  });
});

describe('mapping', () => {
  it('starts from the suggestions and lets each field go to one place', () => {
    const mapping = suggestedMapping(customers, orders);
    expect(mapping).toEqual({ phone: 'phone', city: 'city' });
    // phone already fills "phone", so another text field cannot also go there.
    expect(targetChoices(customers, orders, 'name', mapping)).toEqual(['customer_name']);
    expect(targetChoices(customers, orders, 'phone', mapping)).toEqual(['customer_name', 'phone']);
    expect(targetChoices(customers, orders, 'vip', mapping)).toEqual([]);
    expect(targetChoices(customers, orders, 'ghost', mapping)).toEqual([]);
  });

  it('lists chosen pairs in the order of the source list, skipping fields left out', () => {
    const d = sending({ mapping: { phone: 'phone', name: 'customer_name', city: '' } });
    expect(chosenFields(d, customers)).toEqual([{ source: 'name', target: 'customer_name' }, { source: 'phone', target: 'phone' }]);
    expect(chosenFields(d, undefined)).toEqual([]);
  });
});

describe('what blocks a link', () => {
  it('asks for the app, then the lists, then a field', () => {
    expect(checkDraft(emptyDraft('send_to'), customerApp, undefined).blockers).toEqual([SHARE_UI.form.blockers.pickApp]);
    expect(checkDraft({ ...emptyDraft('send_to'), otherAppId: APP_O }, customerApp, orderApp).blockers).toEqual([SHARE_UI.form.blockers.pickLists]);
    expect(checkDraft(sending({ mapping: {} }), customerApp, orderApp).blockers).toEqual([SHARE_UI.form.blockers.pickFields]);
  });

  it('a send link must fill every required field of the other app', () => {
    const d = sending({ mapping: { phone: 'phone' } });
    expect(checkDraft(d, customerApp, orderApp).blockers).toEqual([
      'Order Book needs "Customer name" on every entry. Share a field into it, or it will not accept the entries.',
    ]);
    // A link that only shows entries does not insert anything.
    expect(checkDraft({ ...d, intent: 'let_view' }, customerApp, orderApp).blockers).toEqual([]);
  });

  it('an app from the Bazaar needs the person to say they trust it', () => {
    const d = sending();
    const check = checkDraft(d, customerApp, bazaarOrders);
    expect(check.needsBazaarAck).toBe(true);
    expect(check.blockers).toEqual(['Confirm that you trust Bazaar Orders.']);
    expect(checkDraft({ ...d, acknowledgeBazaar: true }, customerApp, bazaarOrders).blockers).toEqual([]);
    // Only the app that receives needs this: a Bazaar app that is the source does not.
    expect(checkDraft({ ...d, intent: 'let_view' }, bazaarOrders, customerApp).needsBazaarAck).toBe(false);
  });

  it('explains the link in plain English once it is ready', () => {
    const ok = checkDraft(sending(), customerApp, orderApp);
    expect(ok.blockers).toEqual([]);
    expect(ok.lines[0]).toBe('Customer Book can send entries from "Customers" to the list "Orders" in Order Book. Only Name and Phone are sent.');
    expect(ok.lines.join(' ')).not.toMatch(/[—–!]/);
    expect(checkDraft(sending({ mapping: {} }), customerApp, orderApp).lines).toEqual([]);
  });
});

describe('what is handed to the service', () => {
  it('puts the apps on the right sides and always asks for confirmation to be true only here', () => {
    const sides = sidesOf(sending(), customerApp, orderApp);
    const { from } = collectionsOf(sending(), sides);
    expect(toCreateInput(sending(), APP_C, sides, from)).toEqual({
      sourceAppId: APP_C, sourceCollection: 'customers', destinationAppId: APP_O, destinationCollection: 'orders', access: 'write',
      fields: [{ source: 'name', target: 'customer_name' }, { source: 'phone', target: 'phone' }], confirmed: true, acknowledgeBazaar: false,
    });

    const receiving = sending({ intent: 'receive_from', otherAppId: APP_C });
    const sides2 = sidesOf(receiving, orderApp, customerApp);
    expect(toCreateInput(receiving, APP_O, sides2, collectionsOf(receiving, sides2).from)).toMatchObject({
      sourceAppId: APP_C, destinationAppId: APP_O, access: 'write',
    });
  });

  it('gives nothing until an app and both lists are chosen', () => {
    expect(toCreateInput(emptyDraft(), APP_O, {}, undefined)).toBeUndefined();
  });
});

describe('history lines', () => {
  const date = (ms: number) => `day ${ms}`;
  it('reads in plain words and counts only', () => {
    expect(historyLine({ at: 1, kind: 'created' }, date)).toBe('day 1: Link made');
    expect(historyLine({ at: 2, kind: 'revoked' }, date)).toBe('day 2: Turned off');
    expect(historyLine({ at: 3, kind: 'sent', count: 3, updated: 1 }, date)).toBe('day 3: 3 sent, 1 updated');
    expect(historyLine({ at: 4, kind: 'sent', count: 0, updated: 0 }, date)).toBe('day 4: Send finished, nothing new');
    expect(historyLine({ at: 5, kind: 'sent', count: 1, updated: 0, reason: 'some_rejected' }, date)).toBe('day 5: 1 sent, some were not accepted');
    expect(historyLine({ at: 6, kind: 'blocked', reason: 'source_field_missing' }, date)).toBe('day 6: Stopped because the link was paused');
  });
});

describe('building a link step by step', () => {
  const twoLists = specWith(APP_O, 'Two Lists', { orders, customers });

  it('picking the other app chooses a list that is the only one, and suggests the fields', () => {
    const d = withOtherApp(withIntent('send_to'), customerApp, { id: APP_O, spec: orderApp });
    expect(d).toMatchObject({ otherAppId: APP_O, sourceCollection: 'customers', destinationCollection: 'orders' });
    expect(d.mapping).toEqual({ phone: 'phone', city: 'city' });
  });

  it('puts the lists on the right sides for each intent', () => {
    const d = withOtherApp(withIntent('view_from'), orderApp, { id: APP_C, spec: customerApp });
    expect(d).toMatchObject({ sourceCollection: 'customers', destinationCollection: 'orders' });
  });

  it('leaves the list open when the other app has several, and fills the mapping once both are chosen', () => {
    const open = withOtherApp(withIntent('send_to'), customerApp, { id: APP_O, spec: twoLists });
    expect(open.destinationCollection).toBeUndefined();
    expect(open.mapping).toEqual({});
    const sides = sidesOf(open, customerApp, twoLists);
    const chosen = withCollection(open, 'destination', 'orders', sides);
    expect(chosen.mapping).toEqual({ phone: 'phone', city: 'city' });
  });

  it('starting again forgets the trust the person gave to an app', () => {
    const trusted: Draft = { ...sending(), acknowledgeBazaar: true };
    expect(withOtherApp(trusted, customerApp, { id: APP_O, spec: bazaarOrders }).acknowledgeBazaar).toBe(false);
    expect(withIntent('let_view')).toEqual(emptyDraft('let_view'));
  });

  it('a field goes to one place, or nowhere', () => {
    const d = withTarget(sending({ mapping: {} }), 'name', 'customer_name');
    expect(d.mapping).toEqual({ name: 'customer_name' });
    expect(withTarget(d, 'name', '').mapping).toEqual({});
  });
});

describe('choosing entries to send', () => {
  it('adds and removes entries, and stops at the limit', () => {
    let s = new Set<string>();
    s = toggleEntry(s, 'a', 2);
    s = toggleEntry(s, 'b', 2);
    s = toggleEntry(s, 'c', 2);
    expect([...s]).toEqual(['a', 'b']);
    expect([...toggleEntry(s, 'a', 2)]).toEqual(['b']);
  });

  it('chooses the first entries up to the limit', () => {
    expect([...chooseAllEntries(['a', 'b', 'c'], 2)]).toEqual(['a', 'b']);
  });

  it('counts what an update would change, and only when the person asked for updates', () => {
    const items = [{ id: 'a', alreadySent: true }, { id: 'b', alreadySent: false }, { id: 'c', alreadySent: true }];
    const chosen = new Set(['a', 'b']);
    expect(entriesToChange(items, chosen, true)).toBe(1);
    expect(entriesToChange(items, chosen, false)).toBe(0);
  });

  it('writes a date and time without throwing', () => {
    expect(formatWhen(Date.UTC(2026, 10, 25, 9, 30)).length).toBeGreaterThan(5);
  });
});
