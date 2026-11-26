import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NON_LATIN_SCRIPTS, SCRIPTS } from './scripts';
import { shellDisplayFamily, shellFamily, shellFontCssStack, shellFontFamilies, shellFontFile } from './shell-fonts';

const fonts = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const assetsSource = readFileSync(fileURLToPath(new URL('./shell-font-assets.ts', import.meta.url)), 'utf8');
const typographySource = readFileSync(fileURLToPath(new URL('../design/typography.ts', import.meta.url)), 'utf8');

describe('shell fonts (Anek body, Tiro display)', () => {
  it('names one family per script and weight', () => {
    expect(shellFamily('latin')).toBe('AnekLatin_400Regular');
    expect(shellFamily('tamil', 'semibold')).toBe('AnekTamil_600SemiBold');
    expect(shellFamily('bengali', 'bold')).toBe('AnekBangla_700Bold');
    expect(shellDisplayFamily('latin')).toBe('TiroDevanagariHindi_400Regular');
    expect(shellDisplayFamily('gujarati')).toBe('NotoSerifGujarati_500Medium');
    expect(shellFontFamilies('latin')).toEqual([]);
    // Devanagari display is Tiro Devanagari Hindi, already loaded at the root.
    expect(shellFontFamilies('devanagari')).toHaveLength(4);
    expect(shellFontFamilies('kannada')).toEqual([
      'AnekKannada_400Regular', 'AnekKannada_500Medium', 'AnekKannada_600SemiBold', 'AnekKannada_700Bold', 'TiroKannada_400Regular',
    ]);
  });

  it('every script family has a TTF on disk and is registered in shell-font-assets.ts', () => {
    for (const script of NON_LATIN_SCRIPTS) {
      for (const family of shellFontFamilies(script)) {
        expect(existsSync(`${fonts}${shellFontFile(family)}`), family).toBe(true);
        expect(assetsSource, family).toContain(`    ${family}: require('../../assets/fonts/${shellFontFile(family)}'),\n`);
      }
    }
  });

  it('the root fonts exist and are registered in design/typography.ts', () => {
    for (const family of [...['regular', 'medium', 'semibold', 'bold'].map((w) => shellFamily('latin', w as never)), 'AnekLatin_700Wide', 'TiroDevanagariHindi_400Regular', 'CourierPrime_700Bold', 'Kalam_400Regular']) {
      expect(existsSync(`${fonts}${shellFontFile(family)}`), family).toBe(true);
      expect(typographySource, family).toContain(`${family}: require('../../assets/fonts/${shellFontFile(family)}')`);
    }
  });

  it('every font folder carries its OFL licence', () => {
    for (const script of SCRIPTS) {
      for (const family of [shellFamily(script), shellDisplayFamily(script)]) {
        const dir = shellFontFile(family).split('/')[0];
        expect(readFileSync(`${fonts}${dir}/OFL.txt`, 'utf8'), dir).toMatch(/SIL OPEN FONT LICENSE/i);
      }
    }
  });

  it('web stacks put the Latin face first and never repeat a family', () => {
    expect(shellFontCssStack('latin')).toBe('"AnekLatin_400Regular", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(shellFontCssStack('tamil', 'medium')).toBe('"AnekLatin_500Medium", "AnekTamil_500Medium", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(shellFontCssStack('devanagari', 'regular', true)).toBe('"TiroDevanagariHindi_400Regular", Georgia, serif');
    expect(shellFontCssStack('malayalam', 'bold', true)).toBe('"TiroDevanagariHindi_400Regular", "NotoSerifMalayalam_500Medium", Georgia, serif');
  });
});
