/**
 * The native widgets (Kotlin, Swift) were never compiled here. What can be checked without a compiler is that they read the
 * same message the app writes: every key they ask for exists in a real payload at the level they ask for it (a key that only
 * exists on a widget is wrong on a row), every label they print is one the app sends, every field Swift requires is always
 * sent, and the link and id rules they enforce agree with the ones the app enforces.
 *
 * This does not make the native side a validator. The JS side is the schema authority (`payload.ts`); the native side checks
 * the version, the size, that `widgets` is a list, each widget's id and each link, and reads the rest as it comes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newDraft, WIDGET_ID } from './model';
import { buildPayload, WIDGET_LINK } from './payload';
import { chaiSpec, fakeEngine, NOON, record } from './test-kit';

const root = fileURLToPath(new URL('../../../modules/kalam-widget/', import.meta.url));
const read = (path: string) => readFileSync(root + path, 'utf8');
const KT = 'android/src/main/java/expo/modules/kalamwidget/';
const kotlin = [read(`${KT}KalamWidgetProvider.kt`), read(`${KT}WidgetData.kt`), read(`${KT}WidgetPickerActivity.kt`)].join('\n');
const swift = read('ios-widget/WidgetStore.swift');

const spec = chaiSpec();
const data = { records: { orders: [record('app_chai01', 'orders', { name: 'Tea', qty: 2, due: '2026-11-25', paid: true })] }, state: {} };
const list = newDraft('app_chai01', 'Due', { kind: 'list', screen: 'home', component: 'due_today', rows: 3, fields: ['name', 'qty', 'paid'] });
const { payload } = buildPayload(
  [
    { def: { ...list, id: 'wgt_a1b2c3d4e5', v: 1, createdAt: 1, updatedAt: 1 }, spec, data },
    { def: { ...newDraft('app_chai01', 'Cups', { kind: 'stat', screen: 'home', component: 'cups' }), id: 'wgt_b1b2c3d4e5', v: 1, createdAt: 1, updatedAt: 1 }, spec, data },
  ],
  fakeEngine, NOON,
);

type Level = 'payload' | 'labels' | 'widget' | 'entry' | 'row';
type Obj = Record<string, unknown>;
const keysOf = (objects: Obj[]) => new Set(objects.flatMap((o) => Object.keys(o)));
const objects: Record<Level, Obj[]> = {
  payload: [payload as unknown as Obj],
  labels: [payload.labels as unknown as Obj],
  widget: payload.widgets as unknown as Obj[],
  entry: payload.widgets.flatMap((w) => w.entries) as unknown as Obj[],
  row: payload.widgets.flatMap((w) => w.entries.flatMap((e) => e.rows)) as unknown as Obj[],
};
const keysAt = (level: Level) => keysOf(objects[level]);

/**
 * What each name in the Kotlin means. A receiver that is not here fails the test, so a new read cannot slip past unchecked:
 * add it here with the level it reads. `it` is two levels because two lambdas use it (the message in `payload`, a widget in `widgets`).
 */
const RECEIVER: Record<string, Level[]> = {
  'payload(context)': ['payload'], 'payload(c)': ['payload'], root: ['payload'],
  widget: ['widget'], 'widgets[which]': ['widget'], it: ['payload', 'widget'],
  entry: ['entry'], e: ['entry'], 'optJSONObject(i)': ['entry'],
  row: ['row'],
};
const READ = /([A-Za-z_]\w*(?:\([^()]*\)|\[[^\]]*\])?)\??\.(?:optString|optInt|optLong|optBoolean|optJSONArray|optJSONObject|getJSONArray|has)\("([A-Za-z]+)"/g;

/** Every key Kotlin reads and every label it prints, with what is wrong with it (if anything). */
function kotlinProblems(source: string): { reads: number; labels: number; problems: string[] } {
  const problems: string[] = [];
  let reads = 0;
  for (const [, receiver, key] of source.matchAll(READ)) {
    reads += 1;
    const levels = RECEIVER[receiver];
    if (!levels) problems.push(`Kotlin reads "${key}" from "${receiver}", which this test does not know: add it to RECEIVER`);
    else if (!levels.some((l) => keysAt(l).has(key))) problems.push(`Kotlin reads "${key}" from ${levels.join(' or ')}, where the app never writes it`);
  }
  let labels = 0;
  for (const [, key] of source.matchAll(/\btext\("([A-Za-z]+)"/g)) {
    labels += 1;
    if (!keysAt('labels').has(key)) problems.push(`Kotlin prints label "${key}", which the app never sends`);
  }
  return { reads, labels, problems };
}

describe('the Android widget reads what the app writes', () => {
  it('asks for keys at the level they are written, and prints only labels the app sends', () => {
    const { reads, labels, problems } = kotlinProblems(kotlin);
    expect(reads).toBeGreaterThan(15);
    expect(labels).toBeGreaterThan(5);
    expect(problems).toEqual([]);
  });

  it('would notice a key read at the wrong level or a misspelled label', () => {
    const wrong = kotlinProblems(`row.optString("title"); widget.optString("text"); text("lockd", R.string.x); thing.optInt("v")`);
    expect(wrong.problems).toHaveLength(4);
    expect(kotlinProblems(`row.optString("text"); widget.optString("title"); text("locked", R.string.x)`).problems).toEqual([]);
  });

  it('checks ids and links the way the app does', () => {
    const idRule = new RegExp(/WIDGET_ID = Regex\("(.*)"\)/.exec(kotlin)?.[1] ?? '(none)');
    const linkRule = new RegExp((/LINK = Regex\("(.*)"\)/.exec(kotlin)?.[1] ?? '(none)').replace(/\\\\/g, '\\'));
    for (const id of ['wgt_a1b2c3d4e5', 'wgt_short', 'wgt_UPPERCASE1', 'x', '']) expect(idRule.test(id), id).toBe(WIDGET_ID.test(id));
    for (const link of [
      'kalam://', 'kalam://app/app_chai01', 'kalam://app/app_chai01?screen=add', 'kalam://app/ab', 'kalam://app/app_chai01?screen=ADD',
      'https://evil.example', 'kalam://import', 'kalam://app/app_chai01?screen=a&b=c', 'javascript:alert(1)', '',
    ]) expect(linkRule.test(link), link).toBe(WIDGET_LINK.test(link));
  });

  it('is not open to other apps, and only trusts a pin answer for a widget and an instance that exist', () => {
    const manifest = read('android/src/main/AndroidManifest.xml');
    expect(/<receiver[^>]*KalamWidgetProvider[^>]*android:exported="false"/s.test(manifest)).toBe(true);
    expect(manifest).not.toContain('android:exported="true"');
    const provider = read(`${KT}KalamWidgetProvider.kt`);
    expect(provider).toContain('WidgetData.widget(context, widgetId) != null');
    expect(provider).toContain('appWidgetIds(context).contains(id)');
  });
});

describe('the iPhone widget reads what the app writes', () => {
  const level: Record<string, Level> = { WidgetRow: 'row', WidgetEntryData: 'entry', WidgetRender: 'widget', WidgetLabels: 'labels', WidgetMessage: 'payload' };

  it('requires only fields that are always sent, at the level they are sent, and asks for no others', () => {
    for (const [name, at] of Object.entries(level)) {
      const fields = [...(new RegExp(`struct ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(swift)?.[1] ?? '').matchAll(/^\s+let (\w+): ([\w\[\]?]+)/gm)];
      expect(fields.length, name).toBeGreaterThan(0);
      for (const [, key, type] of fields) {
        expect(keysAt(at).has(key), `Swift ${name} reads "${key}" but the app never writes it at that level`).toBe(true);
        // A field Swift does not mark optional must be in every object of that level.
        if (!type.endsWith('?')) for (const o of objects[at]) expect(key in o, `${name}.${key} missing from a message object`).toBe(true);
      }
    }
  });

  it('allows the same links as the app', () => {
    const rule = new RegExp((/let pattern = "(.*)"/.exec(swift)?.[1] ?? '(none)').replace(/\\\\/g, '\\'));
    for (const link of ['kalam://', 'kalam://app/app_chai01', 'kalam://app/app_chai01?screen=add', 'https://evil.example', 'kalam://app/x']) {
      expect(rule.test(link), link).toBe(WIDGET_LINK.test(link));
    }
  });

  it('only reads version 1, as the app writes it', () => {
    expect(swift).toContain('message.v == 1');
    expect(payload.v).toBe(1);
  });
});
