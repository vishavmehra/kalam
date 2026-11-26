/**
 * Pure rules behind the stamps, slips and registers (DIRECTION §7), kept out of the components so they are
 * unit tested without a renderer (marks.test.ts).
 */
import type { ClothKind, StampKind } from './tokens';

export type ExecutionSource = 'deterministic' | 'on_device' | 'cloud' | 'offline';

/**
 * Where an AI step ran, as a stamp. Offline is graphite like Template (offline is normal, never a warning),
 * and it carries its own words and the wifi-off icon.
 */
export const SOURCE_STAMP: Record<ExecutionSource, { kind: StampKind; label: 'stamp.device' | 'stamp.cloud' | 'stamp.template' | 'stamp.offline' }> = {
  on_device: { kind: 'device', label: 'stamp.device' },
  cloud: { kind: 'cloud', label: 'stamp.cloud' },
  deterministic: { kind: 'template', label: 'stamp.template' },
  offline: { kind: 'template', label: 'stamp.offline' },
};

export const SOURCE_EXPLAIN = {
  on_device: 'stamp.explain.device',
  cloud: 'stamp.explain.cloud',
  deterministic: 'stamp.explain.template',
  offline: 'stamp.explain.offline',
} as const satisfies Record<ExecutionSource, string>;

/**
 * "No. 07" in the order-book style: at least `digits` digits, never negative. `prefix` is the translated
 * `slip.no` ("No.", "नं.") that Slip passes; the digits stay Latin for Courier Prime.
 */
export function slipNumber(n: number, digits = 2, prefix = 'No.'): string {
  return `${prefix} ${String(Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))).padStart(digits, '0')}`;
}

/** The register cloth for a KalamSpec theme preset, so a cover matches the app it opens. */
const PRESET_CLOTH: Record<string, ClothKind> = {
  calm_green: 'green',
  warm_paper: 'kraft',
  ocean_blue: 'ocean',
  soft_lavender: 'neel',
  minimal_neutral: 'haldi',
  high_contrast: 'lal',
};

export function clothForPreset(preset: string | undefined): ClothKind {
  return (preset && PRESET_CLOTH[preset]) || 'green';
}
