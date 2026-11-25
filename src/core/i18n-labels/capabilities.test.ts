import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { validateSpec } from '../spec';
import type { KalamSpec } from '../spec/schema';
import { createDeviceLanguageRegistry, promptApiProbe } from './capabilities';
import { sensitiveKinds, sensitiveNotice } from './sensitive';

const load = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} is invalid`);
  return r.spec;
};

describe('on-device language registry', () => {
  it('knows only English without a probe, so no Indian language is claimed for Nano', async () => {
    const registry = createDeviceLanguageRegistry();
    expect(await registry.supports('en')).toBe(true);
    for (const code of ['hi', 'gu', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'pa']) expect(await registry.supports(code)).toBe(false);
    expect(await registry.supportsPair('en', 'hi')).toBe(false);
    expect(await registry.supportsPair('en', 'en')).toBe(false);
  });

  it('asks the probe once per language and trusts a yes only for that language', async () => {
    const probe = vi.fn(async (lang: string) => lang === 'hi');
    const registry = createDeviceLanguageRegistry({ probe });
    expect(await registry.supportsPair('en', 'hi')).toBe(true);
    expect(await registry.supportsPair('hi', 'en')).toBe(true);
    expect(await registry.supportsPair('en', 'ta')).toBe(false);
    await registry.supports('hi');
    expect(probe.mock.calls.filter(([l]) => l === 'hi')).toHaveLength(1);
    expect(probe).not.toHaveBeenCalledWith('en');
  });

  it('treats a throwing probe as not supported', async () => {
    const registry = createDeviceLanguageRegistry({ probe: async () => { throw new Error('boom'); } });
    expect(await registry.supports('hi')).toBe(false);
  });
});

describe('Prompt API probe', () => {
  it('asks the browser for that language as input and output, and needs "available"', async () => {
    const availability = vi.fn(async () => 'available');
    expect(await promptApiProbe(() => ({ availability }))('hi')).toBe(true);
    expect(availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['hi'] }],
      expectedOutputs: [{ type: 'text', languages: ['hi'] }],
    });
    expect(await promptApiProbe(() => ({ availability: async () => 'downloadable' }))('hi')).toBe(false);
    expect(await promptApiProbe(() => ({ availability: async () => 'unavailable' }))('hi')).toBe(false);
  });

  it('is false when there is no Prompt API or it throws', async () => {
    expect(await promptApiProbe(() => undefined)('hi')).toBe(false);
    expect(await promptApiProbe(() => ({ availability: async () => { throw new Error('no'); } }))('hi')).toBe(false);
  });
});

describe('sensitive wording', () => {
  it('flags health, money and legal wording', () => {
    expect(sensitiveKinds(load('medicine-tracker'))).toContain('health');
    expect(sensitiveKinds(load('gst-calculator'))).toContain('money');
    expect(sensitiveKinds(load('kirana-credit-book'))).toContain('money');
  });

  it('leaves an ordinary app alone and gives one plain sentence otherwise', () => {
    expect(sensitiveKinds(load('habit-counter'))).toEqual([]);
    expect(sensitiveNotice([])).toBeUndefined();
    expect(sensitiveNotice(['health', 'money'])).toBe(
      'This app has health and money wording. Read the translation yourself before you rely on it, and change anything that is not right.',
    );
  });
});
