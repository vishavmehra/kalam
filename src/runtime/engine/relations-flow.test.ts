/**
 * The repaired eval apps (eval 2026-11-25) run through the real runtime path, not evaluateFormula by hand: a
 * customer's page lists and totals only that customer, going back from an entry's page keeps the customer, a
 * link prints the linked name, and a habit is ticked with one tap on its page.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { KalamRecord, RecordValue, RuntimeServices } from '@/core/contracts';
import { completeSpec } from '@/core/compiler/complete';
import type { ComponentOf, KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import {
  collectionValues, createMemoryStores, createRuntimeState, currentScreen, dispatchAction, evaluate, formatStat,
  formulaContext, getForm, goBack, isoDate, navigate, openRecord, queryList, selectedId, type DataSnapshot, type EngineEnv,
  type RuntimeState,
} from './index';
import { v11FieldText } from './v11';

const NOW = new Date(2026, 10, 25, 10, 0);
const FIXTURES: Array<{ id: string; request: string; spec: KalamSpec }> = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/compiler/eval-2026-11-25-built.json', import.meta.url), 'utf8'),
).cases;

function repaired(prefix: string): KalamSpec {
  const f = FIXTURES.find((c) => c.id.startsWith(`${prefix}-`))!;
  const v = validateSpec(completeSpec(validateSpec(f.spec).spec!, { request: f.request }).spec);
  if (!v.ok || !v.spec) throw new Error(`${prefix}: ${v.errors.map((e) => e.code).join(', ')}`);
  return v.spec;
}

const rec = (spec: KalamSpec, collectionId: string, id: string, values: Record<string, RecordValue>, at: number): KalamRecord =>
  ({ id, appId: spec.id, collectionId, createdAt: at, updatedAt: at, values });

function app(spec: KalamSpec, records: Record<string, KalamRecord[]>) {
  const stores = createMemoryStores(spec.id, { records });
  const services: RuntimeServices = {
    ...stores, runAIBlock: vi.fn(), pickImage: vi.fn(), confirm: vi.fn(async () => true), speak: vi.fn(), online: () => true,
  };
  const data: DataSnapshot = { records: {}, state: {} };
  const reload = async () => {
    data.records = await stores.records.listAll(spec.id);
  };
  const env = (): EngineEnv => ({ spec, appId: spec.id, services, data, now: NOW });
  /** What the screen shows, built the way KalamRuntime builds it. */
  const view = (state: RuntimeState) => {
    const screen = currentScreen(spec, state);
    const ctx = formulaContext(collectionValues(spec, data.records), getForm(spec, state, screen, NOW), {}, NOW, selectedId(spec, state));
    const stat = (re: RegExp) => {
      const c = screen.children.find((k): k is ComponentOf<'stat'> => k.type === 'stat' && re.test(k.label));
      if (!c) throw new Error(`no stat ${re} on ${screen.id}`);
      return evaluate(c.expr, ctx);
    };
    const list = (source: string) => {
      const c = screen.children.find((k): k is ComponentOf<'list'> => k.type === 'list' && k.source === source)!;
      return { c, rows: queryList(c, data.records[source] ?? [], ctx).rows };
    };
    return { screen, stat, list };
  };
  return { env, reload, data, view };
}

describe('per-owner pages in the runtime (s07)', () => {
  const spec = repaired('s07');
  const seed = () => ({
    customers: [rec(spec, 'customers', 'c1', { name: 'Ramesh' }, 1), rec(spec, 'customers', 'c2', { name: 'Sita' }, 2)],
    entries: [
      rec(spec, 'entries', 'e1', { customer: 'c1', amount: 500, is_payment: false }, 3),
      rec(spec, 'entries', 'e2', { customer: 'c1', amount: 200, is_payment: true }, 4),
      rec(spec, 'entries', 'e3', { customer: 'c2', amount: 900, is_payment: false }, 5),
      rec(spec, 'entries', 'e4', { amount: 70, is_payment: false }, 6),
    ],
  });

  it('a customer\'s page lists and totals only that customer, before and after an entry\'s page was open', async () => {
    const a = app(spec, seed());
    await a.reload();
    const home = currentScreen(spec, createRuntimeState(spec));
    const customers = home.children.find((k): k is ComponentOf<'list'> => k.type === 'list' && k.source === 'customers')!;
    let state = openRecord(spec, createRuntimeState(spec), customers, a.data.records.customers[0], NOW)!;
    expect(selectedId(spec, state)).toBe('c1');
    let page = a.view(state);
    expect(page.list('entries').rows.map((r) => r.id).sort()).toEqual(['e1', 'e2']);
    expect(page.stat(/balance/i)).toEqual({ ok: true, value: 300 });

    // Open one of Ramesh's entries, then Back: the page is about Ramesh again.
    const entries = page.list('entries');
    if (entries.c.detailScreen) {
      state = openRecord(spec, state, entries.c, entries.rows[0], NOW)!;
      expect(selectedId(spec, state)).toBe(entries.rows[0].id);
      state = goBack(state);
    } else {
      state = navigate(spec, navigate(spec, state, spec.screens.find((s) => s.form === 'entries')!.id)!, page.screen.id)!;
    }
    page = a.view(state);
    expect(selectedId(spec, state)).toBe('c1');
    expect(page.list('entries').rows).toHaveLength(2);
    expect(page.stat(/balance/i)).toEqual({ ok: true, value: 300 });
    const save = page.screen.children.find((k) => k.type === 'bigButton' && spec.actions[k.action]?.type === 'update');
    if (save && save.type === 'bigButton') {
      const r = await dispatchAction(a.env(), state, save.action);
      expect(r.error).toBeUndefined();
    }
  });

  it('an entry added from a customer\'s page belongs to that customer, and lists print the name, not the id', async () => {
    const a = app(spec, seed());
    await a.reload();
    const home = currentScreen(spec, createRuntimeState(spec));
    const customers = home.children.find((k): k is ComponentOf<'list'> => k.type === 'list' && k.source === 'customers')!;
    let state = openRecord(spec, createRuntimeState(spec), customers, a.data.records.customers[1], NOW)!;
    const add = spec.screens.find((s) => s.form === 'entries' && s.children.some((k) => k.type === 'bigButton' && spec.actions[k.action]?.type === 'insert'))!;
    state = navigate(spec, state, add.id)!;
    expect(getForm(spec, state, add, NOW).customer).toBe('c2');
    expect(v11FieldText(spec, 'entries', 'customer', 'c2', a.data.records)).toBe('Sita');
  });
});

describe('habits are ticked in one tap (s21)', () => {
  it('"Done today" on a habit\'s page adds today\'s check-in for that habit, and the streak counts it', async () => {
    const spec = repaired('s21');
    const a = app(spec, { habits: [rec(spec, 'habits', 'h1', { name: 'Walk' }, 1), rec(spec, 'habits', 'h2', { name: 'Read' }, 2)] });
    await a.reload();
    const today = currentScreen(spec, createRuntimeState(spec));
    const habits = today.children.find((k): k is ComponentOf<'list'> => k.type === 'list' && k.source === 'habits')!;
    const state = openRecord(spec, createRuntimeState(spec), habits, a.data.records.habits[0], NOW)!;
    const tick = currentScreen(spec, state).children.find((k) => k.type === 'bigButton' && k.label === 'Done today');
    expect(tick).toBeDefined();
    const r = await dispatchAction(a.env(), state, (tick as ComponentOf<'bigButton'>).action);
    expect(r.ok).toBe(true);
    // The habit's page keeps the habit's own values in its inputs.
    expect(getForm(spec, r.state, currentScreen(spec, r.state), NOW).name).toBe('Walk');
    await a.reload();
    expect(a.data.records.checkins.map((c) => c.values)).toEqual([{ habit: 'h1', date: isoDate(NOW), done: true }]);
    expect(a.view(r.state).stat(/streak/i)).toEqual({ ok: true, value: 1 });
    const home = a.view(createRuntimeState(spec));
    const done = home.screen.children.find((k): k is ComponentOf<'stat'> => k.type === 'stat')!;
    expect(formatStat(done, home.stat(new RegExp(done.label)), 'en')).toBe('1');
  });
});
