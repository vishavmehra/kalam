import { describe, expect, it } from 'vitest';
import { loadFixtures, loadFixture } from '../../../tests/fixtures/specs/load';
import type { AppVersion } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { cloneSpec, createVersion } from '../versioning';
import {
  buildTimeline, categorizeVersion, CATEGORY_LABELS, colourName, describePatch, describeSpecChanges, diffVersions,
  filterTimeline, groupByCategory, IMPACT_LABELS, summarizeChanges, type ChangeEntry,
} from './index';

const fixture = (name: string): KalamSpec => loadFixture('valid', name) as unknown as KalamSpec;
const expenses = () => fixture('expense-tracker');
const texts = (entries: ChangeEntry[]): string[] => entries.map((e) => e.text);
/** A copy of `spec` after `edit` ran on it. */
function edited(spec: KalamSpec, edit: (s: KalamSpec) => void): KalamSpec {
  const s = cloneSpec(spec);
  edit(s);
  return s;
}
const diff = (edit: (s: KalamSpec) => void, base = expenses()): ChangeEntry[] => describeSpecChanges(base, edited(base, edit));
const screen = (s: KalamSpec, id: string) => s.screens.find((x) => x.id === id)!;

describe('describeSpecChanges: no change', () => {
  it('returns nothing for identical specs', () => {
    expect(describeSpecChanges(expenses(), expenses())).toEqual([]);
  });

  it('ignores version and updatedAt bookkeeping', () => {
    expect(diff((s) => { s.version += 1; s.meta.updatedAt = 99; })).toEqual([]);
  });

  it('ignores key order inside a component', () => {
    const base = expenses();
    const after = edited(base, (s) => {
      const list = screen(s, 'home').children[2] as unknown as Record<string, unknown>;
      screen(s, 'home').children[2] = Object.fromEntries(Object.entries(list).reverse()) as never;
    });
    expect(describeSpecChanges(base, after)).toEqual([]);
  });
});

describe('describeSpecChanges: screens', () => {
  it('reports a rename by id, not as a removal plus an addition', () => {
    const out = diff((s) => { screen(s, 'home').title = 'Today'; });
    expect(texts(out)).toEqual(['Renamed the Expenses screen to Today']);
    expect(out[0]).toMatchObject({ kind: 'renamed', category: 'text', impact: 'cosmetic', ids: ['home'] });
    expect(out[0].details).toEqual([{ name: 'Title', before: 'Expenses', after: 'Today' }]);
  });

  it('reports an added screen with its item count, without listing each item again', () => {
    const out = diff((s) => {
      s.screens.push({ id: 'reports', title: 'Reports', children: [
        { id: 'r_head', type: 'heading', label: 'Reports' },
        { id: 'r_total', type: 'stat', label: 'Total', expr: 'sum(expenses.amount)' },
      ] });
    });
    expect(texts(out)).toEqual(['Added the Reports screen with 2 items']);
    expect(out[0]).toMatchObject({ kind: 'added', category: 'structure', impact: 'behaviour' });
  });

  it('reports a removed screen once, not once per item', () => {
    const out = diff((s) => {
      s.screens = s.screens.filter((x) => x.id !== 'add');
      for (const a of Object.values(s.actions)) if (a.type === 'navigate') a.screen = 'home';
    });
    expect(texts(out).filter((t) => t.startsWith('Removed'))).toEqual(['Removed the Add expense screen']);
  });

  it('reports a reordered screen and a new first screen', () => {
    const out = diff((s) => { s.screens.reverse(); s.initialScreen = 'add'; });
    expect(texts(out)).toContain('Moved the Expenses screen to position 2');
    expect(texts(out)).toContain('Changed the first screen to Add expense');
  });

  it('reports a screen that starts saving into another set of entries', () => {
    const base = fixture('kirana-credit-book');
    const out = describeSpecChanges(base, edited(base, (s) => {
      s.collections.notes = { fields: { body: { type: 'text', label: 'Body' } } };
      screen(s, 'add').form = 'notes';
    }));
    expect(texts(out).some((t) => /^Connected the New entry screen to Notes instead of Entries$/.test(t))).toBe(true);
  });
});

describe('describeSpecChanges: components', () => {
  it('names an added component and the screen it went on', () => {
    const out = diff((s) => {
      screen(s, 'add').children.push({ id: 'phone_input', type: 'textInput', label: 'Phone', field: 'note' });
    });
    expect(texts(out)).toEqual(['Added the Phone text box to the Add expense screen']);
  });

  it('names a removed component', () => {
    const out = diff((s) => { screen(s, 'home').children = screen(s, 'home').children.filter((c) => c.id !== 'all_total'); });
    expect(texts(out)).toEqual(['Removed the Spent in total number from the Expenses screen']);
  });

  it('reports a label change as a rename', () => {
    const out = diff((s) => { (screen(s, 'home').children[3] as { label: string }).label = 'New one'; });
    expect(texts(out)).toEqual(['Renamed the Add expense button to New one']);
    expect(out[0].category).toBe('text');
  });

  it('reports hiding and showing', () => {
    const hidden = diff((s) => { screen(s, 'home').children[3].visible = false; });
    expect(texts(hidden)).toEqual(['Hid the Add expense button']);
    const base = edited(expenses(), (s) => { screen(s, 'home').children[3].visible = false; });
    expect(texts(describeSpecChanges(base, expenses()))).toEqual(['Showed the Add expense button']);
  });

  it('describes a formula change in plain words', () => {
    const out = diff((s) => {
      (screen(s, 'home').children[1] as { expr: string }).expr = 'sum(filter(expenses, month(date) == month(today)).amount)';
    });
    expect(texts(out)).toEqual(['The Spent in total number now adds up Amount for this month']);
    expect(out[0]).toMatchObject({ category: 'logic', impact: 'behaviour' });
  });

  it('describes the where shorthand and conditions', () => {
    const out = diff((s) => {
      (screen(s, 'home').children[1] as { expr: string }).expr = "sum(expenses.amount where category == 'Food' && amount > 100)";
    });
    expect(texts(out)).toEqual(['The Spent in total number now adds up Amount where Category is Food and Amount is more than 100']);
  });

  it('falls back to a safe sentence for calculations it does not recognise', () => {
    const out = diff((s) => {
      (screen(s, 'home').children[1] as { expr: string }).expr = 'round(sum(expenses.amount) / 3 + len(concat(1, 2)), 2)';
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/^The Spent in total number now (works out|adds)/);
  });

  it('describes a list filter', () => {
    const out = diff((s) => { (screen(s, 'home').children[2] as { filter?: string }).filter = 'date == today'; });
    expect(texts(out)).toEqual(['The Expenses list now shows only entries for today']);
    const cleared = describeSpecChanges(edited(expenses(), (s) => { (screen(s, 'home').children[2] as { filter?: string }).filter = 'date == today'; }), expenses());
    expect(texts(cleared)).toEqual(['The Expenses list now shows all entries']);
  });

  it('groups other property changes per category', () => {
    const out = diff((s) => {
      const list = screen(s, 'home').children[2] as { emptyText?: string; limit?: number; allowDelete?: boolean };
      list.emptyText = 'Nothing here';
      list.limit = 20;
    });
    expect(texts(out).sort()).toEqual([
      'Changed the empty message of the Expenses list',
      'Changed the item limit of the Expenses list',
    ]);
    expect(out.find((e) => e.category === 'text')).toMatchObject({
      impact: 'cosmetic',
      details: [{ name: 'Empty message', before: 'Nothing spent yet', after: 'Nothing here' }],
    });
    expect(out.find((e) => e.category === 'structure')?.impact).toBe('behaviour');
  });

  it('reports a move up or down on the same screen', () => {
    const out = diff((s) => {
      const kids = screen(s, 'home').children;
      kids.unshift(kids.pop()!);
    });
    expect(texts(out)).toEqual(['Moved the Add expense button up on the Expenses screen']);
  });

  it('reports a component moved to another screen', () => {
    const out = diff((s) => {
      const c = screen(s, 'home').children.pop()!;
      screen(s, 'add').children.push(c);
    });
    expect(texts(out)).toEqual(['Moved the Add expense button from the Expenses screen to the Add expense screen']);
  });

  it('reports a component that changed type', () => {
    const out = diff((s) => {
      screen(s, 'add').children[1] = { id: 'note_input', type: 'text', label: 'Note' };
    });
    expect(texts(out)).toEqual(['Changed the Note text box into a text']);
  });
});

describe('describeSpecChanges: collections and fields', () => {
  it('reports an added field', () => {
    const out = diff((s) => { s.collections.expenses.fields.paid_to = { type: 'text', label: 'Paid to' }; });
    expect(texts(out)).toEqual(['Added the Paid to field to Expenses']);
    expect(out[0]).toMatchObject({ category: 'data', impact: 'behaviour' });
  });

  it('flags a removed field as a data change and says the saved values stay', () => {
    const out = diff((s) => { delete s.collections.expenses.fields.note; });
    expect(out).toHaveLength(1);
    expect(out[0].impact).toBe('data');
    expect(out[0].text).toBe('Removed the Note field from Expenses. Values you already saved stay on this device');
  });

  it('flags a field type change as a data change', () => {
    const out = diff((s) => { s.collections.expenses.fields.amount = { type: 'text', label: 'Amount' }; });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'data', impact: 'data', kind: 'changed' });
    expect(out[0].text).toBe('Changed the Amount field in Expenses from a number to text');
  });

  it('reports a field rename by id', () => {
    const out = diff((s) => { s.collections.expenses.fields.amount.label = 'Cost'; });
    expect(texts(out)).toEqual(['Renamed the Amount field to Cost']);
    expect(out[0].impact).toBe('cosmetic');
  });

  it('reports added and removed choices, and a removed choice counts as a data change', () => {
    const out = diff((s) => {
      const f = s.collections.expenses.fields.category;
      if (f.type === 'enum') f.options = ['Food', 'Rent', 'Other'];
    });
    expect(texts(out)).toEqual([
      'Added Rent to the Category choices',
      'Removed Travel, Bills and Shopping from the Category choices. Entries already saved are not changed',
    ]);
    expect(out.map((e) => e.impact)).toEqual(['behaviour', 'data']);
  });

  it('reports required, range and starting value changes', () => {
    const out = diff((s) => {
      const f = s.collections.expenses.fields.amount;
      f.required = false;
      if (f.type === 'number') { f.max = 5000; f.defaultValue = 10; }
    });
    expect(texts(out)).toEqual([
      'The Amount field is no longer required',
      'Changed the allowed range of the Amount field in Expenses',
      'Changed the starting value of the Amount field in Expenses',
    ]);
  });

  it('reports a new set of entries and a removed one', () => {
    const added = diff((s) => { s.collections.notes = { label: 'Notes', fields: { body: { type: 'text', label: 'Body' } } }; });
    expect(texts(added)).toEqual(['Started keeping Notes with 1 field']);
    const base = edited(expenses(), (s) => { s.collections.notes = { label: 'Notes', fields: { body: { type: 'text', label: 'Body' } } }; });
    const removed = describeSpecChanges(base, expenses());
    expect(removed[0].impact).toBe('data');
    expect(removed[0].text).toBe('Stopped keeping Notes in the design. Entries you already saved stay on this device');
  });
});

describe('describeSpecChanges: actions, voice and AI steps', () => {
  it('describes a new action in words', () => {
    const out = diff((s) => { s.actions.go_home = { type: 'navigate', screen: 'home' }; });
    expect(texts(out)).toEqual(['Added the Go home action, which opens the Expenses screen']);
  });

  it('describes a changed and a removed action', () => {
    const changed = diff((s) => { s.actions.save_expense = { type: 'insert', collection: 'expenses', then: { navigate: 'home' } }; });
    expect(texts(changed)).toEqual(['The Save expense action now saves a new expense and goes to the Expenses screen']);
    const removed = diff((s) => { delete s.actions.suggest_category; delete s.aiBlocks.categorise; screen(s, 'add').children = screen(s, 'add').children.filter((c) => c.id !== 'suggest_button'); });
    expect(texts(removed)).toContain('Removed the Suggest category action');
  });

  it('reports voice phrases', () => {
    const out = diff((s) => { s.intents.go_add = ['add expense', 'new expense', 'kharcha likho']; });
    expect(texts(out)).toEqual(['Added 1 voice phrase for Go add: “new expense”']);
  });

  it('reports AI step changes without copying the instructions', () => {
    const out = diff((s) => {
      const b = s.aiBlocks.categorise;
      if (b.kind === 'classify') { b.prompt = 'A much longer secret prompt text.'; b.labels = ['Food', 'Other']; }
    });
    expect(texts(out)).toEqual(['Changed the instructions and labels of the Categorise AI step']);
    expect(JSON.stringify(out)).not.toContain('secret prompt');
  });

  it('reports a new check result as a cosmetic change', () => {
    const out = diff((s) => {
      const b = s.aiBlocks.categorise;
      b.verified = 'cloudPreferred';
      b.verification = { status: 'cloudPreferred', testCount: 5, passCount: 4 };
    });
    expect(texts(out)).toEqual(['The Categorise AI step is now marked as works best online (4 of 5 checks passed)']);
    expect(out[0].impact).toBe('cosmetic');
  });

  it('reports an added AI step', () => {
    const out = diff((s) => {
      s.aiBlocks.summarise_note = { kind: 'summarise', prompt: 'Summarise.', verified: 'unverified', inputField: 'note', outputField: 'note', maxWords: 30 };
    });
    expect(texts(out)).toEqual(['Added the Summarise note AI step, which summarises note in up to 30 words']);
  });
});

describe('describeSpecChanges: look and app settings', () => {
  it('names colours in everyday words', () => {
    expect(colourName('#1F6F5C')).toMatch(/green/);
    expect(colourName('#000000')).toBe('black');
    expect(colourName('#FFFFFF')).toBe('white');
    expect(colourName('#FBF6EC')).toBe('cream');
    expect(colourName('#808080')).toBe('grey');
    expect(colourName('not a colour')).toBe('not a colour');
  });

  it('reports the main colour change with before and after', () => {
    const out = diff((s) => { s.theme.primary = '#1E40AF'; });
    expect(out[0].text).toBe('Changed the main colour from dark green to blue');
    expect(out[0]).toMatchObject({ category: 'look', impact: 'cosmetic' });
    expect(out[0].details?.[0].before).toMatch(/#1F6F5C/);
  });

  it('collapses a preset switch into one line with colour rows', () => {
    const out = diff((s) => {
      s.theme = { ...s.theme, preset: 'warm_paper', primary: '#8A4B14', secondary: '#C98A3E', background: '#FBF6EC', surface: '#FFFFFF' };
    });
    expect(texts(out)).toEqual(['Switched to the Warm paper look']);
    expect(out[0].details?.length).toBe(4);
  });

  it('reports corners, text size, spacing and font', () => {
    const out = diff((s) => { s.theme.radius = 4; s.theme.fontScale = 1.2; s.theme.spacing = 'spacious'; s.theme.fontFamily = 'serif'; });
    expect(texts(out)).toEqual([
      'Made the corners squarer', 'Made the text larger', 'Changed the spacing to spacious', 'Changed the font to a serif font',
    ]);
  });

  it('reports app name and language', () => {
    const out = diff((s) => { s.name = 'Kharcha'; s.lang = 'hi'; });
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe(`Renamed the app from ${expenses().name} to Kharcha`);
    expect(out[1]).toMatchObject({ text: 'Changed the app language from English to Hindi', category: 'settings', impact: 'behaviour' });
  });
});

describe('summarizeChanges', () => {
  const many = (n: number): ChangeEntry[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `k${i}`, kind: 'changed', category: 'look', impact: 'cosmetic', ids: [`x${i}`], text: `Changed thing ${i}`,
    }));

  it('says so when nothing changed', () => {
    expect(summarizeChanges([])).toBe('No changes');
  });

  it('keeps a single change as it is', () => {
    expect(summarizeChanges(many(1))).toBe('Changed thing 0');
  });

  it('joins a short list into one readable line', () => {
    expect(summarizeChanges(many(3))).toBe('Changed thing 0, changed thing 1 and changed thing 2');
  });

  it('collapses long lists', () => {
    expect(summarizeChanges(many(10))).toBe('Changed thing 0, changed thing 1, changed thing 2 and 7 more changes');
  });

  it('never ends with "and 1 more change"', () => {
    expect(summarizeChanges(many(4))).toBe('Changed thing 0, changed thing 1, changed thing 2 and changed thing 3');
  });

  it('puts changes that touch entries first and drops the second sentence', () => {
    const out = diff((s) => {
      s.theme.radius = 2;
      s.name = 'Kharcha';
      delete s.collections.expenses.fields.note;
      screen(s, 'add').children = screen(s, 'add').children.filter((c) => c.id !== 'note_input');
    });
    const line = summarizeChanges(out);
    expect(line.startsWith('Removed the Note field from Expenses')).toBe(true);
    expect(line).not.toContain('Values you already saved');
  });
});

describe('groupByCategory and labels', () => {
  it('groups in a fixed order and leaves empty groups out', () => {
    const out = diff((s) => { s.theme.radius = 2; s.name = 'Kharcha'; s.collections.expenses.fields.paid_to = { type: 'text', label: 'Paid to' }; });
    expect(groupByCategory(out).map((g) => g.category)).toEqual(['data', 'look', 'text']);
    expect(groupByCategory([])).toEqual([]);
  });

  it('has plain labels for every category and impact', () => {
    for (const label of [...Object.values(CATEGORY_LABELS), ...Object.values(IMPACT_LABELS)]) expect(label.length).toBeGreaterThan(2);
  });
});

describe('describePatch on real stored patches', () => {
  function stored(before: KalamSpec, after: KalamSpec): AppVersion {
    return createVersion(before.id, { version: 1, spec: before }, after, { summary: 'edit', source: 'edit' }, 2);
  }

  it('describes a theme and a rename patch from paths alone', () => {
    const before = expenses();
    const after = edited(before, (s) => { s.theme.primary = '#1E40AF'; screen(s, 'home').title = 'Today'; s.version = 2; s.meta.updatedAt = 5; });
    const v = stored(before, after);
    expect(v.kind).toBe('patch');
    const out = describePatch(v.patch!);
    expect(texts(out).sort()).toEqual(['Changed the main colour', 'Renamed screen 1 to Today']);
  });

  it('ignores bookkeeping paths', () => {
    const before = expenses();
    const v = stored(before, edited(before, (s) => { s.version = 2; s.meta.updatedAt = 7; }));
    expect(describePatch(v.patch!)).toEqual([]);
  });

  it('describes added and removed things from paths', () => {
    const before = expenses();
    const after = edited(before, (s) => {
      delete s.collections.expenses.fields.note;
      s.actions.go_home = { type: 'navigate', screen: 'home' };
      screen(s, 'home').children.push({ id: 'extra', type: 'text', label: 'Extra line' });
    });
    const out = describePatch(stored(before, after).patch!);
    expect(texts(out)).toEqual(expect.arrayContaining([
      'Removed the Note field from Expenses. Values you already saved stay on this device',
      'Added the Go home action',
      'Added the “Extra line” text to screen 1',
    ]));
    expect(out.find((e) => e.text.startsWith('Removed the Note'))?.impact).toBe('data');
  });

  it('gives the precise list when the base spec is passed', () => {
    const before = expenses();
    const after = edited(before, (s) => { s.collections.expenses.fields.amount = { type: 'text', label: 'Amount' }; });
    const out = describePatch(stored(before, after).patch!, before);
    expect(texts(out)).toEqual(['Changed the Amount field in Expenses from a number to text']);
    expect(out[0].impact).toBe('data');
  });

  it('falls back to path lines when the patch does not apply to the base', () => {
    const out = describePatch([{ op: 'replace', path: '/theme/primary', value: '#000000' }], fixture('gst-calculator'));
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('look');
    const broken = describePatch([{ op: 'replace', path: '/screens/9/title', value: 'Lost' }], fixture('gst-calculator'));
    expect(texts(broken)).toEqual(['Renamed screen 10 to Lost']);
  });
});

/** Builds `count` stored versions, each with its own timestamp. */
function history(count: number, at: (n: number) => number): { versions: AppVersion[]; specs: KalamSpec[] } {
  const versions: AppVersion[] = [];
  const specs: KalamSpec[] = [];
  let previous: { version: number; spec: KalamSpec } | undefined;
  for (let n = 1; n <= count; n++) {
    const s = edited(expenses(), (x) => {
      x.version = n;
      x.theme.radius = 10 + n;
      if (n >= 3) x.collections.expenses.fields.paid_to = { type: 'text', label: 'Paid to' };
      if (n >= 5) screen(x, 'home').title = 'Today';
    });
    versions.push(createVersion('app_test', previous, s, { summary: `Edit ${n}`, source: n === 1 ? 'create' : 'edit' }, at(n)));
    specs.push(s);
    previous = { version: n, spec: s };
  }
  return { versions, specs };
}
const day = (d: number, hour = 12) => new Date(2026, 10, d, hour).getTime();

describe('categorizeVersion and buildTimeline', () => {
  it('categorises a version from its stored patch and, when specs are known, exactly', () => {
    const { versions, specs } = history(5, (n) => day(20 + n));
    expect(categorizeVersion(versions[0])).toEqual(['structure']);
    expect(categorizeVersion(versions[1])).toEqual(['look']);
    expect(categorizeVersion(versions[2])).toEqual(['data', 'look']);
    expect(categorizeVersion(versions[4], { before: specs[3], after: specs[4] })).toEqual(['look', 'text']);
  });

  it('returns no categories when a snapshot says nothing about what changed', () => {
    const { versions } = history(12, (n) => day(n));
    expect(versions[10].kind).toBe('snapshot');
    expect(categorizeVersion(versions[10])).toEqual([]);
  });

  it('groups by day, newest first, with the current version marked', () => {
    const { versions } = history(5, (n) => (n <= 2 ? day(20, 9 + n) : n === 3 ? day(21) : day(23, n)));
    const days = buildTimeline(versions);
    expect(days.map((d) => d.key)).toEqual(['2026-11-23', '2026-11-21', '2026-11-20']);
    expect(days.map((d) => d.entries.map((e) => e.version))).toEqual([[5, 4], [3], [2, 1]]);
    const all = days.flatMap((d) => d.entries);
    expect(all.filter((e) => e.current).map((e) => e.version)).toEqual([5]);
    expect(days[0].start).toBe(new Date(2026, 10, 23).getTime());
  });

  it('fills each entry with event, categories, impact, headline and changes', () => {
    const { versions } = history(5, (n) => day(10 + n));
    const all = buildTimeline(versions).flatMap((d) => d.entries);
    const byVersion = (n: number) => all.find((e) => e.version === n)!;
    expect(byVersion(1)).toMatchObject({ event: 'created', categories: ['structure'], impact: undefined, headline: 'Edit 1' });
    expect(byVersion(3)).toMatchObject({ event: 'edited', categories: ['data', 'look'], impact: 'behaviour' });
    expect(byVersion(3).headline).toBe('Added the Paid to field to Expenses and made the corners rounder');
    expect(byVersion(5).changes?.map((c) => c.text)).toEqual(['Renamed the Expenses screen to Today', 'Made the corners rounder']);
  });

  it('shows a stored origin when there is one and never guesses', () => {
    const { versions } = history(2, (n) => day(n));
    const tagged = versions.map((v) => (v.version === 2 ? ({ ...v, origin: 'ai' } as AppVersion) : v));
    const all = buildTimeline(tagged).flatMap((d) => d.entries);
    expect(all.find((e) => e.version === 2)?.origin).toBe('ai');
    expect(all.find((e) => e.version === 1)?.origin).toBeUndefined();
  });

  it('marks a restore and keeps working when the oldest kept version has no predecessor', () => {
    const { versions } = history(4, (n) => day(n));
    const restored: AppVersion = { ...versions[3], version: 5, source: 'restore', summary: 'Restored version 2' };
    const kept = [versions[2], versions[3], restored].map((v, i) => (i === 0 ? { ...v, kind: 'snapshot' as const, snapshot: undefined } : v));
    const days = buildTimeline(versions.slice(0, 4).concat(restored));
    expect(days.flatMap((d) => d.entries).find((e) => e.version === 5)?.event).toBe('restored');
    expect(buildTimeline(kept)).toBeDefined();
  });

  it('copes with a broken chain without throwing', () => {
    const { versions } = history(4, (n) => day(n));
    const days = buildTimeline(versions.filter((v) => v.version !== 2));
    expect(days.flatMap((d) => d.entries)).toHaveLength(3);
  });

  it('returns an empty timeline for no versions', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('filters by category', () => {
    const { versions } = history(5, (n) => day(10 + n));
    const days = buildTimeline(versions);
    const data = filterTimeline(days, ['data']).flatMap((d) => d.entries.map((e) => e.version));
    expect(data).toEqual([3]);
    expect(filterTimeline(days, [])).toHaveLength(days.length);
    expect(filterTimeline(days, ['ai'])).toEqual([]);
  });

  it('diffs two stored versions both ways', () => {
    const { versions } = history(5, (n) => day(n));
    expect(texts(diffVersions(versions, 2, 5)!)).toEqual(
      expect.arrayContaining(['Added the Paid to field to Expenses', 'Renamed the Expenses screen to Today']),
    );
    expect(texts(diffVersions(versions, 5, 2)!)).toEqual(
      expect.arrayContaining(['Removed the Paid to field from Expenses. Values you already saved stay on this device']),
    );
    expect(diffVersions(versions, 2, 99)).toBeUndefined();
  });
});

describe('copy rules for generated lines', () => {
  const BANNED = /[—–!]/;
  const all = loadFixtures('valid').map((f) => f.json as unknown as KalamSpec);

  it('has no em dash, en dash or exclamation mark in any line between any two fixtures', () => {
    const lines: string[] = [];
    for (const a of all) {
      for (const b of all) {
        const out = describeSpecChanges(a, b);
        for (const e of out) {
          lines.push(e.text);
          for (const d of e.details ?? []) lines.push(d.name, d.before ?? '', d.after ?? '');
        }
        lines.push(summarizeChanges(out));
      }
    }
    expect(lines.length).toBeGreaterThan(200);
    expect(lines.filter((l) => BANNED.test(l))).toEqual([]);
  });

  it('gives every entry a unique key, valid category and impact, and ids', () => {
    for (const a of all) {
      for (const b of all) {
        const out = describeSpecChanges(a, b);
        expect(new Set(out.map((e) => e.key)).size).toBe(out.length);
        for (const e of out) {
          expect(Object.keys(CATEGORY_LABELS)).toContain(e.category);
          expect(Object.keys(IMPACT_LABELS)).toContain(e.impact);
          expect(e.ids.length).toBeGreaterThan(0);
          expect(e.text.length).toBeGreaterThan(5);
        }
      }
    }
  });

  it('has no banned characters in labels', () => {
    for (const label of [...Object.values(CATEGORY_LABELS), ...Object.values(IMPACT_LABELS)]) expect(label).not.toMatch(BANNED);
  });
});
