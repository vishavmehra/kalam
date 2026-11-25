/**
 * Pure helpers for the edit screen: theme customiser options, patch ops, summaries, and
 * writing an AI-block verification result into a spec (never mutating the input).
 */
import type { AIBlockVerificationOutcome, EditOutcome, SpecPatchOp } from '@/core/contracts';
import { SCHEMA_VERSION, type KalamAIBlockKind, type KalamSpec, type ThemePreset } from '@/core/spec/schema';
import { THEME_PRESET_TOKENS } from '@/core/templates/themes';

export const PRESET_LABELS: Record<ThemePreset, string> = {
  calm_green: 'Calm green',
  warm_paper: 'Warm paper',
  ocean_blue: 'Ocean blue',
  soft_lavender: 'Soft lavender',
  minimal_neutral: 'Minimal',
  high_contrast: 'High contrast',
};

export const PRIMARY_SWATCHES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Forest', hex: '#315C4C' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Ocean', hex: '#1F5F8B' },
  { name: 'Indigo', hex: '#3949AB' },
  { name: 'Lavender', hex: '#6A4C93' },
  { name: 'Berry', hex: '#9D174D' },
  { name: 'Brick', hex: '#B3261E' },
  { name: 'Saffron', hex: '#B45309' },
  { name: 'Clay', hex: '#8A4B2A' },
  { name: 'Graphite', hex: '#2F3437' },
];

/** Second colour for highlights and badges (docs/02 §12.3). Mid-tones that read on light and dark. */
export const ACCENT_SWATCHES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Marigold', hex: '#E9A23B' },
  { name: 'Coral', hex: '#F07F5E' },
  { name: 'Rose', hex: '#D9577B' },
  { name: 'Mint', hex: '#3FB68B' },
  { name: 'Sky', hex: '#4C9BE8' },
  { name: 'Plum', hex: '#9B6BC7' },
];

/** Background moods (docs/02 §12.3): background, surface and text set together so they stay readable. */
export const BACKGROUND_MOODS = {
  light: { label: 'Light', background: '#F7F8FA', surface: '#FFFFFF', text: '#1C2430' },
  warm: { label: 'Warm', background: '#FBF6EE', surface: '#FFFDF8', text: '#2A2118' },
  dark: { label: 'Dark', background: '#14161C', surface: '#1E2129', text: '#ECEEF2' },
} as const;
export type BackgroundMood = keyof typeof BACKGROUND_MOODS;

export function moodOps(mood: BackgroundMood): SpecPatchOp[] {
  const m = BACKGROUND_MOODS[mood];
  return (['background', 'surface', 'text'] as const).map((token) => ({ op: 'setThemeToken', token, value: m[token] }));
}

/** Which mood a theme is in now, if it matches one exactly. */
export function currentMood(theme: { background?: string; surface?: string; text?: string }): BackgroundMood | undefined {
  return (Object.keys(BACKGROUND_MOODS) as BackgroundMood[]).find((k) => {
    const m = BACKGROUND_MOODS[k];
    return [m.background, m.surface, m.text].join() === [theme.background, theme.surface, theme.text].map((c) => (c ?? '').toUpperCase()).join();
  });
}

export const RADIUS_OPTIONS = [
  { value: '4', label: 'Sharp' },
  { value: '12', label: 'Soft' },
  { value: '20', label: 'Round' },
] as const;

export const TEXT_SIZES = [
  { value: '0.9', label: 'Small' },
  { value: '1', label: 'Default' },
  { value: '1.15', label: 'Large' },
  { value: '1.3', label: 'Larger' },
] as const;

/** Colour tokens of a preset. Radius and text size stay the person's own choice. */
export function presetOps(preset: ThemePreset): SpecPatchOp[] {
  const p = THEME_PRESET_TOKENS[preset];
  const ops: SpecPatchOp[] = [{ op: 'setThemePreset', preset }, { op: 'setThemeToken', token: 'primary', value: p.primary }];
  for (const token of ['secondary', 'background', 'surface', 'text'] as const) {
    const value = p[token];
    if (value) ops.push({ op: 'setThemeToken', token, value });
  }
  return ops;
}

export function joinSummary(previous: string | undefined, next: string): string {
  const s = previous ? `${previous}; ${next}` : next;
  return s.length > 240 ? `${s.slice(0, 237)}…` : s;
}

export function blockKindLabel(kind: KalamAIBlockKind): string {
  switch (kind) {
    case 'extractFromPhoto': return 'Reads a photo and fills in fields';
    case 'classify': return 'Sorts text into labels';
    case 'summarise': return 'Summarises text';
    case 'translate': return 'Translates text';
  }
}

/** Edit route → execution-source badge. Specialist providers also run online. */
export function routeSource(route: EditOutcome['route']): 'deterministic' | 'on_device' | 'cloud' {
  return route === 'specialist' ? 'cloud' : route;
}

export function humanize(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Returns a copy of `spec` with the block's verification result recorded (docs/07 §13.4).
 * Counts are clamped to the schema limits so a misbehaving verifier can't produce an invalid spec.
 */
export function applyVerification(spec: KalamSpec, blockId: string, outcome: AIBlockVerificationOutcome, now: number): KalamSpec {
  const block = spec.aiBlocks[blockId];
  if (!block) return spec;
  const testCount = Math.max(0, Math.min(50, Math.floor(outcome.testCount)));
  const passCount = Math.max(0, Math.min(testCount, Math.floor(outcome.passCount)));
  return {
    ...spec,
    aiBlocks: {
      ...spec.aiBlocks,
      [blockId]: {
        ...block,
        verified: outcome.status,
        verification: {
          status: outcome.status,
          testCount,
          passCount,
          ...(outcome.model ? { model: outcome.model.slice(0, 80) } : {}),
          verifiedAt: Math.floor(now),
          schemaVersion: SCHEMA_VERSION,
        },
      },
    },
  };
}

export function verificationSummary(blockId: string, o: AIBlockVerificationOutcome): string {
  const result = o.status === 'onDevice' ? 'runs on this device' : o.status === 'cloudPreferred' ? 'will prefer the cloud' : 'stays unverified';
  return `Checked "${humanize(blockId)}" on this device: ${o.passCount} of ${o.testCount} passed, ${result}`;
}
