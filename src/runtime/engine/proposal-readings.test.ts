import { describe, expect, it, vi } from 'vitest';
import type { AIExecutionResult, RecordValue, RuntimeServices } from '@/core/contracts';
import { kalamSpecSchema } from '@/core/spec/schema';
import { createMemoryStores, createRuntimeState, navigate, runAIBlockFlow, type AIProposal, type EngineEnv } from './index';

const NOW = new Date(2026, 10, 25, 10, 0);
const spec = kalamSpecSchema.parse({
  id: 'app_slips', schemaVersion: '1.0.0', version: 1, name: 'Slips', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: { orders: { label: 'Orders', fields: { customer: { type: 'text', label: 'Customer' }, chest: { type: 'number', label: 'Chest', min: 20, max: 80 } } } },
  screens: [{
    id: 'home', title: 'Slips', form: 'orders', children: [
      { id: 'customer_in', type: 'textInput', label: 'Customer', field: 'customer' },
      { id: 'chest_in', type: 'number', label: 'Chest', field: 'chest' },
    ],
  }],
  initialScreen: 'home',
  actions: {},
  aiBlocks: { slip: { kind: 'extractFromPhoto', prompt: 'Read the slip.', verified: 'cloudPreferred', target: 'orders' } },
  intents: {},
  meta: { createdAt: 0 },
});

async function propose(result: Partial<AIExecutionResult<Record<string, RecordValue>>>): Promise<AIProposal> {
  const services: RuntimeServices = {
    ...createMemoryStores(spec.id),
    runAIBlock: vi.fn(async (): Promise<AIExecutionResult<Record<string, RecordValue>>> => ({
      success: true, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false, ...result,
    })),
    pickImage: vi.fn(async () => ({ mimeType: 'image/jpeg' as const, base64: 'AAAA' })),
    confirm: vi.fn(async () => true), speak: vi.fn(), online: () => true,
  };
  const env: EngineEnv = { spec, appId: spec.id, services, data: { records: {}, state: {} }, now: NOW };
  const r = await runAIBlockFlow(env, navigate(spec, createRuntimeState(spec), 'home')!, 'slip');
  const effect = r.effects.find((e) => e.type === 'aiProposal');
  if (effect?.type !== 'aiProposal') throw new Error('no proposal');
  return effect.proposal;
}

describe('a photo proposal carries what the reader was unsure of (docs/16 R-016)', () => {
  it('passes confidence and unsure fields for the fields that were filled', async () => {
    const p = await propose({
      output: { customer: 'Raju', chest: 40 },
      uncertainFields: ['chest', 'ghost'],
      fieldReadings: { customer: { confidence: 'high', area: 'top_left' }, chest: { confidence: 'low' }, ghost: { confidence: 'low' } },
    });
    expect(p.uncertain).toEqual(['chest']);
    expect(p.readings).toEqual({ customer: { confidence: 'high', area: 'top_left' }, chest: { confidence: 'low' } });
  });

  it('drops notes for a field that failed validation, and adds nothing when the model gave none', async () => {
    const p = await propose({ output: { customer: 'Raju', chest: 400 }, uncertainFields: ['chest'], fieldReadings: { chest: { confidence: 'low' } } });
    expect(p.rejected.map((r) => r.field)).toEqual(['chest']);
    expect(p.uncertain).toBeUndefined();
    expect(p.readings).toBeUndefined();
    expect('uncertain' in (await propose({ output: { customer: 'Raju' } }))).toBe(false);
  });
});
