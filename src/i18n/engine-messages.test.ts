import { describe, expect, it } from 'vitest';

import { ENGINE_KEYS, ENGINE_MESSAGES, engineText } from './engine-messages';
import { placeholdersOf } from './interpolate';
import { LANGUAGES, LANGUAGE_CODES } from './languages';
import { detectScripts } from './scripts';

describe('engine messages', () => {
  it('every shipped language has every key', () => {
    for (const code of LANGUAGE_CODES) {
      expect(Object.keys(ENGINE_MESSAGES[code]).sort(), code).toEqual([...ENGINE_KEYS].sort());
    }
  });

  it('keeps English placeholders in every language', () => {
    for (const code of LANGUAGE_CODES) {
      for (const key of ENGINE_KEYS) {
        expect(placeholdersOf(ENGINE_MESSAGES[code][key]).sort(), `${code}.${key}`).toEqual(placeholdersOf(ENGINE_MESSAGES.en[key]).sort());
      }
    }
  });

  it('is written in the language script and obeys the copy rule', () => {
    for (const { code, script } of LANGUAGES) {
      for (const key of ENGINE_KEYS) {
        const text = ENGINE_MESSAGES[code][key];
        expect(text, `${code}.${key}`).not.toMatch(/[–—!]/);
        if (code !== 'en') expect(detectScripts(text), `${code}.${key}`).toContain(script);
      }
    }
  });

  it('looks up by the app language, not the Studio language', () => {
    expect(engineText('hi', 'saved')).toBe('सहेज लिया गया');
    expect(engineText('ta-IN', 'deleted')).toBe('நீக்கப்பட்டது');
    expect(engineText('en', 'updated')).toBe('Updated');
  });

  it('fills the field label and formats numbers for the language', () => {
    expect(engineText('hi', 'required', { label: 'नाम' })).toBe('नाम भरना ज़रूरी है');
    expect(engineText('en', 'min', { label: 'Quantity', min: 1000 })).toBe('Quantity must be at least 1,000');
    expect(engineText('en', 'maxLength', { label: 'Name', max: 40 })).toBe('Name must be 40 characters or fewer');
  });

  it('uses English for apps in a language Kalam has no text for, or no language at all', () => {
    expect(engineText('fr-FR', 'saved')).toBe('Saved');
    expect(engineText(undefined, 'formulaFailed')).toBe('Formula failed');
    expect(engineText(null, 'deleted')).toBe('Deleted');
  });

  it('English texts match what the engine says today', () => {
    expect(engineText('en', 'required', { label: 'Amount' })).toBe('Amount is required');
    expect(engineText('en', 'mustBeNumber', { label: 'Amount' })).toBe('Amount must be a number');
    expect(engineText('en', 'mustBeDate', { label: 'Due' })).toBe('Due must be a date (YYYY-MM-DD)');
    expect(engineText('en', 'chooseOption', { label: 'Size' })).toBe('Choose one of the options for Size');
  });
});
