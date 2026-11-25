import { describe, expect, it } from 'vitest';
import { baseLang, languageLabel, onDeviceCanTranslate } from './languages';
import { checkTranslation, extractNumbers, extractPlaceholders, toAsciiDigits } from './validate';

const ok = (source: string, candidate: unknown, lang = 'hi') => {
  const r = checkTranslation(source, candidate, lang);
  return r.ok ? r.text : `rejected:${r.reason}`;
};

describe('checkTranslation', () => {
  it('accepts a normal translation and trims it', () => {
    expect(ok('Save order', '  ऑर्डर सेव करें ')).toBe('ऑर्डर सेव करें');
  });

  it('rejects empty and non-text output instead of blanking a label', () => {
    expect(ok('Save', '   ')).toBe('rejected:empty');
    expect(ok('Save', null)).toBe('rejected:not_text');
    expect(ok('Save', 42)).toBe('rejected:not_text');
  });

  it('keeps {placeholders} and %s exactly', () => {
    expect(ok('Hello {name}', 'नमस्ते {name}')).toBe('नमस्ते {name}');
    expect(ok('Hello {name}', 'नमस्ते {नाम}')).toBe('rejected:placeholders_changed');
    expect(ok('Hello {name}', 'नमस्ते')).toBe('rejected:placeholders_changed');
    expect(ok('Paid %s of %d', '%d में से %s दिए')).toBe('%d में से %s दिए');
    expect(ok('Paid %s', 'दिए गए')).toBe('rejected:placeholders_changed');
  });

  it('keeps numbers, including ones written in native digits', () => {
    expect(ok('Add 5 items', '5 आइटम जोड़ें')).toBe('5 आइटम जोड़ें');
    expect(ok('Add 5 items', '५ आइटम जोड़ें')).toBe('५ आइटम जोड़ें');
    expect(ok('Add 5 items', '6 आइटम जोड़ें')).toBe('rejected:numbers_changed');
    expect(ok('Add items', '5 आइटम जोड़ें')).toBe('rejected:numbers_changed');
    expect(ok('Up to 1,20,000', '1,20,000 तक')).toBe('1,20,000 तक');
    expect(ok('Up to 1,20,000', '120000 तक')).toBe('120000 तक');
  });

  it('rejects Hindi written in Latin letters but accepts brand names left as they are', () => {
    expect(ok('Save order', 'Order save karo')).toBe('rejected:wrong_script');
    expect(ok('WhatsApp', 'WhatsApp')).toBe('WhatsApp');
    expect(ok('Send on WhatsApp', 'WhatsApp पर भेजें')).toBe('WhatsApp पर भेजें');
  });

  it('checks the script for every planned language', () => {
    expect(ok('Orders', 'ऑर्डर', 'mr')).toBe('ऑर्डर');
    expect(ok('Orders', 'ઓર્ડર', 'gu')).toBe('ઓર્ડર');
    expect(ok('Orders', 'ஆர்டர்கள்', 'ta')).toBe('ஆர்டர்கள்');
    expect(ok('Orders', 'ऑर्डर', 'ta')).toBe('rejected:wrong_script');
  });

  it('accepts Latin output when the target is a Latin-script language', () => {
    expect(ok('ऑर्डर', 'Orders', 'en')).toBe('Orders');
  });

  it('rejects runaway output', () => {
    expect(ok('Save', 'क'.repeat(200))).toBe('rejected:too_long');
    expect(ok('Save', 'क'.repeat(500))).toBe('rejected:too_long');
  });

  it('strips control characters and turns line breaks into spaces', () => {
    expect(ok('Save order', 'ऑर्डर\u0007 सेव\nकरें')).toBe('ऑर्डर सेव करें');
  });
});

describe('extractors', () => {
  it('finds placeholders of several styles', () => {
    expect(extractPlaceholders('Hi {name}, you owe %s for {{count}} items <b>now</b> ${total}')).toEqual(
      ['{name}', '%s', '{{count}}', '<b>', '</b>', '${total}'],
    );
  });

  it('normalises digits and thousands separators', () => {
    expect(toAsciiDigits('१२३ ৪৫ ௬')).toBe('123 45 6');
    expect(extractNumbers('1,234 and 2.5 and ७')).toEqual(['1234', '2.5', '7']);
  });
});

describe('language helpers', () => {
  it('normalises tags and names languages', () => {
    expect(baseLang('hi-IN')).toBe('hi');
    expect(baseLang('PA_in')).toBe('pa');
    expect(baseLang('x')).toBe('');
    expect(languageLabel('hi-IN')).toBe('Hindi');
    expect(languageLabel('ml')).toBe('Malayalam');
  });

  it('treats on-device translation as English only until more languages are tested', () => {
    expect(onDeviceCanTranslate('en', 'hi')).toBe(false);
    expect(onDeviceCanTranslate('hi', 'en')).toBe(false);
    expect(onDeviceCanTranslate('en', 'en')).toBe(false);
    expect(onDeviceCanTranslate('en', 'es', ['en', 'es'])).toBe(true);
  });
});
