/**
 * Right-to-left readiness (docs/10 §13.6, D10-043): the shell and the feature screens say "start" and "end", never "left"
 * and "right", so a language that reads right to left can be switched on without redrawing every screen. The few files
 * that must stay physical are named here with the reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const DIRS = [
  'design', 'components', 'app/bazaar', 'app/app',
  'features/settings', 'features/shelf', 'features/landing', 'features/account', 'features/auth', 'features/history',
  'features/reports', 'features/share', 'features/widgets', 'features/collab', 'features/formula-assist', 'features/assistant',
  'features/reminders', 'features/storage', 'features/bazaar', 'features/bazaar-moderation', 'features/drawing',
];
const FILES = ['app/_layout.tsx', 'app/onboarding.tsx', 'app/settings.tsx', 'app/+not-found.tsx'];

/** Physical on purpose: positions in a drawn scene or on the drawing canvas, and the Studio's handedness edges. */
const PHYSICAL_OK = new Set([
  'features/landing/HeroPoster.tsx', 'features/landing/HeroStage.native.tsx',
  'features/drawing/DrawingCanvas.web.tsx', 'features/drawing/DrawingStudioScreen.tsx', 'features/drawing/TextEditOverlay.tsx',
]);

const KEYS = /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\b|\b(?:left|right):\s*[-\d(]|textAlign:\s*'(?:left|right)'/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
}

describe('logical style properties (D10-043)', () => {
  const files: string[] = [];
  for (const d of DIRS) walk(join(SRC, d), files);
  for (const f of FILES) files.push(join(SRC, f));
  const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');

  it('finds the files it is meant to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('uses start and end in every file that is not a drawn scene or the canvas', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (PHYSICAL_OK.has(rel(f))) continue;
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!line.trimStart().startsWith('//') && KEYS.test(line)) bad.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('keeps every physical exception explained in the file itself', () => {
    for (const f of PHYSICAL_OK) {
      const text = readFileSync(join(SRC, f), 'utf8');
      expect(/artwork coordinates|Physical sides on purpose|canvas|document coordinates/i.test(text), f).toBe(true);
    }
  });
});
