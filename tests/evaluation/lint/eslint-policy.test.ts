/**
 * Pins the lint policy in eslint.config.js: the safety rules, the src/core boundary and the React Native
 * accessibility rules. Lints small snippets in memory with the real config, so a loosened rule fails a test
 * instead of going unnoticed. Nothing on disk is read or changed.
 */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

type Lint = (
  code: string,
  filePath: string,
) => Promise<Array<{ ruleId: string | null; severity: number; message: string }>>;
let lint: Lint;

beforeAll(async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: ROOT });
  lint = async (code, filePath) => {
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? []).map((m) => ({ ruleId: m.ruleId, severity: m.severity, message: m.message }));
  };
}, 60_000);

const ids = (messages: Awaited<ReturnType<Lint>>, severity?: number) =>
  messages.filter((m) => severity === undefined || m.severity === severity).map((m) => m.ruleId);

describe('safety rules', () => {
  it('rejects eval, new Function and string timers as errors', async () => {
    const code = [
      'export function run(code: string) {',
      '  eval(code);',
      "  const f = new Function('return 1');",
      "  setTimeout('alert(1)', 10);",
      '  return f;',
      '}',
    ].join('\n');
    const errors = ids(await lint(code, 'src/features/x.ts'), 2);
    expect(errors).toEqual(expect.arrayContaining(['no-eval', 'no-new-func', 'no-implied-eval']));
  });

  it('rejects javascript: URLs', async () => {
    expect(ids(await lint("export const href = 'javascript:alert(1)';\n", 'src/features/x.ts'), 2)).toContain(
      'no-script-url',
    );
  });

  it('allows the string "javascript:" in detectors and attack fixtures', async () => {
    const code = "export const attack = 'javascript:alert(1)';\n";
    expect(ids(await lint(code, 'src/core/spec/validate.ts'), 2)).not.toContain('no-script-url');
    expect(ids(await lint(code, 'src/core/edit/edit.test.ts'), 2)).not.toContain('no-script-url');
  });

  it('treats breaking the rules of hooks as an error', async () => {
    const code = [
      "import { useState } from 'react';",
      'export function Bad({ on }: { on: boolean }) {',
      '  if (on) { useState(0); }',
      '  return null;',
      '}',
    ].join('\n');
    expect(ids(await lint(code, 'src/features/Bad.tsx'), 2)).toContain('react-hooks/rules-of-hooks');
  });
});

describe('src/core boundary', () => {
  const restricted = (messages: Awaited<ReturnType<Lint>>) =>
    messages.filter((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2);

  it.each([
    ['react', "import { useState } from 'react';"],
    ['react-native', "import { View } from 'react-native';"],
    ['a react-native package', "import Svg from 'react-native-svg';"],
    ['an expo package', "import * as FS from 'expo-file-system';"],
    ['an expo subpath', "import { x } from 'expo-router/build/foo';"],
    ['firebase/ai', "import { getAI } from 'firebase/ai';"],
    ['firebase/app', "import { initializeApp } from 'firebase/app';"],
    ['the infrastructure layer', "import { getDatabase } from '@/infrastructure/storage/database';"],
    ['the features layer', "import { summarizeDrawing } from '@/features/drawing/model/summarize';"],
    ['the runtime layer', "import { evaluate } from '@/runtime/engine';"],
    ['the services layer', "import { getServices } from '@/services';"],
    ['a layer by relative path', "import { x } from '../../features/drawing/model';"],
  ])('forbids src/core importing %s', async (_name, code) => {
    expect(
      restricted(await lint(`${code}\nexport const used = 1;\n`, 'src/core/pipeline/x.ts')).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['the i18n React hooks by alias', "import { useT } from '@/i18n/react';"],
    ['the i18n React hooks by path', "import { useT } from '../../i18n/react';"],
    ['the i18n index', "import { x } from '@/i18n';"],
    ['the i18n index by path', "import { x } from '../../i18n';"],
  ])('allows only the pure i18n tables, so it forbids src/core importing %s', async (_name, code) => {
    expect(
      restricted(await lint(`${code}\nexport const used = 1;\n`, 'src/core/i18n-labels/x.ts')).length,
    ).toBeGreaterThan(0);
  });

  it('lets core tests use the real infrastructure, but still not the frameworks', async () => {
    const integration =
      "import { createWebDatabase } from '@/infrastructure/storage/database.web';\nexport const x = createWebDatabase;\n";
    expect(restricted(await lint(integration, 'src/core/backup/x.test.ts'))).toEqual([]);
    expect(restricted(await lint(integration, 'src/core/backup/x.ts')).length).toBeGreaterThan(0);
    expect(
      restricted(
        await lint("import { getAI } from 'firebase/ai';\nexport const x = getAI;\n", 'src/core/backup/x.test.ts'),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('applies to tests inside src/core too, so they keep running in Node', async () => {
    expect(
      restricted(
        await lint("import { render } from 'react-native';\nexport const x = render;\n", 'src/core/spec/x.test.ts'),
      ).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["import { z } from 'zod';"],
    ["import type { KalamSpec } from '@/core/spec/schema';"],
    ["import { applyPatch } from 'fast-json-patch';"],
    ["import { validateSpec } from '../spec/validate';"],
    ["import { x } from './local';"],
    ["import { readFileSync } from 'node:fs';"],
    ["import { LANGUAGES } from '../../i18n/languages';"],
    ["import { scriptForLanguage } from '@/i18n/scripts';"],
  ])('allows src/core to import %s', async (code) => {
    expect(restricted(await lint(`${code}\nexport const used = 1;\n`, 'src/core/pipeline/x.ts'))).toEqual([]);
  });

  it('does not restrict the other layers', async () => {
    const code =
      "import { View } from 'react-native';\nimport { getAI } from 'firebase/ai';\nexport const x = [View, getAI];\n";
    expect(restricted(await lint(code, 'src/features/x.ts'))).toEqual([]);
    expect(restricted(await lint(code, 'src/infrastructure/firebase/x.ts'))).toEqual([]);
  });
});

describe('React Native accessibility rules', () => {
  const warns = (messages: Awaited<ReturnType<Lint>>) => messages.filter((m) => m.ruleId?.startsWith('kalam-a11y/'));
  const file = 'src/features/x/Thing.tsx';
  const wrap = (jsx: string) =>
    `import { Image, Pressable, TextInput } from 'react-native';\nexport function T() {\n  return (\n    ${jsx}\n  );\n}\n`;

  it('asks a pressable with no name and no role for both', async () => {
    const found = warns(await lint(wrap('<Pressable onPress={() => {}}><Icon /></Pressable>'), file));
    expect(found.map((m) => m.ruleId)).toEqual([
      'kalam-a11y/pressable-name-and-role',
      'kalam-a11y/pressable-name-and-role',
    ]);
    expect(found.map((m) => m.message).join(' ')).toMatch(/accessible name/);
    expect(found.map((m) => m.message).join(' ')).toMatch(/needs a role/);
  });

  it('accepts a named pressable with a role, text inside it, spread props or hidden decoration', async () => {
    for (const jsx of [
      '<Pressable role="button" accessibilityLabel="Save" onPress={f} />',
      '<Pressable role="button" aria-label="Save" onPress={f} />',
      '<Pressable role="button" onPress={f}><Text>Save</Text></Pressable>',
      '<Pressable {...props} />',
      '<Pressable aria-hidden onPress={f} />',
    ]) {
      expect(warns(await lint(wrap(jsx), file)), jsx).toEqual([]);
    }
  });

  it('asks an image for alt text and a text input for a name', async () => {
    expect(warns(await lint(wrap('<Image source={s} />'), file)).map((m) => m.ruleId)).toEqual([
      'kalam-a11y/image-has-alt',
    ]);
    expect(warns(await lint(wrap('<Image source={s} alt="A tailor" />'), file))).toEqual([]);
    expect(warns(await lint(wrap('<Image source={s} accessible={false} />'), file))).toEqual([]);
    expect(warns(await lint(wrap('<TextInput placeholder="Name" />'), file)).map((m) => m.ruleId)).toEqual([
      'kalam-a11y/textinput-has-name',
    ]);
    expect(warns(await lint(wrap('<TextInput aria-label="Name" />'), file))).toEqual([]);
  });

  it('only applies to UI files, as warnings that do not fail CI', async () => {
    const messages = await lint(wrap('<Pressable onPress={f} />'), file);
    expect(warns(messages).every((m) => m.severity === 1)).toBe(true);
    expect(warns(await lint(wrap('<Pressable onPress={f} />'), 'tests/evaluation/x.tsx'))).toEqual([]);
  });
});
