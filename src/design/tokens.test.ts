import { describe, expect, it } from 'vitest';

import { contrastRatio } from './color';
import {
  chartColors, clothLabel, cloths, darkColors, darkTints, highContrastDarkColors, highContrastLightColors, type KalamColors,
  lightColors, palette, lightTints, stampColors, type TintColors,
} from './tokens';

type Key = keyof KalamColors;

/** Text pairs every screen uses (DIRECTION §2.1 and §2.2), at 4.5:1, or 7:1 in High Contrast. */
const TEXT_PAIRS: Array<[Key, Key]> = [
  ['text', 'background'], ['text', 'surface'], ['text', 'surfaceAlt'], ['text', 'surfaceElevated'],
  ['textSecondary', 'background'], ['textSecondary', 'surface'], ['textSecondary', 'surfaceAlt'],
  ['textSecondary', 'surfaceElevated'],
  ['textMuted', 'background'], ['textMuted', 'surface'], ['textMuted', 'surfaceAlt'], ['textMuted', 'surfaceElevated'],
  ['primary', 'background'], ['primary', 'surface'], ['primary', 'surfaceAlt'], ['primary', 'primarySoft'],
  ['onPrimary', 'primary'], ['onPrimary', 'primaryPressed'],
  ['actionFg', 'actionBg'], ['actionFg', 'actionBgPressed'],
  ['accentInk', 'background'], ['accentInk', 'surface'], ['text', 'accentSoft'], ['onAccent', 'accent'],
  ['success', 'successSoft'], ['warning', 'warningSoft'], ['danger', 'dangerSoft'], ['info', 'infoSoft'],
  ['danger', 'background'], ['danger', 'surface'],
  ['violet', 'violetSoft'], ['graphite', 'graphiteSoft'],
  ['sourceOnDevice', 'successSoft'], ['sourceCloud', 'infoSoft'], ['sourceOffline', 'graphiteSoft'], ['sourceDeterministic', 'surfaceAlt'],
  ['onField', 'field'], ['onField2', 'field'], ['onField', 'fieldDeep'],
  ['markInk', 'markWash'], ['markInk', 'surface'], ['markInk', 'background'],
];

/**
 * Non-text UI that must stay visible: control edges, the focus ring, the switch track, and the bright saffron
 * pen mark (underlines, bullets, chart bars; never text, which uses `markInk`). 3:1.
 */
const UI_PAIRS: Array<[Key, Key]> = [
  ['borderStrong', 'background'], ['borderStrong', 'surface'],
  ['mark', 'background'], ['mark', 'surface'],
  ['focusRing', 'background'], ['focusRing', 'surface'], ['focusRing', 'surfaceAlt'], ['focusRing', 'surfaceElevated'],
  ['primary', 'background'], ['actionBg', 'background'], ['actionBg', 'surface'],
  ['accent', 'field'],
];

describe.each([
  ['paper', lightColors, 4.5],
  ['ink night', darkColors, 4.5],
  ['high contrast paper', highContrastLightColors, 7],
  ['high contrast ink night', highContrastDarkColors, 7],
])('%s colours', (_name, c, textMin) => {
  it.each(TEXT_PAIRS)('%s on %s meets the text contrast minimum', (fg, bg) => {
    // Stamps and the field keep their hue in High Contrast, so they are held to AA, not AAA.
    const relaxed = textMin === 7 && (fg.startsWith('source') || ['violet', 'graphite', 'onField2', 'mark', 'markInk'].includes(fg));
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(relaxed ? 4.5 : textMin);
  });
  it.each(UI_PAIRS)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(3);
  });
  it('every stamp reads on its wash and on the sheet', () => {
    for (const [kind, s] of Object.entries(stampColors(c))) {
      expect(contrastRatio(s.ink, s.wash), kind).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s.ink, c.surface), `${kind} on sheet`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe.each([
  ['paper', lightColors, lightTints],
  ['ink night', darkColors, darkTints],
] as Array<[string, KalamColors, TintColors]>)('%s slip tints', (_name, c, tints) => {
  it.each(Object.entries(tints))('%s carries body, muted text and red numbering', (_tint, bg) => {
    expect(contrastRatio(c.text, bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.markInk, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('register cloths', () => {
  it.each(Object.entries(cloths))('%s cover text reads on the cloth', (_k, cl) => {
    expect(contrastRatio(cl.fg, cl.cloth)).toBeGreaterThanOrEqual(4.5);
  });
  it('the name label reads in both tones', () => {
    expect(contrastRatio(clothLabel.fg, clothLabel.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(clothLabel.muted, clothLabel.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the direction is honoured', () => {
  it('Paper and Ink night use the exact DIRECTION hexes for the core roles', () => {
    expect([lightColors.background, lightColors.surface, lightColors.text, lightColors.primary, lightColors.accent, lightColors.mark])
      .toEqual(['#FAF7F2', '#FFFFFF', '#1C1917', '#B8432C', '#F2A541', '#E2583E']);
    expect([darkColors.background, darkColors.surface, darkColors.text, darkColors.primary, darkColors.focusRing])
      .toEqual(['#121110', '#1C1A18', '#F5F1EA', '#F06A4F', '#F06A4F']);
  });
  it('the brand saffron stays on marks and the text-bearing saffron is deeper', () => {
    // #E2583E fails 4.5:1 with white, so no fill that carries text may use it.
    expect(contrastRatio('#FFFFFF', '#E2583E')).toBeLessThan(4.5);
    expect(lightColors.actionBg).not.toBe('#E2583E');
    expect(contrastRatio(lightColors.actionFg, lightColors.actionBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightColors.primary, lightColors.background)).toBeGreaterThanOrEqual(4.5);
  });
  it('the field is charcoal in both themes', () => {
    expect([lightColors.field, darkColors.field]).toEqual(['#1C1917', '#1C1A18']);
  });
  it('offline is graphite, never a warning colour', () => {
    for (const c of [lightColors, darkColors]) expect(c.sourceOffline).toBe(c.graphite);
  });
  it('the primary action is saffron with white text on Paper and charcoal text on Ink night', () => {
    expect(lightColors.actionBg).toBe(lightColors.primary);
    expect(lightColors.actionFg).toBe('#FFFFFF');
    expect(darkColors.actionBg).toBe(darkColors.primary);
    expect(darkColors.actionFg).toBe('#1C1917');
  });
  // Chart marks carry no text: the Activity bar puts its shares in the legend in text colour, so only 3:1 applies.
  it('chart marks stay 3:1 against the sheet', () => {
    for (const [scheme, c] of [['light', lightColors], ['dark', darkColors]] as const) {
      for (const mark of Object.values(chartColors[scheme])) expect(contrastRatio(mark, c.surface), `${scheme} ${mark}`).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * Every pairing DIRECTION.md §2.1 and §2.2 states a ratio for, taken from the palette itself. Each must meet AA
 * (4.5:1 text, 3:1 for control edges) and come within 0.06 of the stated number, or beat it (Ink night's
 * control edge was lifted on purpose so it also passes on sheets).
 */
type Pair = [string, string, string, number, 'text' | 'ui'];
const P = palette.paper;
const N = palette.ink;
const WHITE = '#FFFFFF';
const CHARCOAL = '#1C1917';
const DIRECTION_PAIRS: Pair[] = [
  ['paper ink on canvas', P.ink, P.canvas, 16.37, 'text'], ['paper ink on sheet', P.ink, P.sheet, 17.49, 'text'],
  ['paper ink-2 on canvas', P.ink2, P.canvas, 9.61, 'text'],
  ['paper ink-3 on canvas', P.ink3, P.canvas, 5.46, 'text'], ['paper ink-3 on sheet', P.ink3, P.sheet, 5.84, 'text'],
  ['paper ink-3 on sunk', P.ink3, P.sunk, 4.96, 'text'],
  ['paper rule-strong on canvas', P.ruleStrong, P.canvas, 3.5, 'ui'], ['paper rule-strong on sheet', P.ruleStrong, P.sheet, 3.74, 'ui'],
  ['paper deep saffron on canvas', P.royal, P.canvas, 5.07, 'text'], ['paper deep saffron on sheet', P.royal, P.sheet, 5.42, 'text'],
  ['paper deep saffron on its wash', P.royal, P.royalWash, 4.78, 'text'], ['paper deep saffron on sunk', P.royal, P.sunk, 4.6, 'text'],
  ['paper action', lightColors.actionFg, lightColors.actionBg, 5.42, 'text'],
  ['paper action pressed', lightColors.actionFg, lightColors.actionBgPressed, 7.18, 'text'],
  ['paper on the field', P.canvas, P.field, 16.37, 'text'], ['paper on-field-2', P.onField2, P.field, 11.66, 'text'],
  ['paper bright saffron on canvas', P.sindoor, P.canvas, 3.45, 'ui'], ['paper bright saffron on sheet', P.sindoor, P.sheet, 3.68, 'ui'],
  ['paper bright saffron on the field', P.sindoor, P.field, 4.75, 'ui'],
  ['paper ink on marigold', P.ink, P.haldi, 8.52, 'text'],
  ['paper marigold-ink on canvas', P.haldiInk, P.canvas, 5.98, 'text'], ['paper marigold-ink on its wash', P.haldiInk, P.haldiWash, 5.62, 'text'],
  ['paper leaf', P.leaf, P.canvas, 5.85, 'text'], ['paper leaf on wash', P.leaf, P.leafWash, 5.29, 'text'],
  ['paper sky', P.sky, P.canvas, 5.47, 'text'], ['paper sky on wash', P.sky, P.skyWash, 4.94, 'text'],
  ['paper violet', P.violet, P.canvas, 7.18, 'text'], ['paper violet on wash', P.violet, P.violetWash, 6.37, 'text'],
  ['paper graphite', P.graphite, P.canvas, 7.14, 'text'], ['paper graphite on wash', P.graphite, P.graphiteWash, 6.25, 'text'],
  ['paper danger', P.danger, P.canvas, 7.06, 'text'], ['paper danger on wash', P.danger, P.dangerWash, 6.37, 'text'],
  ...Object.entries(lightTints).flatMap(([k, bg]): Pair[] => [
    [`paper saffron-ink on ${k}`, P.sindoorInk, bg, 5.31, 'text'], [`paper ink-3 on ${k}`, P.ink3, bg, 4.8, 'text'],
  ]),
  ['ink ink on canvas', N.ink, N.canvas, 16.75, 'text'], ['ink ink on sheet', N.ink, N.sheet, 15.41, 'text'],
  ['ink ink-2 on canvas', N.ink2, N.canvas, 11.36, 'text'], ['ink ink-2 on sheet', N.ink2, N.sheet, 10.45, 'text'],
  ['ink ink-3 on canvas', N.ink3, N.canvas, 6.94, 'text'], ['ink ink-3 on sheet', N.ink3, N.sheet, 6.38, 'text'],
  ['ink ink-3 on raised', N.ink3, N.raised, 5.82, 'text'],
  ['ink rule-strong on canvas', N.ruleStrong, N.canvas, 4.17, 'ui'], ['ink rule-strong on sheet', N.ruleStrong, N.sheet, 3.83, 'ui'],
  ['ink rule-strong on raised', N.ruleStrong, N.raised, 3.49, 'ui'],
  ['ink saffron on canvas', N.royal, N.canvas, 6.18, 'text'], ['ink saffron on sheet', N.royal, N.sheet, 5.68, 'text'],
  ['ink saffron on its wash', N.royal, N.royalWash, 4.99, 'text'],
  ['ink action', darkColors.actionFg, darkColors.actionBg, 5.73, 'text'],
  ['ink action pressed', darkColors.actionFg, darkColors.actionBgPressed, 7.38, 'text'],
  ['ink text on the field', N.ink, N.field, 15.41, 'text'], ['ink on-field-2', N.onField2, N.field, 9.73, 'text'],
  ['ink marigold on the field', N.haldi, N.field, 8.46, 'text'],
  ['ink marigold', N.haldi, N.canvas, 9.19, 'text'], ['ink marigold-ink', N.haldiInk, N.canvas, 10.8, 'text'],
  ['ink leaf', N.leaf, N.canvas, 10.59, 'text'], ['ink leaf on wash', N.leaf, N.leafWash, 8.58, 'text'],
  ['ink sky', N.sky, N.canvas, 10.01, 'text'], ['ink sky on wash', N.sky, N.skyWash, 7.4, 'text'],
  ['ink violet', N.violet, N.canvas, 8.69, 'text'], ['ink violet on wash', N.violet, N.violetWash, 6.65, 'text'],
  ['ink graphite', N.graphite, N.canvas, 8.31, 'text'], ['ink graphite on wash', N.graphite, N.graphiteWash, 6.61, 'text'],
  ['ink danger', N.danger, N.canvas, 7.73, 'text'], ['ink danger on wash', N.danger, N.dangerWash, 6.59, 'text'],
  ...Object.entries(darkTints).map(([k, bg]): Pair => [`ink ink-3 on ${k}`, N.ink3, bg, 5.4, 'text']),
  // The one pairing the brief names: white on the bright saffron is not text-safe, which is why `royal` exists.
  ['white on the deep saffron fill', WHITE, P.royal, 5.42, 'text'], ['charcoal on the dark-mode saffron fill', CHARCOAL, N.royal, 5.73, 'text'],
];

describe('DIRECTION.md contrast table', () => {
  it.each(DIRECTION_PAIRS)('%s', (_name, fg, bg, stated, kind) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(kind === 'ui' ? 3 : 4.5);
    expect(ratio).toBeGreaterThanOrEqual(stated - 0.06);
  });
});
