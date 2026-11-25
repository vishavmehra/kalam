import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES, CAPABILITY_PROVIDERS, getCapability, isUsable, isVerified, listCapabilities,
  type Capability, type CapabilityProviderId, type CapabilityStatus,
} from './capabilities';

const STATUSES: readonly CapabilityStatus[] = ['verified', 'unverified', 'unsupported', 'not_assumed'];

describe('capability registry: shape', () => {
  it('has exactly one row for every provider and capability', () => {
    const all = listCapabilities();
    expect(all).toHaveLength(CAPABILITY_PROVIDERS.length * CAPABILITIES.length);
    const keys = new Set(all.map((r) => `${r.provider}/${r.capability}`));
    expect(keys.size).toBe(all.length);
    for (const p of CAPABILITY_PROVIDERS) for (const c of CAPABILITIES) expect(keys.has(`${p}/${c}`)).toBe(true);
  });

  it('records evidence and a real calendar date on every row', () => {
    for (const r of listCapabilities()) {
      expect(STATUSES).toContain(r.status);
      expect(r.evidence.trim().length).toBeGreaterThan(20);
      expect(r.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${r.checkedOn}T00:00:00Z`).toISOString().slice(0, 10)).toBe(r.checkedOn);
    }
  });

  it('keeps evidence free of secrets and of dash punctuation (copy rule)', () => {
    for (const r of listCapabilities()) {
      expect(r.evidence).not.toMatch(/AIza|sk-ant|api[_-]?key\s*[:=]/i);
      expect(r.evidence).not.toMatch(/[–—]/);
    }
  });

  it('names the model for verified rows that depend on one', () => {
    for (const r of listCapabilities({ status: 'verified' })) {
      if (r.provider === 'firebase_cloud' || r.provider === 'nano_web') expect(r.model).toBeTruthy();
    }
  });

  it('returns frozen rows that callers cannot edit', () => {
    const r = getCapability('firebase_cloud', 'text');
    expect(Object.isFrozen(r)).toBe(true);
    expect(() => { (r as { status: CapabilityStatus }).status = 'unsupported'; }).toThrow(TypeError);
    // The list is a copy: trimming it does not shrink the registry.
    const copy = listCapabilities();
    copy.length = 0;
    expect(listCapabilities().length).toBeGreaterThan(0);
  });
});

describe('capability registry: known evidence', () => {
  it('Firebase cloud text and structured output are verified on gemini-3.8-flash (2026-11-18)', () => {
    for (const c of ['text', 'structured_output'] as const) {
      expect(getCapability('firebase_cloud', c)).toMatchObject({ status: 'verified', checkedOn: '2026-11-18', model: 'gemini-3.8-flash' });
    }
    expect(getCapability('firebase_cloud', 'text').evidence).toMatch(/Agent Platform/);
    expect(getCapability('firebase_cloud', 'text').evidence).toMatch(/global/);
  });

  it('Gemini Nano in Chrome has verified text and structured output', () => {
    for (const c of ['text', 'structured_output'] as const) {
      expect(getCapability('nano_web', c)).toMatchObject({ status: 'verified', model: 'gemini-nano' });
      expect(getCapability('nano_web', c).evidence).toMatch(/Chrome 157/);
    }
  });

  it('Nano image input is supported by the API but not verified in Kalam', () => {
    expect(getCapability('nano_web', 'image_input').status).toBe('unverified');
    expect(isVerified('nano_web', 'image_input')).toBe(false);
  });

  it('does not assume Nano audio, video or image generation on any platform', () => {
    for (const p of ['nano_web', 'nano_android'] as const) {
      for (const c of ['audio_input', 'video_input', 'image_generation'] as const) {
        expect(getCapability(p, c).status).toBe('not_assumed');
      }
    }
  });

  it('Gemini Nano on Android has a native bridge for text that no phone has verified yet, and takes no images', () => {
    for (const c of ['text', 'structured_output'] as const) {
      expect(getCapability('nano_android', c).status).toBe('unverified');
      expect(getCapability('nano_android', c).evidence).toMatch(/kalam-nano/);
    }
    expect(getCapability('nano_android', 'image_input')).toMatchObject({ status: 'unsupported', evidence: expect.stringMatching(/text only/) });
    expect(listCapabilities({ provider: 'nano_android', status: 'verified' })).toEqual([]);
  });

  it('Claude and Nebius text and structured output were verified through the functions emulator, and are off by default', () => {
    for (const p of ['claude', 'nebius'] as const) {
      for (const c of ['text', 'structured_output'] as const) {
        const r = getCapability(p, c);
        expect(r.status).toBe('verified');
        expect(r.evidence).toMatch(/emulator/i);
        expect(r.evidence).toMatch(/off by default/i);
      }
    }
  });

  it('never marks a modality verified that has no recorded run', () => {
    const verified = new Set(listCapabilities({ status: 'verified' }).map((r) => `${r.provider}/${r.capability}`));
    expect([...verified].sort()).toEqual([
      'claude/structured_output', 'claude/text',
      'firebase_cloud/structured_output', 'firebase_cloud/text',
      'nano_web/structured_output', 'nano_web/text',
      'nebius/structured_output', 'nebius/text',
    ]);
  });

  it('Claude does not generate images and Kalam does not send it images', () => {
    expect(getCapability('claude', 'image_generation').status).toBe('unsupported');
    expect(getCapability('claude', 'image_input').status).toBe('not_assumed');
  });
});

describe('capability registry: lookups', () => {
  it('getCapability returns the matching row', () => {
    expect(getCapability('claude', 'text')).toMatchObject({ provider: 'claude', capability: 'text' });
  });

  it('getCapability throws for a pair that is not in the matrix', () => {
    expect(() => getCapability('nope' as CapabilityProviderId, 'text')).toThrow(/No capability record/);
    expect(() => getCapability('claude', 'telepathy' as Capability)).toThrow(/No capability record/);
  });

  it('isVerified is true only for verified rows', () => {
    expect(isVerified('firebase_cloud', 'text')).toBe(true);
    expect(isVerified('firebase_cloud', 'image_input')).toBe(false); // unverified
    expect(isVerified('nano_web', 'audio_input')).toBe(false); // not assumed
    expect(isVerified('nano_android', 'text')).toBe(false); // unverified
  });

  it('isUsable allows verified and unverified rows and never unsupported or not-assumed ones', () => {
    expect(isUsable('nano_web', 'text')).toBe(true);
    expect(isUsable('nano_web', 'image_input')).toBe(true); // unverified
    expect(isUsable('nano_android', 'image_input')).toBe(false); // unsupported
    expect(isUsable('nano_web', 'audio_input')).toBe(false); // not assumed
  });

  it('listCapabilities filters by provider, capability and status, and combines filters', () => {
    expect(listCapabilities({ provider: 'firebase_cloud' })).toHaveLength(CAPABILITIES.length);
    expect(listCapabilities({ capability: 'text' })).toHaveLength(CAPABILITY_PROVIDERS.length);
    expect(listCapabilities({ status: 'verified', capability: 'text' }).map((r) => r.provider).sort())
      .toEqual(['claude', 'firebase_cloud', 'nano_web', 'nebius']);
    expect(listCapabilities({ provider: 'nano_web', status: 'unverified' }).map((r) => r.capability)).toEqual(['image_input']);
    expect(listCapabilities({ provider: 'claude', capability: 'audio_input', status: 'verified' })).toEqual([]);
  });
});
