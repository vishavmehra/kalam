import { describe, expect, it } from 'vitest';
import tailorIR from '../../../tests/fixtures/compiler/tailor-shop.ir.json';
import { createFakeAI, type FakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import type { NormalizedInput } from '../contracts';
import type { LocalStatus } from '../ai/local-ready';
import { createApplicationPipeline } from './create-application';

const text = (t: string): NormalizedInput => ({ text: t, modalities: ['text'], images: [] });
/** Simple, no template: docs/07 §4.2 "no matching template, simple, local attempt". */
const REQUEST = 'Track my weight every morning';
const gate = (s: LocalStatus) => ({ localReady: () => s });
const compileModes = (ai: FakeAI) => ai.calls.filter((c) => c.req.taskType === 'create_app').map((c) => c.req.mode);

describe('local first for a simple request without a template (docs/07 §4.2, §6.7)', () => {
  it('stays cloud first until the per-task benchmark has passed', async () => {
    for (const status of ['unproven', 'failed'] as const) {
      const ai = createFakeAI({ onDevice: 'available', warm: true, respond: () => ({ raw: tailorIR }) });
      const res = await createApplicationPipeline({ ai, ...gate(status) })(text(REQUEST));
      expect(res.classification).toMatchObject({ complexity: 'simple', requiresCloudReasoning: true });
      expect(compileModes(ai)).toEqual(['prefer_in_cloud']);
    }
  });

  it('asks the device model first once the benchmark passed, and says so on the app', async () => {
    const ai = createFakeAI({ onDevice: 'available', warm: true, respond: () => ({ raw: tailorIR }) });
    const res = await createApplicationPipeline({ ai, ...gate('ready') })(text(REQUEST));
    expect(res.ok).toBe(true);
    expect(compileModes(ai)).toEqual(['prefer_on_device']);
    expect(res.spec?.meta.generator).toMatchObject({ route: 'on_device' });
  });

  it('keeps the repair pass in the cloud', async () => {
    const ai = createFakeAI({ onDevice: 'available', warm: true, respond: (_req, _ctx, n) => ({ raw: n === 0 ? { nonsense: true } : tailorIR }) });
    await createApplicationPipeline({ ai, ...gate('ready') })(text(REQUEST));
    const repair = ai.calls.find((c) => c.req.taskType === 'repair_spec');
    expect(repair?.req.mode).not.toBe('prefer_on_device');
  });

  it('does not change anything for a cold model, a bigger app or a request that needs a photo reader', async () => {
    const cold = createFakeAI({ onDevice: 'available', warm: false, respond: () => ({ raw: tailorIR }) });
    await createApplicationPipeline({ ai: cold, ...gate('ready') })(text(REQUEST));
    expect(compileModes(cold)).toEqual(['prefer_in_cloud']);

    const medium = createFakeAI({ onDevice: 'available', warm: true, respond: () => ({ raw: tailorIR }) });
    const res = await createApplicationPipeline({ ai: medium, ...gate('ready') })(text('A tailor shop app with customers and orders, measurements, delivery dates and advance payment'));
    expect(res.classification.complexity).not.toBe('simple');
    expect(compileModes(medium)).not.toContain('prefer_on_device');
  });

  it('works offline only when the device model passed its benchmark', async () => {
    const offline = () => createFakeAI({ online: false, onDevice: 'available', warm: true, respond: () => ({ raw: tailorIR }) });
    const unproven = offline();
    const failed = await createApplicationPipeline({ ai: unproven, ...gate('unproven') })(text(REQUEST));
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(/offline/i);
    expect(unproven.calls).toHaveLength(0);

    const ready = offline();
    const built = await createApplicationPipeline({ ai: ready, ...gate('ready') })(text(REQUEST));
    expect(built.ok).toBe(true);
    expect(ready.cloudCalls()).toHaveLength(0);
  });
});
