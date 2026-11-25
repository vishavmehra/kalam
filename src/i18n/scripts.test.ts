import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LANGUAGES } from './languages';
import { runtimeFont } from './runtime-font';
import {
  NON_LATIN_SCRIPTS, SCRIPT_FONT_WEIGHTS, detectScript, detectScripts, fontScriptsForLanguages,
  scriptFontCssStack, scriptFontFamilies, scriptFontFamily, scriptForLanguage, scriptOfCodePoint,
  type NonLatinScript,
} from './scripts';

const SAMPLES: Record<string, string> = {
  latin: 'Create an app',
  devanagari: 'ऐप बनाएँ',
  bengali: 'অ্যাপ তৈরি করুন',
  gurmukhi: 'ਐਪ ਬਣਾਓ',
  gujarati: 'એપ બનાવો',
  tamil: 'ஆப்பை உருவாக்கு',
  telugu: 'యాప్ తయారు చేయండి',
  kannada: 'ಆ್ಯಪ್ ರಚಿಸಿ',
  malayalam: 'ആപ്പ് ഉണ്ടാക്കുക',
};

describe('script detection', () => {
  it.each(Object.entries(SAMPLES))('detects %s', (script, text) => {
    expect(detectScript(text)).toBe(script);
  });

  it('returns null for text with no letters', () => {
    expect(detectScript('')).toBeNull();
    expect(detectScript('12345 .,;!? ₹')).toBeNull();
    expect(detectScript('‍‌')).toBeNull();
  });

  it('picks the script with most letters in mixed text, and lists all of them', () => {
    expect(detectScript('Kalam ऐप बनाएँ')).toBe('devanagari');
    expect(detectScripts('Kalam ऐप बनाएँ')).toEqual(['devanagari', 'latin']);
    expect(detectScript('Order ग்')).toBe('latin');
  });

  it('breaks a tie with the script that appears first', () => {
    expect(detectScript('ab' + 'கக')).toBe('latin');
    expect(detectScript('கக' + 'ab')).toBe('tamil');
  });

  it('does not let the danda (shared by Indic scripts) vote', () => {
    expect(scriptOfCodePoint(0x0964)).toBeNull();
    expect(detectScript('অ্যাপ ।।।।।।')).toBe('bengali');
  });

  it('counts combining marks with their script', () => {
    expect(scriptOfCodePoint('ा'.codePointAt(0)!)).toBe('devanagari');
    expect(scriptOfCodePoint('ு'.codePointAt(0)!)).toBe('tamil');
  });
});

describe('languages and scripts', () => {
  it('maps every shipped language to its script', () => {
    const expected: Record<string, string> = {
      en: 'latin', hi: 'devanagari', mr: 'devanagari', gu: 'gujarati', bn: 'bengali',
      ta: 'tamil', te: 'telugu', kn: 'kannada', ml: 'malayalam', pa: 'gurmukhi',
    };
    for (const l of LANGUAGES) expect(scriptForLanguage(l.code), l.code).toBe(expected[l.code]);
    expect(scriptForLanguage('hi-IN')).toBe('devanagari');
    expect(scriptForLanguage('fr')).toBe('latin');
    expect(scriptForLanguage(undefined)).toBe('latin');
  });

  it('native names are written in the language script', () => {
    for (const l of LANGUAGES) expect(detectScript(l.native), l.code).toBe(l.script);
  });

  it('asks for each non-Latin script once and never for Latin', () => {
    expect(fontScriptsForLanguages(['hi', 'mr', 'en', 'ta', 'hi-IN'])).toEqual(['devanagari', 'tamil']);
    expect(fontScriptsForLanguages(['en', 'fr'])).toEqual([]);
  });
});

describe('font family names', () => {
  it('names each weight as its own family and has none for Latin', () => {
    expect(scriptFontFamily('devanagari')).toBe('NotoSansDevanagari_400Regular');
    expect(scriptFontFamily('tamil', 'semibold')).toBe('NotoSansTamil_600SemiBold');
    expect(scriptFontFamily('gurmukhi', 'bold')).toBe('NotoSansGurmukhi_700Bold');
    expect(scriptFontFamily('latin')).toBeNull();
    expect(scriptFontFamilies('latin')).toEqual([]);
    expect(scriptFontFamilies('kannada')).toHaveLength(SCRIPT_FONT_WEIGHTS.length);
  });

  it('matches the exports of the installed @expo-google-fonts packages', () => {
    const root = fileURLToPath(new URL('../../node_modules/@expo-google-fonts/', import.meta.url));
    const folder: Record<NonLatinScript, string> = {
      devanagari: 'noto-sans-devanagari', bengali: 'noto-sans-bengali', gurmukhi: 'noto-sans-gurmukhi',
      gujarati: 'noto-sans-gujarati', tamil: 'noto-sans-tamil', telugu: 'noto-sans-telugu',
      kannada: 'noto-sans-kannada', malayalam: 'noto-sans-malayalam',
    };
    const suffix = { regular: '400Regular', medium: '500Medium', semibold: '600SemiBold', bold: '700Bold' } as const;
    for (const script of NON_LATIN_SCRIPTS) {
      for (const weight of SCRIPT_FONT_WEIGHTS) {
        const family = scriptFontFamily(script, weight)!;
        const declaration = readFileSync(`${root}${folder[script]}/${suffix[weight]}/index.d.ts`, 'utf8');
        expect(declaration, family).toContain(`export const ${family}:`);
      }
    }
  });

  it('font-assets.ts registers exactly those families', () => {
    const source = readFileSync(fileURLToPath(new URL('./font-assets.ts', import.meta.url)), 'utf8');
    for (const script of NON_LATIN_SCRIPTS) {
      for (const family of scriptFontFamilies(script)) {
        expect(source, family).toContain(`    ${family},\n`);
        expect(source, family).toContain(`import { ${family} }`);
      }
    }
  });

  it('builds a web font stack with the Latin face first', () => {
    expect(scriptFontCssStack('devanagari', 'medium', 'Inter_500Medium')).toBe(
      '"Inter_500Medium", "NotoSansDevanagari_500Medium", "Noto Sans Devanagari", "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    );
    expect(scriptFontCssStack('latin')).toContain('"Noto Sans"');
    expect(scriptFontCssStack('latin')).not.toContain('NotoSansLatin');
  });
});

describe('runtimeFont (font for an app, from spec.lang)', () => {
  it('picks the script font from the app language', () => {
    const font = runtimeFont('ta');
    expect(font.script).toBe('tamil');
    expect(font.family()).toBe('NotoSansTamil_400Regular');
    expect(font.family('semibold')).toBe('NotoSansTamil_600SemiBold');
    expect(font.cssStack('regular', 'Inter')).toContain('"NotoSansTamil_400Regular"');
  });

  it('keeps Inter (no family) for English and for languages Kalam has no font for', () => {
    expect(runtimeFont('en').family()).toBeUndefined();
    expect(runtimeFont('fr-FR').family()).toBeUndefined();
    expect(runtimeFont(undefined).script).toBe('latin');
  });

  it('uses the loaded script while the app language font is still loading', () => {
    expect(runtimeFont('ta', 'latin').family()).toBeUndefined();
  });
});
