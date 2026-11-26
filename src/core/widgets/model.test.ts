import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDGET_PREFS, newDraft, parsePrefs, parseWidget, parseWidgetLink, startStack, widgetLink, WIDGET_LIMITS, type WidgetDefinition,
} from './model';
import { createMemoryWidgetStore, readStoreData } from './store';

const def = (over: Partial<WidgetDefinition> = {}): WidgetDefinition => ({
  id: 'wgt_a1b2c3d4e5', v: 1, appId: 'app_chai01', title: 'Cups sold',
  source: { kind: 'stat', screen: 'home', component: 'cups' },
  size: 'small', refresh: 'live', hideWhenLocked: true, tap: { type: 'open_app' }, createdAt: 10, updatedAt: 10,
  ...over,
});

describe('widget definitions', () => {
  it('accepts a complete definition', () => {
    expect(parseWidget(def()).ok).toBe(true);
    expect(parseWidget(def({ source: { kind: 'list', screen: 'home', component: 'due', rows: 3, fields: ['name', 'qty'] } })).ok).toBe(true);
    expect(parseWidget(def({ source: { kind: 'count', collection: 'orders' }, tap: { type: 'open_screen', screen: 'add' } })).ok).toBe(true);
  });

  it.each([
    ['an unknown key', { ...def(), extra: 1 }],
    ['an id that is not wgt_', def({ id: 'abc' })],
    ['an empty title', def({ title: '   ' })],
    ['a title over the limit', def({ title: 'x'.repeat(WIDGET_LIMITS.titleLength + 1) })],
    ['a list with no fields', def({ source: { kind: 'list', screen: 'home', component: 'due', rows: 3, fields: [] } })],
    ['a list with the same field twice', def({ source: { kind: 'list', screen: 'home', component: 'due', rows: 3, fields: ['name', 'name'] } })],
    ['a list with too many rows', def({ source: { kind: 'list', screen: 'home', component: 'due', rows: 6, fields: ['name'] } })],
    ['a reserved field name', def({ source: { kind: 'list', screen: 'home', component: 'due', rows: 3, fields: ['__proto__'] } })],
    ['a tap that is a link', { ...def(), tap: { type: 'open_url', url: 'https://example.com' } }],
    ['a size that does not exist', { ...def(), size: 'huge' }],
  ])('refuses %s', (_name, input) => {
    expect(parseWidget(input).ok).toBe(false);
  });

  it('starts every new widget private: hidden when locked, follows the app, tap opens the app', () => {
    const d = newDraft('app_chai01', '  Cups sold  ', { kind: 'stat', screen: 'home', component: 'cups' });
    expect(d).toMatchObject({ title: 'Cups sold', size: 'small', refresh: 'live', hideWhenLocked: true, tap: { type: 'open_app' } });
    expect(newDraft('app_chai01', 'x', { kind: 'list', screen: 'home', component: 'due', rows: 3, fields: ['name'] }).size).toBe('medium');
    expect(newDraft('app_chai01', '', { kind: 'count', collection: 'orders' }).title).toBe('Widget');
  });

  it('keeps settings off until chosen, and falls back to the defaults for anything unreadable', () => {
    expect(DEFAULT_WIDGET_PREFS.webShortcuts).toBe(false);
    expect(parsePrefs({ webShortcuts: true })).toEqual({ webShortcuts: true });
    expect(parsePrefs({ webShortcuts: 'yes' })).toEqual(DEFAULT_WIDGET_PREFS);
    expect(parsePrefs(null)).toEqual(DEFAULT_WIDGET_PREFS);
  });
});

describe('what a tap opens', () => {
  it('builds links from validated parts and reads them back', () => {
    expect(widgetLink('app_chai01', { type: 'open_app' })).toBe('kalam://app/app_chai01');
    expect(widgetLink('app_chai01', { type: 'open_screen', screen: 'add' })).toBe('kalam://app/app_chai01?screen=add');
    expect(parseWidgetLink('kalam://app/app_chai01?screen=add')).toEqual({ appId: 'app_chai01', screen: 'add' });
    expect(parseWidgetLink('/app/app_chai01')).toEqual({ appId: 'app_chai01' });
    expect(parseWidgetLink('app/app_chai01')).toEqual({ appId: 'app_chai01' });
  });

  it.each([
    'https://evil.example/app/app_chai01', 'javascript:alert(1)', 'kalam://app/../etc', 'kalam://app/app_chai01?screen=a b',
    'kalam://app/app_chai01?screen=ADD', 'kalam://app/app_chai01?screen=add&x=1', 'kalam://app/', '', 'kalam://import#k2.abc',
  ])('refuses %j', (url) => {
    expect(parseWidgetLink(url)).toBeUndefined();
  });

  it('starts the runtime on the first screen, then the one asked for, and ignores a screen that is not there', () => {
    const spec = { screens: [{ id: 'home' }, { id: 'add' }], initialScreen: 'home' };
    expect(startStack(spec)).toEqual(['home']);
    expect(startStack(spec, 'add')).toEqual(['home', 'add']);
    expect(startStack(spec, 'home')).toEqual(['home']);
    expect(startStack(spec, 'gone')).toEqual(['home']);
    expect(startStack({ screens: [{ id: 'a' }], initialScreen: 'zzz' }, 'a')).toEqual(['a']);
    expect(startStack({ screens: [], initialScreen: 'home' }, 'add')).toEqual([]);
  });
});

describe('the widget store', () => {
  it('keeps what validates, drops what does not, and never repeats an id', () => {
    const { widgets, prefs } = readStoreData({ widgets: [def(), def(), { nope: true }, def({ id: 'wgt_zzzzzzzz11' })], prefs: { webShortcuts: 1 } });
    expect(widgets.map((w) => w.id)).toEqual(['wgt_a1b2c3d4e5', 'wgt_zzzzzzzz11']);
    expect(prefs).toEqual(DEFAULT_WIDGET_PREFS);
  });

  it('adds, replaces, removes by app, tells listeners, and refuses a malformed definition', async () => {
    const store = createMemoryWidgetStore();
    let calls = 0;
    const off = store.subscribe(() => void (calls += 1));
    await store.put(def());
    await store.put(def({ title: 'Renamed' }));
    await store.put(def({ id: 'wgt_other00001', appId: 'app_other01', createdAt: 20 }));
    expect((await store.list()).map((w) => w.title)).toEqual(['Renamed', 'Cups sold']);
    expect((await store.get('wgt_a1b2c3d4e5'))?.title).toBe('Renamed');
    await expect(store.put({ ...def(), title: '' })).rejects.toThrow();
    expect(await store.removeForApp('app_chai01')).toBe(1);
    expect((await store.list()).map((w) => w.id)).toEqual(['wgt_other00001']);
    expect(calls).toBe(4);
    off();
    await store.put(def());
    expect(calls).toBe(4);
  });

  it('keeps two quick changes instead of losing one', async () => {
    const store = createMemoryWidgetStore();
    await Promise.all([store.put(def()), store.put(def({ id: 'wgt_second0001' })), store.setPrefs({ webShortcuts: true })]);
    expect((await store.list()).length).toBe(2);
    expect(await store.prefs()).toEqual({ webShortcuts: true });
  });

  it('clear removes the widgets and puts the settings back to the defaults', async () => {
    const store = createMemoryWidgetStore([def()]);
    await store.setPrefs({ webShortcuts: true });
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await store.prefs()).toEqual(DEFAULT_WIDGET_PREFS);
  });
});
