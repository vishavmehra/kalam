/**
 * Routing for generated artwork (docs/07 §9.3, §14.2): icon generation is "deterministic SVG first, then a verified
 * cloud image model"; a complex illustration is "cloud specialist, then an alternative verified provider".
 *
 * Image generation is a different capability from image understanding and is never assumed (docs/07 §14.6): a
 * provider is eligible only when the capability registry says Kalam has verified its image model, the person's
 * cloud consent allows the call, and (for Nebius) the external-provider consent and the server function are on.
 * Today no image model has been verified, so icons stay on the built-in glyphs and an illustration says so plainly.
 * At most one alternative is offered after a failure: no cascade (docs/07 §9.4). Pure: no SDK, no network.
 */
import type { KalamSettings } from '../contracts';
import { isVerified, type CapabilityProviderId } from './capabilities';
import { AI_COPY } from './copy';
import { cloudBlock } from './routing';

export type AssetKind = 'icon' | 'illustration';
export type AssetProvider = Extract<CapabilityProviderId, 'firebase_cloud' | 'nebius'>;

export type AssetRoute =
  /** No model: the built-in glyph set and colours (KalamSpec `icon`). */
  | { kind: 'deterministic'; note: string }
  | { kind: 'cloud_image'; provider: AssetProvider }
  | { kind: 'unavailable'; message: string };

export interface AssetRouteInput {
  asset: AssetKind;
  /** Icons: the person asked for generated artwork instead of the built-in glyph. Illustrations are always generated. */
  wantsGenerated: boolean;
  settings: Pick<KalamSettings, 'aiMode' | 'allowCloud' | 'allowExternalProviders'>;
  online: boolean;
  firebaseConfigured: boolean;
  specialistConfigured: boolean;
  /** The provider that was just tried and failed. It is skipped, so a retry reaches the one alternative at most. */
  failed?: AssetProvider;
  /** Capability check, replaceable in tests. Default: the capability registry. */
  verified?: (provider: AssetProvider) => boolean;
}

/** Cloud specialist first for an illustration, Firebase first for an icon: the table's order. */
const ORDER: Readonly<Record<AssetKind, readonly AssetProvider[]>> = {
  illustration: ['nebius', 'firebase_cloud'],
  icon: ['firebase_cloud', 'nebius'],
};

export function planAssetRoute(i: AssetRouteInput): AssetRoute {
  if (i.asset === 'icon' && !i.wantsGenerated) return { kind: 'deterministic', note: AI_COPY.iconBuiltIn };

  const isOk = i.verified ?? ((p: AssetProvider) => isVerified(p, 'image_generation'));
  const blocked = cloudBlock(i);
  const eligible = ORDER[i.asset].filter((p) =>
    p !== i.failed && isOk(p) && (p !== 'nebius' || (i.settings.allowExternalProviders && i.specialistConfigured)));

  if (blocked) {
    return i.asset === 'icon' ? { kind: 'deterministic', note: `${AI_COPY.iconBuiltIn} ${blocked.message}` } : { kind: 'unavailable', message: blocked.message };
  }
  const provider = eligible[0];
  if (provider) return { kind: 'cloud_image', provider };
  return i.asset === 'icon'
    ? { kind: 'deterministic', note: `${AI_COPY.iconBuiltIn} ${AI_COPY.noImageModel}` }
    : { kind: 'unavailable', message: AI_COPY.noImageModel };
}
