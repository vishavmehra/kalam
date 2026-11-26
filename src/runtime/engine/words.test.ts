import { afterEach, describe, expect, it } from 'vitest';
import { registerCatalogue, resetCatalogues } from '@/i18n/catalogue';
import { appT } from './words';
import { spokenDuration, V11_COPY, v11Words } from './v11';

afterEach(() => resetCatalogues());

describe('the words a running app shows', () => {
  it('say the same plain English as before, with the right plural', () => {
    expect(V11_COPY.alsoDeletes(1)).toBe('This also deletes 1 linked entry.');
    expect(V11_COPY.alsoDeletes(3)).toBe('This also deletes 3 linked entries.');
    expect(V11_COPY.alsoClears(1)).toBe('1 linked entry loses the link.');
    expect(V11_COPY.alsoClears(2)).toBe('2 linked entries lose the link.');
    expect(V11_COPY.deleteBlocked(1, 'Orders')).toBe("This can't be deleted: 1 entry in Orders still uses it. Change or delete it first.");
    expect(V11_COPY.deleteBlocked(2, 'Orders')).toBe("This can't be deleted: 2 entries in Orders still use it. Change or delete them first.");
    expect(V11_COPY.reminderWhen(0, 'delivery date', '9:00 AM')).toBe('On the day of delivery date, at 9:00 AM.');
    expect(V11_COPY.reminderWhen(1, 'delivery date', '9:00 AM')).toBe('1 day before delivery date, at 9:00 AM.');
    expect(V11_COPY.reminderWhen(3, 'delivery date', '9:00 AM')).toBe('3 days before delivery date, at 9:00 AM.');
    expect(spokenDuration(3_661_000)).toBe('1 hour 1 minute 1 second');
    expect(V11_COPY.signatureA11y('Customer', true)).toBe('Customer. Signed.');
    expect(V11_COPY.signatureA11y('Customer', false)).toBe('Customer. Not signed yet.');
  });

  it('offer suggested modes in one sentence, one or many', () => {
    const names = V11_COPY.modeNames;
    expect(V11_COPY.modesOffer([names.large])).toBe('This app suggests Large text. Turn it on? You can switch it off again in Settings.');
    expect(V11_COPY.modesOffer([names.large, names.readAloud])).toBe('This app suggests Large text and Read aloud. Turn them on? You can switch them off again in Settings.');
    expect(V11_COPY.modesOffer([names.large, names.simple, names.readAloud])).toBe(
      'This app suggests Large text, Simple mode and Read aloud. Turn them on? You can switch them off again in Settings.',
    );
  });

  it('are in the app language once its catalogue has the words, and in English until then (never a raw key)', () => {
    // A language whose catalogue has not got the words yet shows English.
    expect(v11Words('hi').start).toBe('Start');
    expect(v11Words('xx-ZZ').start).toBe('Start');
    expect(appT('hi')('runtime.v11.signed')).toBe('Signed');
    // Once the language's catalogue carries them, the app's own language wins, whatever language Kalam is shown in.
    registerCatalogue('hi', { $meta: { draft: true }, runtime: { v11: { start: 'शुरू करें', alsoDeletes: { one: 'इससे {count} जुड़ी प्रविष्टि भी हटेगी।', other: 'इससे {count} जुड़ी प्रविष्टियाँ भी हटेंगी।' } } } });
    expect(v11Words('hi').start).toBe('शुरू करें');
    expect(v11Words('hi').alsoDeletes(2)).toBe('इससे 2 जुड़ी प्रविष्टियाँ भी हटेंगी।');
    expect(v11Words('hi').pause).toBe('Pause'); // a word still missing falls back to English
    expect(v11Words('en').start).toBe('Start');
  });
});
