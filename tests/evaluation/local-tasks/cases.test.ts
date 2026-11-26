import { describe, expect, it } from 'vitest';
import { LOCAL_GATES } from '@/core/ai/local-ready';
import { buildCases, LOCAL_CASE_TASKS } from './index';

describe('local-ready case sets (D07-031)', () => {
  it.each(LOCAL_CASE_TASKS)('%s has at least the cases its gate needs, each the real request of the app', async (task) => {
    const cases = await buildCases(task);
    expect(cases.length).toBeGreaterThanOrEqual(LOCAL_GATES[task].minCases);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.request.taskType).toBe(task);
      expect(c.request.system?.length ?? 0).toBeGreaterThan(40);
      expect(c.request.jsonSchema).toMatchObject({ type: 'object' });
      // The person's words are inside an untrusted block, never in the instructions.
      expect(c.request.prompt).toMatch(/<untrusted_/);
    }
  });

  it('judges a voice answer by action and fields, and calls an invented value invented', async () => {
    const cases = await buildCases('voice_action');
    const by = (id: string) => cases.find((c) => c.id === id)!;
    const answer = (action: string | null, fields: Record<string, unknown> = {}) => by('v03').request.parse({ action: action ?? 'none', fields, confidence: 'high' });
    const parsed = (r: ReturnType<typeof answer>) => (r.success ? r.data : undefined);
    expect(by('v03').judge(parsed(answer('save_order', { customer: 'Meena' }))!)).toBe('right');
    expect(by('v03').judge(parsed(answer('go_customers'))!)).toBe('wrong');
    expect(by('v03').judge(parsed(answer('save_order', { customer: 'Priya' }))!)).toBe('invented');
    // A command that is not about the app must come back as no action.
    const none = by('v19');
    expect(none.judge(none.request.parse({ action: 'none', fields: {}, confidence: 'low' }).success ? { action: null, fields: {}, confidence: 'low', source: 'on_device' } : {})).toBe('right');
    expect(none.judge({ action: 'save_order', fields: {}, confidence: 'high', source: 'on_device' })).toBe('invented');
  });

  it('judges summaries and translations, counting a number the text does not have as invented', async () => {
    const summaries = await buildCases('summarize');
    const s = summaries.find((c) => c.id === 's08')!;
    expect(s.judge({ notes: 'School ordered 40 grey and white uniforms at 450 each, required in three weeks.' })).toBe('right');
    expect(s.judge({ notes: 'School ordered 400 uniforms at 450 each.' })).toBe('invented');
    expect(s.judge({ notes: 'Something unrelated entirely.' })).toBe('wrong');
    const translations = await buildCases('translate');
    const es = translations.find((c) => c.id === 't01')!;
    expect(es.judge({ notes: 'Compra leche y pan mañana por la mañana.' })).toBe('right');
    expect(es.judge({ notes: 'Buy milk and bread tomorrow morning.' })).toBe('wrong');
    const ja = translations.find((c) => c.id === 't16')!;
    expect(ja.judge({ notes: 'カウンターで500円を払ってください。' })).toBe('right');
    expect(ja.judge({ notes: 'カウンターで800円を払ってください。' })).toBe('invented');
  });
});
