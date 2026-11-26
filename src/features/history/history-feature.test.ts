import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import type { AppVersion } from '@/core/contracts';
import { buildTimeline } from '@/core/history';
import type { KalamSpec } from '@/core/spec/schema';
import { cloneSpec, createVersion } from '@/core/versioning';
import { copy } from './copy';
import { formatClock, formatDayHeading, formatWhen, startOfDay } from './format';
import { entryLines, versionDiff } from './model';

const BANNED = /[—–!]/;

function everyString(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') out.push(String((value as (n: number) => string)(3)), String((value as (n: number) => string)(1)));
  else if (value && typeof value === 'object') for (const v of Object.values(value)) everyString(v, out);
  return out;
}

describe('history copy', () => {
  it('has no em dash, en dash or exclamation mark anywhere', () => {
    const lines = everyString(copy);
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.filter((l) => BANNED.test(l))).toEqual([]);
  });

  it('avoids hype and filler words', () => {
    const joined = everyString(copy).join(' ').toLowerCase();
    for (const w of ['seamless', 'effortless', 'unlock', 'empower', 'robust', 'magic', "let's"]) expect(joined).not.toContain(w);
  });

  it('says what the buttons do', () => {
    expect(copy.timeline.restore).toBe('Restore');
    expect(copy.changeList.title).toBe('Here is what will change');
    expect(copy.changeList.count(1)).toBe('1 change');
    expect(copy.changeList.count(4)).toBe('4 changes');
  });
});

describe('format', () => {
  const noon = (d: number, m = 10, y = 2026) => new Date(y, m, d, 12).getTime();

  it('finds the start of a local day', () => {
    expect(startOfDay(noon(24))).toBe(new Date(2026, 10, 24).getTime());
  });

  it('says Today and Yesterday, then a short date', () => {
    const now = noon(24);
    expect(formatDayHeading(startOfDay(now), now, 'en')).toBe('Today');
    expect(formatDayHeading(startOfDay(noon(23)), now, 'en')).toBe('Yesterday');
    expect(formatDayHeading(startOfDay(noon(12)), now, 'en-GB')).toBe('12 Nov');
    expect(formatDayHeading(startOfDay(noon(12, 10, 2025)), now, 'en-GB')).toContain('2025');
  });

  it('finds Yesterday across a month boundary', () => {
    const now = noon(1, 11);
    expect(formatDayHeading(startOfDay(noon(30, 10)), now, 'en')).toBe('Yesterday');
  });

  it('formats a clock time and a date with time, and survives a bad language tag', () => {
    expect(formatClock(noon(24), 'en-GB')).toMatch(/12:00/);
    expect(formatWhen(noon(24), 'en-GB')).toMatch(/24 Nov/);
    expect(() => formatClock(noon(24), 'not a language')).not.toThrow();
    expect(() => formatWhen(noon(24), '???')).not.toThrow();
  });
});

const fixture = (name: string) => loadFixture('valid', name) as unknown as KalamSpec;

function build(): { versions: AppVersion[]; specs: KalamSpec[] } {
  const versions: AppVersion[] = [];
  const specs: KalamSpec[] = [];
  let previous: { version: number; spec: KalamSpec } | undefined;
  const make = (n: number, edit: (s: KalamSpec) => void, summary: string, source: AppVersion['source']) => {
    const s = cloneSpec(previous?.spec ?? fixture('expense-tracker'));
    s.version = n;
    edit(s);
    versions.push(createVersion('app_test', previous, s, { summary, source }, new Date(2026, 10, 20 + n, 12).getTime()));
    specs.push(s);
    previous = { version: n, spec: s };
  };
  make(1, () => undefined, 'Created from your description', 'create');
  make(2, (s) => { s.theme.radius = 4; }, 'Make the corners squarer', 'edit');
  make(3, (s) => { delete s.collections.expenses.fields.note; }, 'Removed the note', 'edit');
  make(4, (s) => { s.theme.primary = '#1E40AF'; }, 'Changed the main colour from dark green to blue', 'edit');
  return { versions, specs };
}

describe('entryLines', () => {
  it('shows the saved summary and adds the generated line when it says more', () => {
    const { versions } = build();
    const entry = (n: number) => buildTimeline(versions).flatMap((d) => d.entries).find((e) => e.version === n)!;
    expect(entryLines(entry(2))).toEqual({ primary: 'Make the corners squarer', secondary: 'Made the corners squarer' });
    expect(entryLines(entry(4))).toEqual({ primary: 'Changed the main colour from dark green to blue' });
    expect(entryLines(entry(1))).toEqual({ primary: 'Created from your description' });
  });

  it('falls back to the generated line when nothing was saved', () => {
    expect(entryLines({ summary: ' ', headline: 'Made the text larger', changes: [] })).toEqual({ primary: 'Made the text larger' });
  });
});

describe('versionDiff', () => {
  it('explains what a version changed and what restoring it would change', () => {
    const { versions } = build();
    const d = versionDiff(versions, 2, 4);
    expect(d.isCurrent).toBe(false);
    expect(d.made).toEqual([expect.objectContaining({ text: 'Made the corners squarer' })]);
    expect(Array.isArray(d.restore) && d.restore.map((e) => e.text)).toEqual(expect.arrayContaining([
      'Added the Note field to Expenses',
      'Changed the main colour from blue to dark green',
    ]));
    expect(d.touchesEntries).toBe(false);
  });

  it('warns when restoring would remove a field that holds entries', () => {
    const { versions } = build();
    const d = versionDiff(versions, 3, 1);
    const back = versionDiff(versions, 1, 3);
    expect(back.touchesEntries).toBe(false);
    expect(d.touchesEntries).toBe(true);
    expect(d.restore).toEqual(expect.arrayContaining([expect.objectContaining({ impact: 'data' })]));
  });

  it('handles the current version and the earliest version', () => {
    const { versions } = build();
    const now = versionDiff(versions, 4, 4);
    expect(now).toMatchObject({ isCurrent: true, touchesEntries: false });
    expect(now.restore).toBeUndefined();
    expect(versionDiff(versions, 1, 4).made).toBe('earliest');
  });

  it('reports an unavailable version instead of throwing', () => {
    const { versions } = build();
    expect(versionDiff(versions.filter((v) => v.version !== 2), 3, 4).made).toBe('unavailable');
    expect(versionDiff(versions, 9, 4).restore).toBe('unavailable');
  });
});
