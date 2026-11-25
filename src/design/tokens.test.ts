import { describe, expect, it } from 'vitest';

import { contrastRatio } from './color';
import { darkColors, highContrastDarkColors, highContrastLightColors, type KalamColors, lightColors } from './tokens';

/** Text pairs every screen uses, and the WCAG minimum each must meet (docs/02 §5, §14.1). */
const TEXT_PAIRS: Array<[keyof KalamColors, keyof KalamColors]> = [
  ['text', 'background'], ['text', 'surface'], ['text', 'surfaceAlt'],
  ['textSecondary', 'background'], ['textSecondary', 'surface'],
  ['textMuted', 'background'], ['textMuted', 'surface'], ['textMuted', 'surfaceAlt'],
  ['primary', 'background'], ['primary', 'surface'], ['primary', 'primarySoft'],
  ['onPrimary', 'primary'], ['onPrimary', 'primaryPressed'],
  ['accentInk', 'background'], ['accentInk', 'surface'], ['text', 'accentSoft'],
  ['success', 'successSoft'], ['warning', 'warningSoft'], ['danger', 'dangerSoft'], ['info', 'infoSoft'],
  ['sourceOnDevice', 'successSoft'], ['sourceCloud', 'infoSoft'], ['sourceOffline', 'warningSoft'], ['sourceDeterministic', 'surfaceAlt'],
];
/** Non-text UI that must stay visible (input borders, focus ring): 3:1. */
const UI_PAIRS: Array<[keyof KalamColors, keyof KalamColors]> = [
  ['borderStrong', 'background'], ['borderStrong', 'surface'], ['focusRing', 'background'], ['focusRing', 'surface'],
];

describe.each([
  ['light', lightColors, 4.5],
  ['dark', darkColors, 4.5],
  ['high contrast light', highContrastLightColors, 7],
  ['high contrast dark', highContrastDarkColors, 7],
])('%s palette', (_name, c, textMin) => {
  it.each(TEXT_PAIRS)('%s on %s meets the text contrast minimum', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(textMin === 7 && fg.startsWith('source') ? 4.5 : textMin);
  });
  it.each(UI_PAIRS)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(3);
  });
});
