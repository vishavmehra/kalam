import { describe, expect, it } from 'vitest';
import { WIDGET_BROKEN_NOTE } from './copy';
import { describeWidget } from './describe';
import { newDraft, WIDGET_LIMITS, type WidgetDefinition } from './model';
import { buildPayload, encodePayload, widgetPayloadSchema, WIDGET_LINK } from './payload';
import { createWidgetService } from './service';
import { pinnedShortcuts } from './shortcuts';
import { buildTimeline, midnightAfter, type WidgetData } from './snapshot';
import { checkWidget, readsScreenInput, resolveSource, suggestedTitle, widgetSources } from './sources';
import { createMemoryWidgetStore } from './store';
import { chaiSpec, dayText, fakeEngine, fakePlatform, NOON, record, storedApp, todayText } from './test-kit';

const APP = 'app_chai01';
const stat: WidgetDefinition['source'] = { kind: 'stat', screen: 'home', component: 'cups' };
const list: WidgetDefinition['source'] = { kind: 'list', screen: 'home', component: 'due_today', rows: 3, fields: ['name', 'qty', 'paid'] };
const def = (source: WidgetDefinition['source'], over: Partial<WidgetDefinition> = {}): WidgetDefinition => ({
  ...newDraft(APP, 'Widget', source), id: 'wgt_a1b2c3d4e5', v: 1, createdAt: 1, updatedAt: 1, ...over,
});
const orders = (...rows: Array<Record<string, string | number | boolean>>) => rows.map((v) => record(APP, 'orders', v));
const data = (records: ReturnType<typeof orders>): WidgetData => ({ records: { orders: records }, state: {} });

describe('what an app offers a widget', () => {
  const spec = chaiSpec();

  it('lists the visible stats and lists, then one count per list of entries', () => {
    const found = widgetSources(spec);
    expect(found.map((c) => c.key)).toEqual(['stat:home:cups', 'list:home:due_today', 'count:orders', 'count:notes']);
    expect(found[0]).toMatchObject({ kind: 'stat', label: 'Cups sold', screenTitle: 'Home' });
    expect(found.find((c) => c.key === 'count:orders')?.label).toBe('Number of entries in Orders');
  });

  it('starts a list on its own fields, with the checklist tick last, and never offers photos', () => {
    const due = widgetSources(spec).find((c) => c.kind === 'list');
    expect(due?.ref).toMatchObject({ kind: 'list', rows: 3, fields: ['name', 'qty', 'paid'] });
    expect(due?.fields.map((f) => f.id)).not.toContain('photo');
    expect(due?.fields.find((f) => f.id === 'paid')?.isCheck).toBe(true);
    expect(due?.fields.map((f) => f.id).slice(0, 3)).toEqual(['name', 'qty', 'paid']);
  });

  it('suggests the label as a title, cut to fit', () => {
    expect(suggestedTitle(widgetSources(spec)[0])).toBe('Cups sold');
  });

  it('knows when what a widget points at has gone', () => {
    expect(checkWidget(spec, def(stat))).toEqual({ ok: true });
    expect(checkWidget(undefined, def(stat))).toMatchObject({ ok: false, problem: 'app_missing' });
    expect(checkWidget(spec, def({ kind: 'stat', screen: 'home', component: 'gone' }))).toMatchObject({ problem: 'source_missing' });
    // a stat id that now belongs to a list is not a stat any more
    expect(checkWidget(spec, def({ kind: 'stat', screen: 'home', component: 'due_today' }))).toMatchObject({ problem: 'source_missing' });
    expect(checkWidget(spec, def({ kind: 'count', collection: 'gone' }))).toMatchObject({ problem: 'collection_missing' });
    expect(checkWidget(spec, def({ ...list, kind: 'list', fields: ['name', 'phone'] } as WidgetDefinition['source']))).toMatchObject({ problem: 'field_missing' });
    expect(checkWidget(spec, def({ ...list, kind: 'list', fields: ['photo'] } as WidgetDefinition['source']))).toMatchObject({ problem: 'field_missing' });
    expect(checkWidget(spec, def(stat, { tap: { type: 'open_screen', screen: 'gone' } }))).toMatchObject({ problem: 'screen_missing' });
    expect(checkWidget(spec, def(stat, { tap: { type: 'open_screen', screen: 'add' } }))).toEqual({ ok: true });
  });

  it('leaves out stats and lists that need something typed or opened, which a home screen never has', () => {
    expect(readsScreenInput('form.a + form.b')).toBe(true);
    expect(readsScreenInput('sum(orders.qty where selected == 1)')).toBe(true);
    expect(readsScreenInput('sum(orders.qty)')).toBe(false);
    expect(readsScreenInput('count(platform_forms)')).toBe(false);
    expect(readsScreenInput('sum(orders.selected_qty)')).toBe(false);
    expect(readsScreenInput(undefined)).toBe(false);
  });

  it('does not follow prototype names into the collections', () => {
    expect(resolveSource(spec, { kind: 'count', collection: 'constructor' })).toMatchObject({ ok: false });
  });
});

describe('what a widget shows', () => {
  const spec = chaiSpec();

  it('prints a stat the way its formula and its suffix say', () => {
    const t = buildTimeline(spec, def(stat), data(orders({ name: 'Tea', qty: 2 }, { name: 'Coffee', qty: 3 })), fakeEngine, NOON);
    expect(t).toMatchObject({ ok: true, entries: [{ from: 0, headline: '5 cups', rows: [] }] });
  });

  it('counts the entries of a list with the same count() the app uses', () => {
    const t = buildTimeline(spec, def({ kind: 'count', collection: 'orders' }), data(orders({ name: 'a' }, { name: 'b' })), fakeEngine, NOON);
    expect(t).toMatchObject({ ok: true, entries: [{ headline: '2' }] });
  });

  it('shows the rows the list would show, cut to the rows the person chose, with only the fields they allowed', () => {
    const rows = orders(
      { name: 'Tea', qty: 2, due: todayText, paid: true, secret: '98765 43210' },
      { name: 'Coffee', qty: 1, due: todayText, paid: false, secret: '99999 00000' },
      { name: 'Lassi', qty: 4, due: dayText(3), paid: false, secret: '11111 22222' },
    );
    const src = { ...list, rows: 1, fields: ['name'] } as WidgetDefinition['source'];
    const t = buildTimeline(spec, def(src, { refresh: 'on_open' }), data(rows), fakeEngine, NOON);
    // newest first, one row, the name only: no quantity, no tick, no phone number
    expect(t).toMatchObject({ ok: true, entries: [{ rows: [{ text: 'Coffee' }] }] });
    expect(JSON.stringify(t)).not.toMatch(/9876|9999|1111|Customer phone/);
    expect(JSON.stringify(t)).not.toContain('qty');
  });

  it('puts the second field in the detail and the tick in done', () => {
    const rows = orders({ name: 'Tea', qty: 2, due: todayText, paid: true });
    const t = buildTimeline(spec, def(list, { refresh: 'on_open' }), data(rows), fakeEngine, NOON);
    expect(t.ok && t.entries[0].rows).toEqual([{ text: 'Tea', detail: '2', done: true }]);
  });

  it('says so, in the app\'s own words, when a list is empty', () => {
    const t = buildTimeline(spec, def(list, { refresh: 'on_open' }), data([]), fakeEngine, NOON);
    expect(t).toMatchObject({ ok: true, entries: [{ rows: [], note: 'Nothing due today' }] });
  });

  it('looks ahead one entry per midnight that changes the answer, so "due today" turns over by itself', () => {
    const rows = orders(
      { name: 'Tea', qty: 2, due: todayText, paid: false },
      { name: 'Lassi', qty: 4, due: dayText(2), paid: false },
    );
    const t = buildTimeline(spec, def(list), data(rows), fakeEngine, NOON);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    // today: Tea. tomorrow: nothing. in two days: Lassi. then nothing again.
    expect(t.entries.map((e) => e.rows.map((r) => r.text))).toEqual([['Tea'], [], ['Lassi'], []]);
    expect(t.entries.map((e) => e.from)).toEqual([0, midnightAfter(NOON, 1).getTime(), midnightAfter(NOON, 2).getTime(), midnightAfter(NOON, 3).getTime()]);
    expect(t.entries[1].note).toBe('Nothing due today');
  });

  it('gives one entry only to a widget that follows Kalam opening', () => {
    const rows = orders({ name: 'Tea', qty: 2, due: todayText, paid: false });
    const t = buildTimeline(spec, def(list, { refresh: 'on_open' }), data(rows), fakeEngine, NOON);
    expect(t.ok && t.entries.length).toBe(1);
  });

  it('does not repeat entries that print the same', () => {
    const t = buildTimeline(spec, def(stat), data(orders({ name: 'Tea', qty: 2 })), fakeEngine, NOON);
    expect(t.ok && t.entries.length).toBe(1);
  });

  it('turns an engine that throws into a problem for this widget alone', () => {
    const boom = { ...fakeEngine, statText: () => { throw new Error('x'); } };
    expect(buildTimeline(spec, def(stat), data([]), boom, NOON)).toEqual({ ok: false, problem: 'source_missing' });
  });
});

describe('the message for the home screen', () => {
  const spec = chaiSpec();
  const rows = orders({ name: 'Tea', qty: 2, due: todayText, paid: false, secret: 'private-number-123' });

  it('matches its schema and carries only the text the person chose', () => {
    const { payload, broken } = buildPayload(
      [{ def: def(stat), spec, data: data(rows) }, { def: def(list, { id: 'wgt_second0001', title: 'Due today', tap: { type: 'open_screen', screen: 'add' } }), spec, data: data(rows) }],
      fakeEngine, NOON,
    );
    expect(broken).toEqual([]);
    expect(widgetPayloadSchema.safeParse(payload).success).toBe(true);
    const text = encodePayload(payload);
    expect(text).not.toContain('private-number-123');
    expect(text).not.toMatch(/"id":"r\d/);
    expect(payload.widgets[0]).toMatchObject({ appName: 'Chai Shop', link: 'kalam://app/app_chai01', hideWhenLocked: true });
    expect(payload.widgets[1].link).toBe('kalam://app/app_chai01?screen=add');
    expect(payload.widgets.every((w) => WIDGET_LINK.test(w.link))).toBe(true);
    expect(payload.labels.stale).toBe('Open Kalam to update');
  });

  it('shows a note, never an old number, for a widget whose app or source is gone', () => {
    const { payload, broken } = buildPayload(
      [{ def: def(stat) }, { def: def({ kind: 'stat', screen: 'home', component: 'gone' }, { id: 'wgt_second0001' }), spec, data: data(rows) }],
      fakeEngine, NOON,
    );
    expect(broken).toEqual([{ id: 'wgt_a1b2c3d4e5', problem: 'app_missing' }, { id: 'wgt_second0001', problem: 'source_missing' }]);
    expect(payload.widgets[0].entries).toEqual([{ from: 0, rows: [], note: WIDGET_BROKEN_NOTE.app_missing }]);
    expect(payload.widgets[0].hideWhenLocked).toBe(true);
    expect(payload.widgets[1].entries[0].headline).toBeUndefined();
  });

  it('keeps the first twelve widgets and no more', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ def: def(stat, { id: `wgt_many${String(i).padStart(5, '0')}` }), spec, data: data(rows) }));
    expect(buildPayload(many, fakeEngine, NOON).payload.widgets).toHaveLength(WIDGET_LIMITS.perDevice);
  });

  it('refuses to encode a payload that breaks its own schema', () => {
    const { payload } = buildPayload([{ def: def(stat), spec, data: data(rows) }], fakeEngine, NOON);
    payload.widgets[0].link = 'https://evil.example';
    expect(() => encodePayload(payload)).toThrow();
  });

  it('describes a widget in plain words', () => {
    expect(describeWidget(spec, def(list, { tap: { type: 'open_screen', screen: 'add' } }))).toEqual([
      'Shows up to 3 rows of Due today from Chai Shop.',
      'Fields: Item, Cups and Paid.',
      'Updates when you add or change entries, and at midnight for dates.',
      'Hides what it shows while the device is locked.',
      'Opens Add order.',
    ]);
    expect(describeWidget(undefined, def(stat))[0]).toBe('Updates when you add or change entries, and at midnight for dates.');
  });
});

describe('the widget service', () => {
  function setup(opts: Parameters<typeof fakePlatform>[0] = {}, extraApps: ReturnType<typeof storedApp>[] = []) {
    const spec = chaiSpec();
    const apps = [storedApp(spec), ...extraApps];
    const platform = fakePlatform(opts);
    const store = createMemoryWidgetStore();
    let seed = 0;
    const held = { orders: orders({ name: 'Tea', qty: 2, due: todayText, paid: false }) };
    const service = createWidgetService({
      store, platform, engine: fakeEngine,
      apps: { list: async () => apps },
      records: { listAll: async () => ({ orders: held.orders, notes: [] }) },
      state: { all: async () => ({}) },
      newId: () => `abcd${String(++seed).padStart(6, '0')}`,
      now: () => NOON.getTime(),
    });
    return { spec, apps, platform, store, service, held };
  }
  const draft = (source: WidgetDefinition['source'], title = 'Cups sold') => newDraft(APP, title, source);

  it('makes a widget, saves it and hands the home screen its text', async () => {
    const { service, platform, store } = setup();
    const made = await service.create(draft(stat));
    expect(made).toMatchObject({ ok: true, widget: { id: 'wgt_abcd000001', title: 'Cups sold', hideWhenLocked: true } });
    expect((await store.list()).length).toBe(1);
    expect(platform.published).toHaveLength(1);
    const sent = widgetPayloadSchema.parse(JSON.parse(platform.published[0]));
    expect(sent.widgets[0].entries[0].headline).toBe('2 cups');
  });

  it('refuses what the app cannot show, and says why in plain words', async () => {
    const { service, platform } = setup();
    expect(await service.create(draft({ kind: 'stat', screen: 'home', component: 'gone' }))).toMatchObject({ ok: false, reason: 'source_missing' });
    expect(await service.create(newDraft('app_gone001', 'x', stat))).toMatchObject({ ok: false, reason: 'app_missing', message: 'That app is not on this device any more.' });
    expect(await service.create({ ...draft(list), source: { ...list, fields: [] } as WidgetDefinition['source'] })).toMatchObject({ ok: false, reason: 'no_fields' });
    expect(await service.create({ ...draft(stat), title: '  ' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(platform.published).toHaveLength(0);
  });

  it('keeps four widgets to an app', async () => {
    const { service } = setup();
    for (let i = 0; i < WIDGET_LIMITS.perApp; i++) expect((await service.create(draft(stat, `W${i}`))).ok).toBe(true);
    expect(await service.create(draft(stat, 'one more'))).toMatchObject({ ok: false, reason: 'too_many', message: 'One app can have up to 4 widgets. Remove one first.' });
  });

  it('keeps twelve widgets to a device', async () => {
    const ids = ['app_other01', 'app_other02', 'app_other03'];
    const { service } = setup({}, ids.map((id) => storedApp(chaiSpec(id, { name: id }))));
    for (const appId of [APP, ...ids.slice(0, 2)]) {
      for (let i = 0; i < WIDGET_LIMITS.perApp; i++) expect((await service.create(newDraft(appId, `W${i}`, stat))).ok).toBe(true);
    }
    expect(await service.create(newDraft('app_other03', 'W13', stat))).toMatchObject({ ok: false, reason: 'too_many', message: 'This device keeps up to 12 widgets. Remove one first.' });
  });

  it('updates a widget, checks the new choice against the app and follows it on the home screen', async () => {
    const { service, platform } = setup();
    const made = await service.create(draft(stat));
    if (!made.ok) throw new Error('setup');
    const changed = await service.update(made.widget.id, { title: 'Cups', hideWhenLocked: false });
    expect(changed).toMatchObject({ ok: true, widget: { title: 'Cups', hideWhenLocked: false } });
    expect(JSON.parse(platform.published.at(-1) as string).widgets[0]).toMatchObject({ title: 'Cups', hideWhenLocked: false });
    expect(await service.update(made.widget.id, { tap: { type: 'open_screen', screen: 'gone' } })).toMatchObject({ ok: false, reason: 'screen_missing' });
    expect(await service.update('wgt_missing001', { title: 'x' })).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('previews what a widget would show without saving it', async () => {
    const { service, store, platform } = setup();
    expect(await service.preview(draft(stat))).toMatchObject({ ok: true, appName: 'Chai Shop', body: { headline: '2 cups' } });
    expect(await service.preview(newDraft('app_gone001', 'x', stat))).toMatchObject({ ok: false });
    expect(await store.list()).toEqual([]);
    expect(platform.published).toEqual([]);
  });

  it('removes widgets of an app that was deleted, and empties the home screen when none are left', async () => {
    const { service, platform, store, apps } = setup();
    await service.create(draft(stat));
    apps.length = 0;
    const r = await service.sync();
    expect(r).toMatchObject({ removed: 1, published: 0, platform: 'ok' });
    expect(await store.list()).toEqual([]);
    expect(platform.cleared).toBe(1);
  });

  it('reports a device without widgets and still keeps its install shortcuts current', async () => {
    const { service, platform } = setup({ availabilityNow: { supported: false, platform: 'web', reason: 'The web app has no home-screen widgets.' } });
    await service.create(draft(stat));
    const r = await service.sync();
    expect(r.platform).toBe('unsupported');
    expect(platform.published).toEqual([]);
    expect(platform.shortcuts.at(-1)).toEqual([]);
  });

  it('offers pinned apps as install shortcuts only after the person turns it on', async () => {
    const pinned = storedApp(chaiSpec('app_pinned01', { name: 'Pinned Book' }), { pinned: true, lastOpenedAt: 5 });
    const { service, platform } = setup({}, [pinned, storedApp(chaiSpec('app_arch0001', { name: 'Old' }), { pinned: true, archived: true })]);
    await service.sync();
    expect(platform.shortcuts.at(-1)).toEqual([]);
    await service.setPrefs({ webShortcuts: true });
    expect(platform.shortcuts.at(-1)).toEqual([{ name: 'Pinned Book', url: '/app/app_pinned01' }]);
    await service.setPrefs({ webShortcuts: false });
    expect(platform.shortcuts.at(-1)).toEqual([]);
  });

  it('does not move a widget that follows Kalam opening when an entry changes, and does when Kalam opens', async () => {
    const { service, platform, held } = setup();
    await service.create({ ...draft(stat, 'Live'), refresh: 'live' });
    await service.create({ ...draft({ kind: 'count', collection: 'orders' }, 'Counted'), refresh: 'on_open' });
    const headlines = () =>
      (JSON.parse(platform.published.at(-1) as string) as { widgets: Array<{ entries: Array<{ headline: string }> }> }).widgets.map((w) => w.entries[0].headline);
    expect(headlines()).toEqual(['2 cups', '1']);
    held.orders = [...held.orders, ...orders({ name: 'Coffee', qty: 3, due: todayText, paid: false })];
    await service.sync('change');
    expect(headlines()).toEqual(['5 cups', '1']);
    await service.sync('open');
    expect(headlines()).toEqual(['5 cups', '2']);
  });

  it('adds to the home screen only after the home screen holds the widget, and passes the answer on', async () => {
    const { service, platform } = setup();
    const made = await service.create(draft(stat));
    if (!made.ok) throw new Error('setup');
    const before = platform.published.length;
    expect(await service.addToHomeScreen(made.widget.id)).toEqual({ ok: true, requested: true });
    expect(platform.published.length).toBe(before + 1);
    expect(platform.pins).toEqual([made.widget.id]);
    expect(await service.addToHomeScreen('wgt_missing001')).toMatchObject({ ok: false, reason: 'unknown_widget' });
    platform.pinResult = { ok: false, reason: 'unsupported', message: 'This launcher cannot add widgets from an app.' };
    expect(await service.addToHomeScreen(made.widget.id)).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('lists widgets with their sentences, their health and how many are on the home screen', async () => {
    const { service, platform, apps } = setup();
    const made = await service.create(draft(stat));
    if (!made.ok) throw new Error('setup');
    platform.placedNow = { [made.widget.id]: 2 };
    const [view] = await service.list();
    expect(view).toMatchObject({ appName: 'Chai Shop', placed: 2, health: { ok: true } });
    expect(view.lines[0]).toBe('Shows Cups sold from Chai Shop.');
    platform.availabilityNow = { supported: true, platform: 'ios', canPin: false, canCount: false };
    expect((await service.list())[0].placed).toBeUndefined();
    apps.length = 0;
    expect((await service.list())[0].health).toMatchObject({ ok: false, problem: 'app_missing' });
  });

  it('never throws from sync, even when the platform does', async () => {
    const { service, platform } = setup();
    await service.create(draft(stat));
    platform.publish = async () => {
      throw new Error('disk full');
    };
    expect(await service.sync()).toMatchObject({ platform: 'failed' });
  });

  it('clears everything: widgets, settings, the home screen and the shortcuts', async () => {
    const { service, platform, store } = setup();
    await service.create(draft(stat));
    await service.setPrefs({ webShortcuts: true });
    await service.clearAll();
    expect(await store.list()).toEqual([]);
    expect(await store.prefs()).toEqual({ webShortcuts: false });
    expect(platform.cleared).toBeGreaterThan(0);
    expect(platform.shortcuts.at(-1)).toEqual([]);
  });
});

describe('install shortcuts for pinned apps', () => {
  const app = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, spec: { name }, ...extra });
  it('lists pinned apps that are not archived, most recently opened first, at most four', () => {
    const apps = [
      app('app_one0001', 'One', { pinned: true, lastOpenedAt: 1 }),
      app('app_two0001', 'Two', { pinned: true, lastOpenedAt: 9 }),
      app('app_not0001', 'Not pinned', { lastOpenedAt: 99 }),
      app('app_old0001', 'Archived', { pinned: true, archived: true }),
      ...['a', 'b', 'c', 'd'].map((x, i) => app(`app_more00${x}`, `More ${x}`, { pinned: true, lastOpenedAt: 2 + i })),
    ];
    const out = pinnedShortcuts(apps);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ name: 'Two', url: '/app/app_two0001' });
    expect(out.map((s) => s.name)).not.toContain('Not pinned');
    expect(out.map((s) => s.name)).not.toContain('Archived');
  });

  it('cuts long names and skips apps whose id is not a valid path', () => {
    const out = pinnedShortcuts([app('app_long001', 'N'.repeat(80), { pinned: true }), app('Bad Id', 'x', { pinned: true })]);
    expect(out).toEqual([{ name: 'N'.repeat(30), url: '/app/app_long001' }]);
  });
});
