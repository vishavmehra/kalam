import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';

import { SHORTCUT_GROUPS, TOOL_KEYS } from './shortcuts';
import { TOOL_NAME_KEYS } from './studio-text';

const has = (key: string): boolean => {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return node !== undefined;
};

describe('Studio shortcut help (D10-028)', () => {
  it('uses real words: every title, action and tool name is in the English catalogue', () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(has(g.title), g.title).toBe(true);
      for (const r of g.rows) expect(has(r.action), r.action).toBe(true);
    }
    for (const key of Object.values(TOOL_NAME_KEYS)) expect(has(key), key).toBe(true);
    for (const key of ['studio.shortcuts.title', 'studio.shortcuts.intro', 'studio.shortcuts.or', 'studio.shortcuts.button']) expect(has(key), key).toBe(true);
  });

  it('lists each tool letter the canvas listens to, once', () => {
    const tools = SHORTCUT_GROUPS[0]!.rows;
    expect(tools.map((r) => r.chords[0]![0]!.toLowerCase()).sort()).toEqual(Object.keys(TOOL_KEYS).sort());
    expect(new Set(Object.keys(TOOL_KEYS)).size).toBe(Object.keys(TOOL_KEYS).length);
  });

  it('never lists the same action twice and gives every row at least one chord', () => {
    const actions = SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.action));
    expect(new Set(actions).size).toBe(actions.length);
    for (const g of SHORTCUT_GROUPS) for (const r of g.rows) expect(r.chords.length, r.action).toBeGreaterThan(0);
  });

  it('keeps the shortcuts the canvas handles in the list', () => {
    const chords = SHORTCUT_GROUPS.flatMap((g) => g.rows.flatMap((r) => r.chords.map((c) => c.join('+'))));
    for (const c of ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+S', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+D', 'Ctrl+A', 'Ctrl+G', 'Ctrl+Shift+G', 'Delete', 'Esc', '?']) expect(chords, c).toContain(c);
  });
});
