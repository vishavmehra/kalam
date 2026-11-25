import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import type { CreationStage, NormalizedInput } from '../contracts';
import { createApplicationPipeline, generateId } from './create-application';

const tailorIR = JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8'));
const text = (t: string): NormalizedInput => ({ text: t, modalities: ['text'], images: [] });

describe('generateId', () => {
  it('uses the app_xxxxxxxx format', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId('app')));
    for (const id of ids) expect(id).toMatch(/^app_[a-z0-9]{8}$/);
    expect(ids.size).toBe(50);
  });
});

describe('createApplicationPipeline — template route', () => {
  const simple = [
    ['calculator', 'Make me a calculator'],
    ['counter', 'A simple counter to count visitors'],
    ['checklist', 'checklist for my packing list'],
    ['expense_tracker', 'Make a simple application to record my daily expenses in rupees.'],
  ] as const;

  for (const [templateId, request] of simple) {
    it(`builds "${request}" from the ${templateId} template without cloud`, async () => {
      const ai = createFakeAI({ onDevice: 'unavailable', respond: () => ({ error: 'provider_error' }) });
      const stages: CreationStage[] = [];
      const res = await createApplicationPipeline({ ai })(text(request), { onStage: (s) => stages.push(s) });
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
      expect(res.route).toBe('template');
      expect(res.provider).toBe('deterministic');
      expect(res.spec?.meta).toMatchObject({ source: 'template', templateId, generator: { route: 'deterministic' } });
      expect(res.spec?.id).toMatch(/^app_[a-z0-9]{8}$/);
      expect(res.understanding?.screens.length).toBeGreaterThan(0);
      expect(ai.cloudCalls()).toHaveLength(0);
      expect(ai.events).toContainEqual(expect.objectContaining({ route: 'template', success: true, taskType: 'create_app' }));
      expect(stages.at(-1)).toBe('done');
    });
  }

  it('lets Gemini Nano fill missing template params on device (never cloud)', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: (req) => {
        expect(req.mode).toBe('only_on_device');
        return { raw: { name: 'Ghar ka Kharcha', theme: 'ocean_blue', currency: 'INR', categories: ['Sabzi', 'Doodh', 'Bijli'] } };
      },
    });
    const res = await createApplicationPipeline({ ai })(text('I want to track my household expenses like vegetables, milk and electricity bills every day'));
    expect(res.ok).toBe(true);
    expect(ai.calls.map((c) => c.req.taskType)).toEqual(['extract_template_params']);
    expect(res.route).toBe('template+on_device');
    expect(res.provider).toBe('firebase');
    expect(res.model).toBe('gemini-nano');
    expect(res.spec?.name).toBe('Ghar ka Kharcha');
    expect(res.spec?.meta.generator).toMatchObject({ route: 'on_device', model: 'gemini-nano' });
    expect(ai.cloudCalls()).toHaveLength(0);
  });

  const householdRequest = 'I want to track my household expenses like vegetables, milk and electricity bills every day';
  const nanoParams = { raw: { name: 'Ghar ka Kharcha', theme: 'ocean_blue', currency: 'INR', categories: ['Sabzi'] } };

  it('announces the on-device stage just before the Nano call', async () => {
    const ai = createFakeAI({ onDevice: 'available', warm: true, respond: () => nanoParams });
    const stages: Array<[CreationStage, string | undefined]> = [];
    const res = await createApplicationPipeline({ ai })(text(householdRequest), { onStage: (s, d) => stages.push([s, d]) });
    expect(res.route).toBe('template+on_device');
    const onDevice = stages.findIndex(([s, d]) => s === 'extracting_params' && d === 'on_device');
    expect(onDevice).toBeGreaterThan(-1);
    expect(stages[onDevice + 1]?.[0]).toBe('validating');
  });

  it('never lets a slow Nano stall a template app (time-boxed, falls back to deterministic)', async () => {
    const ai = createFakeAI({ onDevice: 'available', warm: true, delayMs: 5_000, respond: () => nanoParams });
    const t0 = Date.now();
    const res = await createApplicationPipeline({ ai, onDeviceBudgetMs: 50 })(text(householdRequest));
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(res.ok).toBe(true);
    expect(res.route).toBe('template');
    expect(res.provider).toBe('deterministic');
    expect(res.spec?.meta.generator).toMatchObject({ route: 'deterministic' });
  });

  it('passes the deadline to the run as a time-out and an abort signal', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => nanoParams });
    await createApplicationPipeline({ ai })(text(householdRequest));
    const req = ai.calls[0]?.req;
    expect(req?.timeoutMs).toBeLessThanOrEqual(6_000);
    expect(req?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips a cold (not yet loaded) Nano entirely and warms it for next time', async () => {
    const ai = createFakeAI({ onDevice: 'available', warm: false, respond: () => nanoParams });
    const stages: Array<string | undefined> = [];
    const res = await createApplicationPipeline({ ai })(text(householdRequest), { onStage: (_s, d) => stages.push(d) });
    expect(res.route).toBe('template');
    expect(ai.calls).toHaveLength(0);
    expect(ai.warmUps).toBe(1);
    expect(stages).not.toContain('on_device');
  });

  it('skips Nano when it is only downloadable (no download is ever started)', async () => {
    const ai = createFakeAI({ onDevice: 'downloadable', respond: () => nanoParams });
    const res = await createApplicationPipeline({ ai })(text(householdRequest));
    expect(res.route).toBe('template');
    expect(ai.calls).toHaveLength(0);
    expect(ai.warmUps).toBe(0);
  });

  it('keeps deterministic params when Nano fails', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { nonsense: true } }) });
    const res = await createApplicationPipeline({ ai })(text('I want to track my household expenses like vegetables, milk and electricity bills every day'));
    expect(res.ok).toBe(true);
    expect(res.route).toBe('template');
    expect(ai.cloudCalls()).toHaveLength(0);
  });
});

describe('createApplicationPipeline — cloud route', () => {
  const tailor = 'A tailor shop app with customers and orders, measurements like chest waist sleeve, delivery dates, advance payment, and reading a photo of the measurement slip';

  it('sends complex requests to the Firebase cloud compiler', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: tailorIR }) });
    const res = await createApplicationPipeline({ ai })(text(tailor));
    expect(res.classification.complexity).not.toBe('simple');
    expect(res.ok).toBe(true);
    expect(res.route).toBe('cloud');
    expect(res.provider).toBe('firebase');
    expect(res.model).toBe('gemini-2.5-flash');
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].req).toMatchObject({ role: 'compiler' });
    expect(res.spec?.meta.generator).toMatchObject({ route: 'cloud', provider: 'firebase' });
    expect(res.understanding?.assumptions).toContain('Measurements are in inches.');
  });

  it('fails offline in plain language and preserves the input', async () => {
    const ai = createFakeAI({ online: false, respond: () => ({ raw: tailorIR }) });
    const input = text(tailor);
    const snapshot = structuredClone(input);
    const res = await createApplicationPipeline({ ai })(input);
    expect(res.ok).toBe(false);
    expect(res.spec).toBeUndefined();
    expect(res.message).toMatch(/offline/i);
    expect(res.clarifications?.length).toBeGreaterThan(0);
    expect(input).toEqual(snapshot);
    expect(ai.calls).toHaveLength(0);
    expect(ai.events).toContainEqual(expect.objectContaining({ success: false, errorCode: 'offline' }));
  });

  it('reports cloud consent refusal without an invalid spec', async () => {
    const ai = createFakeAI({ respond: () => ({ error: 'consent_denied' }) });
    const res = await createApplicationPipeline({ ai })(text(tailor));
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Settings/);
    expect(ai.calls).toHaveLength(1);
  });

  it('asks for input when nothing was given', async () => {
    const ai = createFakeAI();
    const res = await createApplicationPipeline({ ai })(text('   '));
    expect(res.ok).toBe(false);
    expect(res.clarifications).toBeDefined();
    expect(ai.calls).toHaveLength(0);
  });
});
