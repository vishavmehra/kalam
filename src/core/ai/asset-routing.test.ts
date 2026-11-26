import { describe, expect, it } from 'vitest';
import { planAssetRoute, type AssetRouteInput } from './asset-routing';
import { AI_COPY } from './copy';

const base: AssetRouteInput = {
  asset: 'icon', wantsGenerated: false,
  settings: { aiMode: 'hybrid', allowCloud: true, allowExternalProviders: true },
  online: true, firebaseConfigured: true, specialistConfigured: true,
};
const allVerified = () => true;

describe('planAssetRoute (docs/07 §9.3)', () => {
  it('icons are deterministic first, with no model, unless generated artwork was asked for', () => {
    expect(planAssetRoute({ ...base })).toEqual({ kind: 'deterministic', note: AI_COPY.iconBuiltIn });
    expect(planAssetRoute({ ...base, verified: allVerified })).toMatchObject({ kind: 'deterministic' });
  });

  it('asked-for icon art goes to a verified Firebase image model, and only a verified one', () => {
    expect(planAssetRoute({ ...base, wantsGenerated: true, verified: allVerified })).toEqual({ kind: 'cloud_image', provider: 'firebase_cloud' });
    // Nothing is verified in this build today: the built-in icons stay, and the person is told why.
    const today = planAssetRoute({ ...base, wantsGenerated: true });
    expect(today).toMatchObject({ kind: 'deterministic' });
    expect(today.kind === 'deterministic' && today.note).toContain(AI_COPY.noImageModel);
  });

  it('a complex illustration goes to the cloud specialist, then at most one alternative', () => {
    const il = { ...base, asset: 'illustration' as const, wantsGenerated: true, verified: allVerified };
    expect(planAssetRoute(il)).toEqual({ kind: 'cloud_image', provider: 'nebius' });
    expect(planAssetRoute({ ...il, failed: 'nebius' })).toEqual({ kind: 'cloud_image', provider: 'firebase_cloud' });
    expect(planAssetRoute({ ...il, failed: 'firebase_cloud' })).toEqual({ kind: 'cloud_image', provider: 'nebius' });
    expect(planAssetRoute({ ...il, verified: (p) => p === 'nebius', failed: 'nebius' })).toMatchObject({ kind: 'unavailable' });
  });

  it('never reaches Nebius without the external-provider consent and the server function', () => {
    const il = { ...base, asset: 'illustration' as const, wantsGenerated: true, verified: allVerified };
    expect(planAssetRoute({ ...il, settings: { ...base.settings, allowExternalProviders: false } })).toEqual({ kind: 'cloud_image', provider: 'firebase_cloud' });
    expect(planAssetRoute({ ...il, specialistConfigured: false })).toEqual({ kind: 'cloud_image', provider: 'firebase_cloud' });
  });

  it('respects offline, cloud-off and offline-only mode', () => {
    const il = { ...base, asset: 'illustration' as const, wantsGenerated: true, verified: allVerified };
    expect(planAssetRoute({ ...il, online: false })).toEqual({ kind: 'unavailable', message: AI_COPY.offline });
    expect(planAssetRoute({ ...il, settings: { ...base.settings, allowCloud: false } })).toEqual({ kind: 'unavailable', message: AI_COPY.cloudOff });
    expect(planAssetRoute({ ...il, settings: { ...base.settings, aiMode: 'offline_only' } })).toEqual({ kind: 'unavailable', message: AI_COPY.offlineOnlyMode });
    expect(planAssetRoute({ ...base, wantsGenerated: true, online: false, verified: allVerified })).toMatchObject({ kind: 'deterministic' });
  });

  it('says plainly that no image model is verified yet for an illustration', () => {
    expect(planAssetRoute({ ...base, asset: 'illustration', wantsGenerated: true })).toEqual({ kind: 'unavailable', message: AI_COPY.noImageModel });
  });
});
