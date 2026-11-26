import { describe, expect, it } from 'vitest';

import {
  clampNumber, dateRangeError, formatNumberText, isRealDate, nextIndex, parseDateText, parseNumberText, rovingAction, roundTo, stepNumber,
  toAsciiDigits, todayIso,
} from './logic';

describe('nextIndex (tabs and radio groups)', () => {
  it('moves with the arrows across and wraps both ways', () => {
    expect(nextIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextIndex('ArrowLeft', 2, 3)).toBe(1);
  });

  it('Home and End jump to the ends', () => {
    expect(nextIndex('Home', 2, 4)).toBe(0);
    expect(nextIndex('End', 0, 4)).toBe(3);
  });

  it('skips disabled items, including at the ends', () => {
    const isDisabled = (i: number) => i === 1 || i === 3;
    expect(nextIndex('ArrowRight', 0, 4, { isDisabled })).toBe(2);
    expect(nextIndex('ArrowRight', 2, 4, { isDisabled })).toBe(0);
    expect(nextIndex('End', 0, 4, { isDisabled })).toBe(2);
    expect(nextIndex('Home', 3, 4, { isDisabled: (i) => i === 0 })).toBe(1);
  });

  it('stays put when every other item is disabled or there is one item', () => {
    expect(nextIndex('ArrowRight', 1, 3, { isDisabled: (i) => i !== 1 })).toBe(1);
    expect(nextIndex('ArrowLeft', 0, 1)).toBe(0);
    expect(nextIndex('Home', 1, 3, { isDisabled: () => true })).toBe(1);
  });

  it('does not wrap when asked not to', () => {
    expect(nextIndex('ArrowRight', 2, 3, { wrap: false })).toBe(2);
    expect(nextIndex('ArrowLeft', 0, 3, { wrap: false })).toBe(0);
    expect(nextIndex('ArrowRight', 0, 3, { wrap: false })).toBe(1);
  });

  it('right to left flips Left and Right but not Up and Down', () => {
    expect(nextIndex('ArrowLeft', 0, 3, { rtl: true })).toBe(1);
    expect(nextIndex('ArrowRight', 1, 3, { rtl: true })).toBe(0);
    expect(nextIndex('ArrowDown', 0, 3, { rtl: true, orientation: 'both' })).toBe(1);
  });

  it('orientation limits which arrows count; other keys are not handled', () => {
    expect(nextIndex('ArrowDown', 0, 3, { orientation: 'horizontal' })).toBeNull();
    expect(nextIndex('ArrowRight', 0, 3, { orientation: 'vertical' })).toBeNull();
    expect(nextIndex('ArrowDown', 0, 3, { orientation: 'vertical' })).toBe(1);
    expect(nextIndex('ArrowUp', 0, 3, { orientation: 'vertical' })).toBe(2);
    expect(nextIndex('ArrowUp', 1, 3, { orientation: 'both' })).toBe(0);
    expect(nextIndex('ArrowRight', 1, 3, { orientation: 'both' })).toBe(2);
    expect(nextIndex('a', 0, 3)).toBeNull();
    expect(nextIndex('Enter', 0, 3)).toBeNull();
    expect(nextIndex('ArrowRight', 0, 0)).toBeNull();
  });

  it('with nothing current, forward lands on the first item and back on the last', () => {
    expect(nextIndex('ArrowRight', -1, 3)).toBe(0);
    expect(nextIndex('ArrowLeft', -1, 3)).toBe(2);
  });
});

describe('rovingAction (one key handler for arrows and Space)', () => {
  it('Space activates only when asked to, so a radio group can be picked by keyboard', () => {
    expect(rovingAction(' ', 1, 3, { activate: true })).toEqual({ kind: 'activate' });
    expect(rovingAction(' ', 1, 3)).toBeNull();
  });
  it('keeps the arrows and Home and End working next to Space', () => {
    const o = { orientation: 'both' as const, activate: true };
    expect(rovingAction('ArrowDown', 0, 3, o)).toEqual({ kind: 'move', to: 1 });
    expect(rovingAction('End', 0, 3, o)).toEqual({ kind: 'move', to: 2 });
    expect(rovingAction('Tab', 0, 3, o)).toBeNull();
  });
});

describe('toAsciiDigits', () => {
  it('reads digits of the shipped scripts', () => {
    expect(toAsciiDigits('१२३')).toBe('123'); // Devanagari
    expect(toAsciiDigits('৪৫')).toBe('45'); // Bengali
    expect(toAsciiDigits('૦૯')).toBe('09'); // Gujarati
    expect(toAsciiDigits('੭')).toBe('7'); // Gurmukhi
    expect(toAsciiDigits('௧௨')).toBe('12'); // Tamil
    expect(toAsciiDigits('౩')).toBe('3'); // Telugu
    expect(toAsciiDigits('೫')).toBe('5'); // Kannada
    expect(toAsciiDigits('൬')).toBe('6'); // Malayalam
    expect(toAsciiDigits('٣٤')).toBe('34'); // Arabic-Indic
    expect(toAsciiDigits('１２')).toBe('12'); // fullwidth
  });

  it('leaves everything else alone', () => {
    expect(toAsciiDigits('12.5 abc अ')).toBe('12.5 abc अ');
  });
});

describe('parseNumberText', () => {
  const ok = (text: string, rules = {}) => {
    const p = parseNumberText(text, rules);
    return p.kind === 'ok' ? p.value : p;
  };

  it('reads plain numbers, signs and spaces', () => {
    expect(ok('12')).toBe(12);
    expect(ok(' 12.5 ')).toBe(12.5);
    expect(ok('-3')).toBe(-3);
    expect(ok('−3')).toBe(-3);
    expect(ok('+4')).toBe(4);
    expect(ok('.5')).toBe(0.5);
    expect(ok('7.')).toBe(7);
  });

  it('reads thousands commas and decimal commas', () => {
    expect(ok('1,23,456')).toBe(123456);
    expect(ok('1,000')).toBe(1000);
    expect(ok('1,234.56')).toBe(1234.56);
    expect(ok('1.234,56')).toBe(1234.56);
    expect(ok('1,5')).toBe(1.5);
    expect(ok('12,50')).toBe(12.5);
  });

  it('reads digits of other scripts', () => {
    expect(ok('१२.५')).toBe(12.5);
    expect(ok('௧௨௩')).toBe(123);
  });

  it('reports empty text as empty, not as an error', () => {
    expect(parseNumberText('')).toEqual({ kind: 'empty' });
    expect(parseNumberText('   ')).toEqual({ kind: 'empty' });
  });

  it('rejects what is not a plain number', () => {
    for (const bad of ['abc', '1e3', '1.2.3', '--1', '-', '.', '12abc', 'Infinity', '0x10', '99999999999999999999']) {
      expect(parseNumberText(bad), bad).toEqual({ kind: 'error', reason: 'invalid' });
    }
  });

  it('rounds typed extra places to decimals', () => {
    expect(ok('12.345', { decimals: 2 })).toBe(12.35);
    expect(ok('12.3', { decimals: 0 })).toBe(12);
    expect(ok('1.005', { decimals: 2 })).toBe(1.01);
  });

  it('flags values outside min and max instead of changing them', () => {
    expect(parseNumberText('5', { min: 10 })).toEqual({ kind: 'error', reason: 'min' });
    expect(parseNumberText('500', { max: 100 })).toEqual({ kind: 'error', reason: 'max' });
    expect(ok('10', { min: 10, max: 10 })).toBe(10);
    expect(ok('-5', { min: -10 })).toBe(-5);
  });
});

describe('number rounding, clamping and stepping', () => {
  it('rounds half away from zero without the float miss', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(0.1 + 0.2, 10)).toBe(0.3);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(0, 2)).toBe(0);
    expect(Object.is(roundTo(-0.001, 2), 0)).toBe(true);
    expect(roundTo(1e-7, 3)).toBe(0);
  });

  it('clamps to the range and rounds when decimals are given', () => {
    expect(clampNumber(5, { min: 10 })).toBe(10);
    expect(clampNumber(500, { max: 100 })).toBe(100);
    expect(clampNumber(50, { min: 10, max: 100 })).toBe(50);
    expect(clampNumber(1.239, { decimals: 2 })).toBe(1.24);
    expect(clampNumber(7)).toBe(7);
  });

  it('steps by one, by step, and cleans float noise', () => {
    expect(stepNumber(5, 1)).toBe(6);
    expect(stepNumber(5, -1)).toBe(4);
    expect(stepNumber(0.2, 1, { step: 0.1 })).toBe(0.3);
    expect(stepNumber(0.3, -1, { step: 0.1 })).toBe(0.2);
    expect(stepNumber(1, 1, { step: 0.25 })).toBe(1.25);
  });

  it('steps from empty, and never leaves the range', () => {
    expect(stepNumber(null, 1)).toBe(1);
    expect(stepNumber(null, 1, { min: 5 })).toBe(5);
    expect(stepNumber(null, -1, { max: -2 })).toBe(-2);
    expect(stepNumber(99, 1, { max: 100, step: 5 })).toBe(100);
    expect(stepNumber(10, -1, { min: 10 })).toBe(10);
    expect(stepNumber(5, 1, { step: 0 })).toBe(6);
  });

  it('formats with fixed places only when decimals are set', () => {
    expect(formatNumberText(12)).toBe('12');
    expect(formatNumberText(12, 2)).toBe('12.00');
    expect(formatNumberText(0.5, 0)).toBe('1');
  });
});

describe('dates', () => {
  const ok = (text: string, rules = {}) => {
    const p = parseDateText(text, rules);
    return p.kind === 'ok' ? p.value : p;
  };

  it('knows real calendar days', () => {
    expect(isRealDate(2024, 2, 29)).toBe(true);
    expect(isRealDate(2026, 2, 29)).toBe(false);
    expect(isRealDate(2026, 4, 31)).toBe(false);
    expect(isRealDate(2026, 13, 1)).toBe(false);
    expect(isRealDate(2026, 0, 10)).toBe(false);
    expect(isRealDate(2100, 2, 29)).toBe(false);
  });

  it('reads year first with any separator and short day or month', () => {
    expect(ok('2026-11-25')).toBe('2026-11-25');
    expect(ok('2026/11/25')).toBe('2026-11-25');
    expect(ok('2026.1.5')).toBe('2026-01-05');
    expect(ok(' 2026-11-25 ')).toBe('2026-11-25');
  });

  it('reads day first when the year is last', () => {
    expect(ok('25/11/2026')).toBe('2026-11-25');
    expect(ok('5-1-2026')).toBe('2026-01-05');
    expect(ok('25.11.2026')).toBe('2026-11-25');
    expect(ok('29/02/2024')).toBe('2024-02-29');
  });

  it('reads digits of other scripts', () => {
    expect(ok('२०२६-११-२५')).toBe('2026-11-25');
    expect(ok('২৫/১১/২০২৬')).toBe('2026-11-25');
  });

  it('reports empty text as empty', () => {
    expect(parseDateText('')).toEqual({ kind: 'empty' });
    expect(parseDateText('  ')).toEqual({ kind: 'empty' });
  });

  it('rejects impossible and malformed dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '31/04/2026', '29/02/2026', 'abc', '2026-11', '11/25/26', '0500-01-01', '2026-11-25x', '20261125']) {
      expect(parseDateText(bad), bad).toEqual({ kind: 'error', reason: 'invalid' });
    }
  });

  it('checks min and max on the canonical date', () => {
    const rules = { min: '2026-01-01', max: '2026-12-31' };
    expect(ok('2026-06-15', rules)).toBe('2026-06-15');
    expect(ok('01/01/2026', rules)).toBe('2026-01-01');
    expect(parseDateText('2025-12-31', rules)).toEqual({ kind: 'error', reason: 'min' });
    expect(parseDateText('01/01/2027', rules)).toEqual({ kind: 'error', reason: 'max' });
    expect(dateRangeError('2026-06-15', rules)).toBeNull();
    expect(dateRangeError('2025-01-01', rules)).toBe('min');
    expect(dateRangeError('2027-01-01', {})).toBeNull();
  });

  it('today is the local calendar date, padded', () => {
    expect(todayIso(new Date(2026, 10, 25, 23, 30))).toBe('2026-11-25');
    expect(todayIso(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
});
