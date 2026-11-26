import { describe, expect, it } from 'vitest';
import { evaluateFormula } from '../../formula';
import { kalamSpecSchema, LIMITS, type KalamComponent, type KalamSpec } from '../../spec/schema';
import { validateSpec } from '../../spec/validate';
import { HEALTH_NOTES, listCatalog, resolveSample, sampleProblems, SHOWCASE_IDS, instantiateCatalogEntry } from './index';

const OPTS = { appId: 'app_gallery-1', now: 1_794_950_000_000, lang: 'en' };
const NOW = new Date(2026, 10, 18, 10, 30); // 18 Nov 2026, local time: the same day for every assertion
const entries = listCatalog();

const components = (spec: KalamSpec): KalamComponent[] => spec.screens.flatMap((s) => s.children);

describe('every gallery template', () => {
  it('has unique, short, well-formed ids', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-z0-9_]{2,39}$/);
  });

  it('includes the five showcase apps of docs/14 §12.3 and the extra templates it lists', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of SHOWCASE_IDS) expect(ids.has(id), id).toBe(true);
    for (const id of [
      'attendance_register', 'expense_tracker', 'inventory_manager', 'daily_task_list', 'customer_followup_book',
      'household_budget', 'student_progress',
    ]) expect(ids.has(id), id).toBe(true);
  });

  for (const e of entries) {
    describe(e.id, () => {
      const spec = e.build(OPTS);

      it('passes the schema and the validator with no errors', () => {
        const structural = kalamSpecSchema.safeParse(spec);
        expect(structural.success, structural.success ? '' : structural.error.message).toBe(true);
        const result = validateSpec(spec);
        expect(result.errors, JSON.stringify(result.errors, null, 1)).toEqual([]);
        expect(result.warnings.map((w) => `${w.code} ${w.path}`), 'warnings').toEqual([]);
      });

      it('is an independent template app with honest metadata', () => {
        expect(spec.id).toBe(OPTS.appId);
        expect(spec.meta.source).toBe('template');
        expect(spec.meta.templateId).toBe(e.id);
        expect(spec.meta.author).toBe(e.author);
        expect(spec.meta.basedOn).toBeUndefined();
        expect(spec.meta.generator?.route).toBe('deterministic');
        expect(Object.keys(spec.aiBlocks)).toEqual([]);
        expect(e.requiredAI).toEqual([]);
        expect(spec.accessibility?.summary).toBe(e.accessibility.summary);
        expect(spec.initialScreen).toBe(spec.screens[0]?.id);
        expect(spec.screens.length).toBeLessThanOrEqual(LIMITS.screens);
        expect(JSON.stringify(spec).length).toBeLessThan(100_000);
      });

      it('is named as the gallery names it, on the shelf and on its first screen', () => {
        expect(spec.name).toBe(e.title);
        expect(spec.screens[0]?.title).toBe(e.title);
      });

      it('a name chosen while installing is also the first screen heading, and nothing else changes', () => {
        const r = instantiateCatalogEntry(e.id, OPTS, { name: 'Branch One' });
        expect(r.ok && r.value.spec.name).toBe('Branch One');
        expect(r.ok && r.value.spec.screens[0]?.title).toBe('Branch One');
        expect(r.ok && r.value.spec.screens.slice(1)).toEqual(spec.screens.slice(1));
      });

      it('has unique component ids and in-range counts', () => {
        const ids = components(spec).map((c) => c.id);
        expect(new Set(ids).size, `duplicate ids in ${ids.join(',')}`).toBe(ids.length);
        for (const s of spec.screens) expect(s.children.length).toBeLessThanOrEqual(LIMITS.componentsPerScreen);
        for (const id of ids) expect(id.length).toBeLessThanOrEqual(48);
      });

      it('has voice phrases, each one on a single action, with Hindi among them', () => {
        const seen = new Map<string, string>();
        for (const [action, list] of Object.entries(spec.intents)) {
          expect(spec.actions[action], action).toBeDefined();
          expect(list.length).toBeLessThanOrEqual(LIMITS.intentPhrasesPerAction);
          for (const phrase of list) {
            const owner = seen.get(phrase.toLowerCase());
            expect(owner === undefined || owner === action, `"${phrase}" is on both ${owner} and ${action}`).toBe(true);
            seen.set(phrase.toLowerCase(), action);
          }
        }
        expect(/[ऀ-ॿ]/.test(Object.values(spec.intents).flat().join(' ')), 'Devanagari phrase').toBe(true);
      });

      it('has sample entries that fit the app and nothing private', () => {
        expect(sampleProblems(e, spec, NOW)).toEqual([]);
        const text = JSON.stringify(e.sample);
        expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // no email addresses
        expect(text).not.toMatch(/\b\d{10}\b/); // no complete phone numbers
      });

      it('shows its sample data the same way every time', () => {
        expect(resolveSample(e, spec, NOW)).toEqual(resolveSample(e, spec, NOW));
      });

      it('evaluates every total on its sample data without an error', () => {
        const sample = resolveSample(e, spec, NOW);
        const collections = Object.fromEntries(Object.keys(spec.collections).map((id) => [id, (sample.records[id] ?? []).map((r) => r.values)]));
        for (const screen of spec.screens) {
          const form = spec.collections[screen.form ?? ''] ? (sample.records[screen.form as string]?.[0]?.id ?? null) : null;
          for (const c of screen.children) {
            if (c.type !== 'stat') continue;
            const r = evaluateFormula(c.expr, { collections, form: sample.form, state: sample.state, now: NOW, selected: form });
            expect(r.ok, `${c.id}: ${r.ok ? '' : r.error}`).toBe(true);
          }
        }
      });
    });
  }
});

describe('installing a template', () => {
  it('makes an independent, validated app and copies no example entries', () => {
    const r = instantiateCatalogEntry('kirana_credit_book', OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.spec.id).toBe('app_gallery-1');
    expect(r.value.origin).toEqual({ route: 'template', provider: 'deterministic', templateId: 'kirana_credit_book' });
    expect(JSON.stringify(r.value.spec)).not.toContain('Ramesh');
  });

  it('lets the name and theme change before saving', () => {
    const r = instantiateCatalogEntry('notes', OPTS, { name: '  My Diary ', theme: 'ocean_blue' });
    expect(r.ok && r.value.spec.name).toBe('My Diary');
    expect(r.ok && r.value.spec.theme.preset).toBe('ocean_blue');
    expect(r.ok && r.value.spec.icon?.background).toBe(r.ok ? r.value.spec.theme.primary : '');
  });

  it('refuses an empty or too long name and an unknown template', () => {
    expect(instantiateCatalogEntry('notes', OPTS, { name: '   ' }).ok).toBe(false);
    expect(instantiateCatalogEntry('notes', OPTS, { name: 'x'.repeat(61) }).ok).toBe(false);
    expect(instantiateCatalogEntry('nope', OPTS).ok).toBe(false);
  });

  it('says plainly that the health apps are not medical record systems', () => {
    for (const id of ['medicine_tracker', 'appointment_tracker', 'visit_register', 'followup_list']) {
      const r = instantiateCatalogEntry(id, OPTS);
      expect(r.ok, id).toBe(true);
      if (r.ok) for (const line of HEALTH_NOTES) expect(components(r.value.spec).some((c) => c.type === 'text' && c.label === line), id).toBe(true);
    }
    expect(HEALTH_NOTES.join(' ')).toMatch(/not a medical record system/);
  });
});
