import { describe, expect, it } from 'vitest';
import type { KalamSpec } from '@/core/spec/schema';
import { getTemplate, listTemplates } from '@/core/templates';
import { runtimeSmoke, sampleRecords } from './runtime-smoke';

function build(id: string): KalamSpec {
  const t = getTemplate(id as never);
  if (!t) throw new Error(`no template ${id}`);
  return t.build(t.defaults as never, { appId: 'app_smoke_test', now: 0, lang: 'en' });
}

describe('runtimeSmoke', () => {
  it('runs the formulas and list filters of every default template app without error', () => {
    for (const t of listTemplates()) {
      const r = runtimeSmoke(build(t.id));
      expect(r.failed, t.id).toEqual([]);
      expect(r.ok, t.id).toBe(true);
    }
  });

  it('evaluates something for apps that have stats and lists', () => {
    expect(runtimeSmoke(build('expense_tracker')).evaluated).toBeGreaterThan(4);
    expect(runtimeSmoke(build('calculator')).evaluated).toBeGreaterThan(0);
  });

  it('reports a formula that cannot run, naming the screen and component', () => {
    const spec = build('counter');
    const screen = spec.screens[0];
    if (!screen) throw new Error('no screen');
    const broken: KalamSpec = {
      ...spec,
      screens: [
        {
          ...screen,
          children: [...screen.children, { id: 'bad_stat', type: 'stat', label: 'Broken', expr: 'nope(1)' } as never],
        },
        ...spec.screens.slice(1),
      ],
    };
    const r = runtimeSmoke(broken);
    expect(r.ok).toBe(false);
    expect(r.failed.join(' ')).toMatch(new RegExp(`${screen.id}\\.bad_stat on empty data`));
  });
});

describe('sampleRecords', () => {
  it('makes one typed record per collection', () => {
    const spec = build('inventory');
    const recs = sampleRecords(spec);
    expect(Object.keys(recs)).toEqual(Object.keys(spec.collections));
    const row = recs.products?.[0]?.values ?? {};
    expect(typeof row.name).toBe('string');
    expect(typeof row.qty).toBe('number');
    expect(row.date === undefined || typeof row.date === 'string').toBe(true);
  });
});
