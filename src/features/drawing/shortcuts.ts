/**
 * Keyboard shortcuts of the Drawing Studio (docs/10 §6.3): the one table the canvas listens to and the help sheet shows,
 * so the two cannot drift apart. Key caps are names of physical keys and are not translated; the actions are.
 */
import type { TranslationKey } from '@/i18n/keys';

import type { Tool } from './studio-store';

/** Single letters that pick a tool (canvas focused, not typing). */
export const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: 'select', p: 'pen', m: 'marker', h: 'highlighter', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', t: 'text',
};

export interface ShortcutRow {
  /** Chords that do the same thing; each chord is a list of key caps pressed together. */
  chords: ReadonlyArray<readonly string[]>;
  action: TranslationKey;
}
export interface ShortcutGroup { title: TranslationKey; rows: readonly ShortcutRow[] }

const TOOL_ROWS: ShortcutRow[] = (Object.entries(TOOL_KEYS) as Array<[string, Tool]>).map(([key, tool]) => ({
  chords: [[key.toUpperCase()]],
  action: `studio.tool.${tool}` as const,
}));

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { title: 'studio.shortcuts.tools', rows: TOOL_ROWS },
  {
    title: 'studio.shortcuts.edit',
    rows: [
      { chords: [['Ctrl', 'Z']], action: 'studio.shortcuts.undo' },
      { chords: [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']], action: 'studio.shortcuts.redo' },
      { chords: [['Ctrl', 'S']], action: 'studio.shortcuts.save' },
      { chords: [['Ctrl', 'C']], action: 'studio.shortcuts.copy' },
      { chords: [['Ctrl', 'X']], action: 'studio.shortcuts.cut' },
      { chords: [['Ctrl', 'V']], action: 'studio.shortcuts.paste' },
      { chords: [['Ctrl', 'D']], action: 'studio.shortcuts.duplicate' },
      { chords: [['Ctrl', 'A']], action: 'studio.shortcuts.selectAll' },
      { chords: [['Delete'], ['Backspace']], action: 'studio.shortcuts.delete' },
      { chords: [['Esc']], action: 'studio.shortcuts.deselect' },
    ],
  },
  {
    title: 'studio.shortcuts.arrange',
    rows: [
      { chords: [['Ctrl', 'G']], action: 'studio.shortcuts.group' },
      { chords: [['Ctrl', 'Shift', 'G']], action: 'studio.shortcuts.ungroup' },
      { chords: [['Ctrl', ']']], action: 'studio.shortcuts.toFront' },
      { chords: [['Ctrl', '[']], action: 'studio.shortcuts.toBack' },
      { chords: [[']']], action: 'studio.shortcuts.forward' },
      { chords: [['[']], action: 'studio.shortcuts.backward' },
      { chords: [['←'], ['↑'], ['→'], ['↓']], action: 'studio.shortcuts.nudge' },
      { chords: [['Shift', '←'], ['Shift', '↑'], ['Shift', '→'], ['Shift', '↓']], action: 'studio.shortcuts.nudgeBig' },
    ],
  },
  {
    title: 'studio.shortcuts.view',
    rows: [
      { chords: [['+'], ['Ctrl', '+']], action: 'studio.shortcuts.zoomIn' },
      { chords: [['-'], ['Ctrl', '-']], action: 'studio.shortcuts.zoomOut' },
      { chords: [['0'], ['Ctrl', '0']], action: 'studio.shortcuts.fit' },
      { chords: [['Ctrl', 'Scroll']], action: 'studio.shortcuts.wheel' },
      { chords: [['Space', 'Drag']], action: 'studio.shortcuts.pan' },
      { chords: [['?']], action: 'studio.shortcuts.help' },
    ],
  },
];
