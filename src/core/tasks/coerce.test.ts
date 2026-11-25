/**
 * Date coercion for spoken and typed values (docs/00 §15, docs/03 §16.4: "delivery Friday").
 * `now` is always injected, so none of these depend on the real clock.
 */
import { describe, expect, it } from 'vitest';
import type { KalamField } from '../spec/schema';
import { coerceFieldValue, coerceRecord, dateDirection, toIsoDate, type DateDirection } from './coerce';
import { extractFields, tokenize } from './voice-service';

// Wednesday 18 November 2026, mid-morning, local time.
const WED = new Date(2026, 10, 18, 10, 0);
const FRI = new Date(2026, 10, 20, 9, 15);
// Monday 28 December 2026, three days after Christmas.
const LATE_DEC = new Date(2026, 11, 28, 10, 0);
const iso = (raw: unknown, now = WED, direction: DateDirection = 'future') => toIsoDate(raw, now, { direction });

describe('toIsoDate relative days', () => {
  it('understands today, tomorrow and yesterday', () => {
    expect(iso('today')).toBe('2026-11-18');
    expect(iso('Today')).toBe('2026-11-18');
    expect(iso('tomorrow')).toBe('2026-11-19');
    expect(iso('yesterday')).toBe('2026-11-17');
  });

  it('understands the day after tomorrow and the day before yesterday', () => {
    expect(iso('day after tomorrow')).toBe('2026-11-20');
    expect(iso('the day after tomorrow')).toBe('2026-11-20');
    expect(iso('day before yesterday')).toBe('2026-11-16');
  });

  it('understands Hindi and Hinglish aaj, kal and parso', () => {
    expect(iso('aaj')).toBe('2026-11-18');
    expect(iso('आज')).toBe('2026-11-18');
    expect(iso('kal')).toBe('2026-11-19');
    expect(iso('कल')).toBe('2026-11-19');
    expect(iso('parso')).toBe('2026-11-20');
    expect(iso('parson')).toBe('2026-11-20');
    expect(iso('परसों')).toBe('2026-11-20');
  });

  it('reads kal and parso backward on a past-facing field', () => {
    expect(iso('kal', WED, 'past')).toBe('2026-11-17');
    expect(iso('कल', WED, 'past')).toBe('2026-11-17');
    expect(iso('parso', WED, 'past')).toBe('2026-11-16');
  });

  it('drops kal and parso when the field does not say which way they point', () => {
    expect(iso('kal', WED, 'unknown')).toBeUndefined();
    expect(iso('कल', WED, 'unknown')).toBeUndefined();
    expect(iso('parso', WED, 'unknown')).toBeUndefined();
  });

  it('reads a plain call as a future-facing field', () => {
    expect(toIsoDate('kal', WED)).toBe('2026-11-19');
    expect(toIsoDate('Friday', WED)).toBe('2026-11-20');
  });

  it('never flips words that are not ambiguous', () => {
    for (const direction of ['past', 'future', 'unknown'] as const) {
      expect(iso('tomorrow', WED, direction)).toBe('2026-11-19');
      expect(iso('yesterday', WED, direction)).toBe('2026-11-17');
      expect(iso('aaj', WED, direction)).toBe('2026-11-18');
      expect(iso('day after tomorrow', WED, direction)).toBe('2026-11-20');
    }
  });

  it('ignores case, extra spaces and trailing punctuation from a transcript', () => {
    expect(iso('  Tomorrow. ')).toBe('2026-11-19');
    expect(iso('DAY   AFTER  TOMORROW!')).toBe('2026-11-20');
    expect(iso('Kal,')).toBe('2026-11-19');
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(toIsoDate('tomorrow', new Date(2026, 11, 30))).toBe('2026-12-31');
    expect(toIsoDate('day after tomorrow', new Date(2026, 11, 30))).toBe('2027-01-01');
    expect(toIsoDate('yesterday', new Date(2027, 0, 1))).toBe('2026-12-31');
    expect(toIsoDate('tomorrow', new Date(2028, 1, 28))).toBe('2028-02-29');
    expect(toIsoDate('tomorrow', new Date(2027, 1, 28))).toBe('2027-03-01');
    expect(toIsoDate('day after tomorrow', new Date(2026, 9, 30))).toBe('2026-11-01');
  });

  it('uses the local calendar day of now, whatever the time', () => {
    expect(toIsoDate('today', new Date(2026, 10, 18, 0, 0, 1))).toBe('2026-11-18');
    expect(toIsoDate('tomorrow', new Date(2026, 10, 18, 23, 59, 59))).toBe('2026-11-19');
  });
});

describe('toIsoDate weekdays', () => {
  it('a bare weekday on a future-facing field is the next such day after today', () => {
    expect(iso('Friday')).toBe('2026-11-20');
    expect(iso('friday')).toBe('2026-11-20');
    expect(iso('Thursday')).toBe('2026-11-19');
    expect(iso('Saturday')).toBe('2026-11-21');
    expect(iso('Sunday')).toBe('2026-11-22');
    expect(iso('Monday')).toBe('2026-11-23');
    expect(iso('Tuesday')).toBe('2026-11-24');
  });

  it('on that same weekday a bare weekday means a week from today', () => {
    expect(iso('Wednesday')).toBe('2026-11-25');
    expect(iso('Friday', FRI)).toBe('2026-11-27');
    // "today" is the word for today.
    expect(iso('today', FRI)).toBe('2026-11-20');
  });

  it('takes short names and "on"', () => {
    expect(iso('fri')).toBe('2026-11-20');
    expect(iso('Mon')).toBe('2026-11-23');
    expect(iso('thurs')).toBe('2026-11-19');
    expect(iso('on Friday')).toBe('2026-11-20');
    expect(iso('Friday.')).toBe('2026-11-20');
  });

  it('a bare weekday on a past-facing field is the latest such day before today', () => {
    expect(iso('Friday', WED, 'past')).toBe('2026-11-13');
    expect(iso('Tuesday', WED, 'past')).toBe('2026-11-17');
    expect(iso('Wednesday', WED, 'past')).toBe('2026-11-11');
    expect(iso('Friday', FRI, 'past')).toBe('2026-11-13');
    expect(iso('on Friday', WED, 'past')).toBe('2026-11-13');
  });

  it('drops a bare weekday when the field does not say which way it points', () => {
    expect(iso('Friday', WED, 'unknown')).toBeUndefined();
    expect(iso('on Friday', WED, 'unknown')).toBeUndefined();
  });

  it('"next" and "coming" always go forward, whatever the field is for', () => {
    for (const direction of ['past', 'future', 'unknown'] as const) {
      expect(iso('next Friday', WED, direction)).toBe('2026-11-20');
      expect(iso('coming Friday', WED, direction)).toBe('2026-11-20');
      expect(iso('next friday', FRI, direction)).toBe('2026-11-27');
    }
  });

  it('"last" and "past" always go back, whatever the field is for', () => {
    for (const direction of ['past', 'future', 'unknown'] as const) {
      expect(iso('last Friday', WED, direction)).toBe('2026-11-13');
      expect(iso('past Friday', WED, direction)).toBe('2026-11-13');
      expect(iso('last friday', FRI, direction)).toBe('2026-11-13');
    }
  });

  it('"this Friday" includes today', () => {
    expect(iso('this Friday')).toBe('2026-11-20');
    expect(iso('this Friday', FRI)).toBe('2026-11-20');
    expect(iso('this Wednesday')).toBe('2026-11-18');
    expect(iso('this Friday', WED, 'past')).toBe('2026-11-20');
    expect(iso('this Friday', WED, 'unknown')).toBe('2026-11-20');
  });

  it('"by", "before", "till", "until" and "upto" read as a deadline, today included', () => {
    for (const phrase of ['by Friday', 'before Friday', 'till Friday', 'until Friday', 'upto Friday', 'up to Friday']) {
      expect(iso(phrase), phrase).toBe('2026-11-20');
      expect(iso(phrase, FRI), phrase).toBe('2026-11-20');
      expect(iso(phrase, WED, 'past'), phrase).toBe('2026-11-20');
      expect(iso(phrase, WED, 'unknown'), phrase).toBe('2026-11-20');
    }
  });

  it('drops a time of day after the weekday', () => {
    for (const phrase of ['Friday evening', 'friday morning', 'Friday afternoon', 'friday night', 'by Friday evening']) {
      expect(iso(phrase), phrase).toBe('2026-11-20');
    }
    expect(iso('monday morning')).toBe('2026-11-23');
  });

  it('rolls over month and year ends', () => {
    expect(toIsoDate('Friday', new Date(2026, 11, 30))).toBe('2027-01-01');
    expect(toIsoDate('Monday', new Date(2026, 10, 27))).toBe('2026-11-30');
  });

  it('does not mistake other words for weekdays', () => {
    for (const word of ['month', 'sunny', 'satisfied', 'next', 'last', 'by', 'friday friday', 'friday tea', 'tuesdays', 'morning']) {
      expect(iso(word), word).toBeUndefined();
    }
  });
});

describe('toIsoDate day and month with no year', () => {
  it('does not fall back to the engine date parser, which reads these as the year 2001', () => {
    for (const text of ['14 November', 'Nov 14', '14th of Nov', 'Friday 14 Nov', '18 nov', '25 December', 'Dec 25']) {
      for (const direction of ['past', 'future', 'unknown'] as const) {
        expect(iso(text, WED, direction), `${text} ${direction}`).not.toMatch(/^2001/);
        expect(iso(text, WED, direction), `${text} ${direction}`).toMatch(/^20(2[5-8])-/);
      }
    }
  });

  it('a future-facing field takes the next such day on or after today', () => {
    expect(iso('14 November')).toBe('2027-11-14');
    expect(iso('Nov 14')).toBe('2027-11-14');
    expect(iso('14th of Nov')).toBe('2027-11-14');
    expect(iso('Friday 14 Nov')).toBe('2027-11-14');
    expect(iso('18 nov')).toBe('2026-11-18');
    expect(iso('25 December')).toBe('2026-12-25');
    expect(iso('Dec 25')).toBe('2026-12-25');
    expect(iso('5/6')).toBe('2027-06-05');
  });

  it('a past-facing field takes the latest such day on or before today', () => {
    expect(iso('14 November', WED, 'past')).toBe('2026-11-14');
    expect(iso('Nov 14', WED, 'past')).toBe('2026-11-14');
    expect(iso('18 nov', WED, 'past')).toBe('2026-11-18');
    expect(iso('25 December', WED, 'past')).toBe('2025-12-25');
    expect(iso('5/6', WED, 'past')).toBe('2026-06-05');
  });

  it('when the field does not say, it takes the day nearest to today', () => {
    expect(iso('14 November', WED, 'unknown')).toBe('2026-11-14');
    expect(iso('25 December', WED, 'unknown')).toBe('2026-12-25');
    expect(iso('5/6', WED, 'unknown')).toBe('2026-06-05');
  });

  it('late in December, 25 December is behind and the same year is still the nearest', () => {
    expect(iso('25 December', LATE_DEC)).toBe('2027-12-25');
    expect(iso('Dec 25', LATE_DEC)).toBe('2027-12-25');
    expect(iso('25 December', LATE_DEC, 'past')).toBe('2026-12-25');
    expect(iso('Dec 25', LATE_DEC, 'past')).toBe('2026-12-25');
    expect(iso('25 December', LATE_DEC, 'unknown')).toBe('2026-12-25');
    expect(iso('2 January', LATE_DEC)).toBe('2027-01-02');
    expect(iso('2 January', LATE_DEC, 'unknown')).toBe('2027-01-02');
    expect(iso('2 January', LATE_DEC, 'past')).toBe('2026-01-02');
  });

  it('29 February finds the nearest leap year', () => {
    expect(iso('Feb 29')).toBe('2028-02-29');
    expect(iso('29 February')).toBe('2028-02-29');
    expect(iso('29 February', WED, 'past')).toBe('2024-02-29');
  });

  it('an explicit year is kept as written', () => {
    expect(iso('14 November 2025')).toBe('2025-11-14');
    expect(iso('Nov 14, 2025', WED, 'future')).toBe('2025-11-14');
    expect(iso('Thursday, November 5, 2026')).toBe('2026-11-05');
    expect(iso('5th November 2026')).toBe('2026-11-05');
  });

  it('drops a day and month that do not exist, or that are not a date', () => {
    for (const text of ['31 February', '30 Feb 2026', '32 November', 'Foo 14', '14 Foo', '14 November 20260']) {
      expect(iso(text), text).toBeUndefined();
    }
  });

  it('without a clock a day and month with no year is dropped, not guessed', () => {
    expect(toIsoDate('14 November')).toBeUndefined();
    expect(toIsoDate('5/6')).toBeUndefined();
    expect(toIsoDate('14 November 2025')).toBe('2025-11-14');
  });
});

describe('toIsoDate other formats stay as they were', () => {
  it('reads ISO, day-first D/M/Y and English dates', () => {
    expect(iso('2026-11-05')).toBe('2026-11-05');
    expect(iso('2026-1-5')).toBe('2026-01-05');
    expect(iso('2026-11-05T10:30:00Z')).toBe('2026-11-05');
    expect(iso('05/11/2026')).toBe('2026-11-05');
    expect(iso('5.11.26')).toBe('2026-11-05');
    expect(iso('5.11.2026.')).toBe('2026-11-05');
    expect(iso('Nov 5, 2026')).toBe('2026-11-05');
  });

  it('reads full dates without a clock', () => {
    expect(toIsoDate('2026-11-05')).toBe('2026-11-05');
    expect(toIsoDate('05/11/2026')).toBe('2026-11-05');
  });

  it('drops anything that is not a real date', () => {
    expect(iso('')).toBeUndefined();
    expect(iso('   ')).toBeUndefined();
    expect(iso('banana')).toBeUndefined();
    expect(iso('2026-02-30')).toBeUndefined();
    expect(iso('31/13/2026')).toBeUndefined();
    expect(iso(20261105)).toBeUndefined();
    expect(iso(null)).toBeUndefined();
    expect(iso(undefined)).toBeUndefined();
  });

  it('without a clock, relative words are dropped so a scanned slip is never resolved against the scan time', () => {
    for (const word of ['today', 'tomorrow', 'kal', 'Friday', 'next Friday', 'by Friday']) {
      expect(toIsoDate(word), word).toBeUndefined();
    }
  });
});

describe('dateDirection', () => {
  it('reads a label that says the date is still to come as future', () => {
    for (const label of [
      'Delivery date', 'Delivery', 'Due', 'Payment due', 'Paid until', 'Prepaid until', 'Sale ends', 'Expense due date',
      'Purchase order delivery', 'Delivery of purchased goods', 'Next entry', 'Purchase deadline', 'Appointment',
      'Renewal date', 'Expires on',
    ]) {
      expect(dateDirection(label), label).toBe('future');
    }
  });

  it('reads a label that says it already happened as past', () => {
    for (const label of ['Paid on', 'Date of purchase', 'Expense date', 'Date of birth', 'Delivered on', 'Sold on', 'Joined']) {
      expect(dateDirection(label), label).toBe('past');
    }
  });

  it('reads Hindi labels', () => {
    expect(dateDirection('भुगतान की तारीख')).toBe('past');
    expect(dateDirection('खरीद की तारीख')).toBe('past');
    expect(dateDirection('जन्म तिथि')).toBe('past');
    expect(dateDirection('डिलीवरी की तारीख')).toBe('future');
    expect(dateDirection('अंतिम तारीख')).toBe('future');
    expect(dateDirection('kharcha date')).toBe('past');
  });

  it('does not guess from a plain label', () => {
    for (const label of ['Date', 'date', 'दिनांक', 'तारीख', 'Start date', 'Visit date', 'When', 'Prepaid', '']) {
      expect(dateDirection(label), label).toBe('unknown');
    }
  });

  it('does not match part of a word', () => {
    expect(dateDirection('Prepaid')).toBe('unknown');
    expect(dateDirection('Weekend')).toBe('unknown');
    expect(dateDirection('Credit')).toBe('unknown');
  });

  it('uses the field id when the label is just "Date"', () => {
    expect(dateDirection('Date', 'paid_on')).toBe('past');
    expect(dateDirection('Date', 'delivery_date')).toBe('future');
    expect(dateDirection('Date', 'date')).toBe('unknown');
    expect(dateDirection('Date', undefined)).toBe('unknown');
  });

  it('lets a word that points forward win over one that points back', () => {
    expect(dateDirection('Paid until')).toBe('future');
    expect(dateDirection('Purchase deadline')).toBe('future');
    expect(dateDirection('Date', 'purchase_due')).toBe('future');
  });
});

describe('coerceFieldValue for date fields', () => {
  const date = (label: string): KalamField => ({ type: 'date', label });

  it('reads kal as tomorrow on a delivery date and as yesterday on a payment date', () => {
    expect(coerceFieldValue(date('Delivery date'), 'kal', WED)).toBe('2026-11-19');
    expect(coerceFieldValue(date('Due'), 'kal', WED)).toBe('2026-11-19');
    expect(coerceFieldValue(date('Paid on'), 'kal', WED)).toBe('2026-11-17');
    expect(coerceFieldValue(date('Date of purchase'), 'kal', WED)).toBe('2026-11-17');
    expect(coerceFieldValue(date('Expense date'), 'parso', WED)).toBe('2026-11-16');
    expect(coerceFieldValue(date('Date of birth'), 'कल', WED)).toBe('2026-11-17');
  });

  it('reads kal on a Hindi label by the label', () => {
    expect(coerceFieldValue(date('भुगतान की तारीख'), 'kal', WED)).toBe('2026-11-17');
    expect(coerceFieldValue(date('भुगतान की तारीख'), 'कल', WED)).toBe('2026-11-17');
    expect(coerceFieldValue(date('डिलीवरी की तारीख'), 'कल', WED)).toBe('2026-11-19');
  });

  it('a label with a word that points forward is not flipped by a word that points back', () => {
    for (const label of ['Paid until', 'Sale ends', 'Expense due date', 'Purchase order delivery', 'Delivery of purchased goods', 'Next entry', 'Purchase deadline']) {
      expect(coerceFieldValue(date(label), 'kal', WED), label).toBe('2026-11-19');
    }
    expect(coerceFieldValue(date('Delivered on'), 'kal', WED)).toBe('2026-11-17');
  });

  it('does not guess kal, parso or a bare weekday on a plain "Date" field', () => {
    for (const label of ['Date', 'दिनांक', 'तारीख', 'Visit date', 'Start date']) {
      expect(coerceFieldValue(date(label), 'kal', WED), label).toBeUndefined();
      expect(coerceFieldValue(date(label), 'parso', WED), label).toBeUndefined();
      expect(coerceFieldValue(date(label), 'Friday', WED), label).toBeUndefined();
      expect(coerceFieldValue(date(label), 'on Friday', WED), label).toBeUndefined();
    }
  });

  it('still reads words that are not ambiguous on a plain "Date" field', () => {
    expect(coerceFieldValue(date('Date'), 'yesterday', WED)).toBe('2026-11-17');
    expect(coerceFieldValue(date('Date'), 'aaj', WED)).toBe('2026-11-18');
    expect(coerceFieldValue(date('Date'), 'last Friday', WED)).toBe('2026-11-13');
    expect(coerceFieldValue(date('Date'), 'by Friday', WED)).toBe('2026-11-20');
    expect(coerceFieldValue(date('Date'), '2026-11-05', WED)).toBe('2026-11-05');
  });

  it('uses the field id when the label alone does not say', () => {
    expect(coerceFieldValue(date('Date'), 'kal', WED, { id: 'paid_on' })).toBe('2026-11-17');
    expect(coerceFieldValue(date('Date'), 'kal', WED, { id: 'delivery_date' })).toBe('2026-11-19');
    expect(coerceFieldValue(date('Date'), 'kal', WED, { id: 'date' })).toBeUndefined();
  });

  it('reads a day and month with no year by the label', () => {
    expect(coerceFieldValue(date('Delivery date'), '25 December', LATE_DEC)).toBe('2027-12-25');
    expect(coerceFieldValue(date('Paid on'), '25 December', LATE_DEC)).toBe('2026-12-25');
    expect(coerceFieldValue(date('Delivery date'), '25 December', WED)).toBe('2026-12-25');
    expect(coerceFieldValue(date('Paid on'), 'Dec 25', WED)).toBe('2025-12-25');
    expect(coerceFieldValue(date('Date'), '14 November', WED)).toBe('2026-11-14');
  });

  it('reads "delivery Friday" as the next Friday', () => {
    expect(coerceFieldValue(date('Delivery date'), 'Friday', WED)).toBe('2026-11-20');
    expect(coerceFieldValue(date('Delivery'), 'friday', FRI)).toBe('2026-11-27');
  });

  it('does not flip a label that only contains part of a word', () => {
    expect(coerceFieldValue(date('Payment due'), 'kal', WED)).toBe('2026-11-19');
    expect(coerceFieldValue(date('Prepaid until'), 'kal', WED)).toBe('2026-11-19');
  });

  it('drops relative words and dates with no year when there is no clock', () => {
    expect(coerceFieldValue(date('Delivery date'), 'Friday')).toBeUndefined();
    expect(coerceFieldValue(date('Delivery date'), 'kal')).toBeUndefined();
    expect(coerceFieldValue(date('Delivery date'), '14 November')).toBeUndefined();
    expect(coerceFieldValue(date('Delivery date'), '2026-11-14')).toBe('2026-11-14');
  });

  it('still drops values that are not dates', () => {
    expect(coerceFieldValue(date('Delivery date'), 'whenever', WED)).toBeUndefined();
    expect(coerceFieldValue(date('Delivery date'), 12, WED)).toBeUndefined();
    expect(coerceFieldValue(date('Delivery date'), null, WED)).toBeUndefined();
  });
});

describe('coerceRecord', () => {
  const defs: Record<string, KalamField> = {
    customer: { type: 'text', label: 'Customer' },
    delivery: { type: 'date', label: 'Delivery date' },
    paid_on: { type: 'date', label: 'Paid on' },
    stamped: { type: 'date', label: 'Date' },
  };

  it('coerces a whole record, keeping only fields that fit', () => {
    expect(coerceRecord(defs, { customer: 'Raju', delivery: 'Friday', paid_on: 'kal', extra: 'x' }, WED)).toEqual({
      customer: 'Raju', delivery: '2026-11-20', paid_on: '2026-11-17',
    });
  });

  it('uses each field id as a hint', () => {
    expect(coerceRecord({ paid_on: { type: 'date', label: 'Date' } }, { paid_on: 'kal' }, WED)).toEqual({ paid_on: '2026-11-17' });
    expect(coerceRecord({ delivery_date: { type: 'date', label: 'Date' } }, { delivery_date: 'kal' }, WED)).toEqual({ delivery_date: '2026-11-19' });
  });

  it('without a clock (text read from a photo) keeps full dates and drops relative words', () => {
    expect(coerceRecord(defs, { customer: 'Raju', delivery: 'Friday', paid_on: 'kal', stamped: '2026-11-18' })).toEqual({
      customer: 'Raju', stamped: '2026-11-18',
    });
  });

  it('ignores inherited keys and non-objects', () => {
    expect(coerceRecord(defs, { constructor: 'x', __proto__: 'y' }, WED)).toEqual({});
    expect(coerceRecord(defs, null, WED)).toEqual({});
    expect(coerceRecord(defs, ['Friday'], WED)).toEqual({});
  });
});

describe('spoken dates through field extraction (docs/00 §15, docs/03 §16.4)', () => {
  const defs: Record<string, KalamField> = {
    customer: { type: 'text', label: 'Customer' },
    chest: { type: 'number', label: 'Chest' },
    garment: { type: 'enum', label: 'Garment', options: ['Kurta', 'Shirt'] },
    delivery: { type: 'date', label: 'Delivery' },
    paid_on: { type: 'date', label: 'Paid on' },
  };
  const heard = (text: string, now = WED) => extractFields(tokenize(text), defs, new Set(), now);

  it('fills the tailor order from "kurta, chest forty, delivery Friday"', () => {
    expect(heard('kurta chest forty delivery Friday')).toEqual({ garment: 'Kurta', chest: 40, delivery: '2026-11-20' });
  });

  it('fills every field of a longer sentence', () => {
    expect(heard('customer Raju garment kurta chest forty delivery Friday')).toEqual({
      customer: 'Raju', garment: 'Kurta', chest: 40, delivery: '2026-11-20',
    });
  });

  it('keeps the date when it comes before the next field name', () => {
    expect(heard('delivery by Friday customer Raju')).toEqual({ customer: 'Raju', delivery: '2026-11-20' });
    expect(heard('delivery Friday evening customer Raju')).toEqual({ customer: 'Raju', delivery: '2026-11-20' });
    expect(heard('delivery till Friday customer Raju')).toEqual({ customer: 'Raju', delivery: '2026-11-20' });
  });

  it('reads kal by the field', () => {
    expect(heard('delivery kal')).toEqual({ delivery: '2026-11-19' });
    expect(heard('paid on kal')).toEqual({ paid_on: '2026-11-17' });
  });

  it('puts a spoken day and month in the right year', () => {
    expect(heard('delivery 25 December')).toEqual({ delivery: '2026-12-25' });
    expect(heard('delivery 25 December', LATE_DEC)).toEqual({ delivery: '2027-12-25' });
    expect(heard('paid on 25 December', LATE_DEC)).toEqual({ paid_on: '2026-12-25' });
    expect(heard('paid on 14 November')).toEqual({ paid_on: '2026-11-14' });
  });

  it('leaves a plain "Date" field empty for an ambiguous word', () => {
    const plain: Record<string, KalamField> = { when: { type: 'date', label: 'Date' }, amount: { type: 'number', label: 'Amount' } };
    expect(extractFields(tokenize('amount 200 date kal'), plain, new Set(), WED)).toEqual({ amount: 200 });
    expect(extractFields(tokenize('amount 200 date yesterday'), plain, new Set(), WED)).toEqual({ amount: 200, when: '2026-11-17' });
  });
});
