/**
 * Simple mode in the runtime (docs/10 §4.3): only a secondary component is folded away, essential and standard ones stay,
 * "Show more" brings the folded ones back for one screen, and nothing is deleted either way.
 */
import { describe, expect, it } from 'vitest';
import type { AccessModes } from '@/core/contracts';
import { kalamSpecSchema, type KalamScreen } from '@/core/spec/schema';
import { foldedCount, visibleChildren } from './theme';

const OFF: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const ON: AccessModes = { ...OFF, simple: true };

const spec = kalamSpecSchema.parse({
  id: 'app_simple', schemaVersion: '1.1.0', version: 1, name: 'Simple', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: { notes: { fields: { title: { type: 'text', label: 'Title' }, phone: { type: 'text', label: 'Phone' } } } },
  screens: [{
    id: 'home', title: 'Home', form: 'notes', children: [
      { id: 'pay', type: 'bigButton', label: 'Save', action: 'save', importance: 'essential' },
      { id: 'title_in', type: 'textInput', label: 'Title', field: 'title' },
      { id: 'tip', type: 'text', label: 'Tip', importance: 'secondary' },
      { id: 'old_tip', type: 'text', label: 'Old tip', secondary: true },
      { id: 'kept_by_level', type: 'text', label: 'Kept', importance: 'essential', secondary: true },
      { id: 'shown_by_level', type: 'text', label: 'Standard', importance: 'standard', secondary: true },
      { id: 'hidden', type: 'text', label: 'Hidden', visible: false },
      { id: 'hidden_tip', type: 'text', label: 'Hidden tip', importance: 'secondary', visible: false },
      { id: 'people', type: 'list', source: 'notes', primary: 'title', secondary: 'phone' },
    ],
  }],
  initialScreen: 'home', actions: { save: { type: 'insert', collection: 'notes' } }, aiBlocks: {}, intents: {}, meta: { createdAt: 0 },
});
const home: KalamScreen = spec.screens[0];
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((c) => c.id);

describe('visibleChildren with Simple mode', () => {
  it('shows everything that is not hidden when Simple mode is off', () => {
    expect(ids(visibleChildren(home, OFF))).toEqual(
      ['pay', 'title_in', 'tip', 'old_tip', 'kept_by_level', 'shown_by_level', 'people'],
    );
  });

  it('folds away only the secondary ones, by level or by the old flag', () => {
    const shown = ids(visibleChildren(home, ON));
    expect(shown).toEqual(['pay', 'title_in', 'kept_by_level', 'shown_by_level', 'people']);
    expect(shown).not.toContain('tip');
    expect(shown).not.toContain('old_tip');
  });

  it('keeps an essential part even when the old flag also marks it, and a list with a second-line field', () => {
    const shown = ids(visibleChildren(home, ON));
    expect(shown).toContain('kept_by_level');
    expect(shown).toContain('shown_by_level');
    expect(shown).toContain('people');
  });

  it('brings the folded ones back with "show more", in their own order, and never the hidden ones', () => {
    expect(ids(visibleChildren(home, ON, { showMore: true }))).toEqual(ids(visibleChildren(home, OFF)));
    expect(ids(visibleChildren(home, ON, { showMore: true }))).not.toContain('hidden_tip');
  });

  it('does not change the spec', () => {
    const before = JSON.stringify(spec);
    visibleChildren(home, ON);
    foldedCount(home, ON);
    expect(JSON.stringify(spec)).toBe(before);
    expect(home.children).toHaveLength(9);
  });
});

describe('foldedCount', () => {
  it('counts what Simple mode folds away on the screen, without the ones the app hid itself', () => {
    expect(foldedCount(home, ON)).toBe(2);
  });

  it('is zero when Simple mode is off', () => {
    expect(foldedCount(home, OFF)).toBe(0);
  });
});
