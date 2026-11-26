import { describe, expect, it } from 'vitest';
import { classifyRequest } from './index';
import { completeSpec } from '../compiler/complete';
import { instantiateTemplate } from '../templates';

describe('QA 2026-11-26', () => {
  it('a long plant log is not built from the generic Notes template', () => {
    const c = classifyRequest({ text: 'A plant watering log: plant name, last watered date and notes, and show how many plants I have.', modalities: ["text"], images: [] });
    expect(c.matchingTemplate).toBeUndefined();
    expect(c.requiresCloudReasoning).toBe(true);
  });
  it('a plain notes request still uses the template', () => {
    expect(classifyRequest({ text: 'A notes app', modalities: ["text"], images: [] }).matchingTemplate).toBe('notes');
  });
  it('completeSpec removes exclamation marks from messages', () => {
    const r = instantiateTemplate('notes', 'notes', { appId: 'app_qa000001', now: 1, lang: 'en' });
    if (!r.ok) throw new Error(r.error);
    const spec = structuredClone(r.value.spec);
    spec.actions.x = { type: 'feedback', message: 'Run saved successfully!' };
    const out = completeSpec(spec, { request: 'notes' }).spec;
    expect(JSON.stringify(out)).not.toContain('!');
  });
});
