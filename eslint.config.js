/**
 * Kalam lint policy (docs/13 §3, §20.1; docs/04 §22.4). Flat config, CommonJS (package.json has no "type").
 *
 *  - Base: eslint-config-expo (TypeScript, React, React Hooks, Expo rules).
 *  - Safety: no eval, no new Function, no implied eval. KalamSpec is data, never code (CLAUDE.md §9).
 *  - Boundary: src/core is pure TypeScript. It must not import React, React Native, Expo or Firebase, and must not
 *    reach up into the UI, runtime, infrastructure or services layers (docs/04 §3, CLAUDE.md rule 2).
 *  - Accessibility: small React Native rules defined below, because eslint-plugin-jsx-a11y targets the DOM and
 *    eslint-plugin-react-native-a11y is not installed. They check the things a person using a screen reader hits.
 *
 * Severities are chosen so a first CI run is not drowned in old findings: security and boundary rules are errors,
 * style and React Compiler rules are warnings. Raise a warning to an error once its count reaches zero.
 */
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

// ─── Accessibility rules for React Native elements ────────────────────────────────────────────
const NAME_PROPS = ['accessibilityLabel', 'aria-label', 'aria-labelledby', 'accessibilityLabelledBy'];
const HIDDEN_PROPS = ['aria-hidden', 'accessibilityElementsHidden', 'importantForAccessibility'];
const PRESSABLES = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
]);

const hasProp = (node, names) =>
  node.attributes.some(
    (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && names.includes(a.name.name),
  );
const hasSpread = (node) => node.attributes.some((a) => a.type === 'JSXSpreadAttribute');
const hasTextChild = (el) =>
  (el.children ?? []).some(
    (c) =>
      (c.type === 'JSXText' && c.value.trim() !== '') ||
      (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') ||
      (c.type === 'JSXElement' && /Text$/.test(c.openingElement.name.name ?? '')),
  );

const a11yPlugin = {
  meta: { name: 'kalam-a11y' },
  rules: {
    'pressable-name-and-role': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          name: '{{name}} needs an accessible name: add accessibilityLabel or aria-label, or put text inside it.',
          role: '{{name}} needs a role: add role or accessibilityRole so assistive technology knows it is a button or link.',
        },
      },
      create(context) {
        return {
          JSXElement(el) {
            const open = el.openingElement;
            const name = open.name.type === 'JSXIdentifier' ? open.name.name : undefined;
            if (!name || !PRESSABLES.has(name) || hasSpread(open) || hasProp(open, HIDDEN_PROPS)) return;
            if (!hasProp(open, NAME_PROPS) && !hasTextChild(el))
              context.report({ node: open, messageId: 'name', data: { name } });
            if (!hasProp(open, ['role', 'accessibilityRole']))
              context.report({ node: open, messageId: 'role', data: { name } });
          },
        };
      },
    },
    'image-has-alt': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          alt: 'Add alt or accessibilityLabel to this image, or hide it from assistive technology if it is decoration.',
        },
      },
      create(context) {
        return {
          JSXOpeningElement(open) {
            if (open.name.type !== 'JSXIdentifier' || open.name.name !== 'Image') return;
            if (hasSpread(open) || hasProp(open, ['alt', ...NAME_PROPS, ...HIDDEN_PROPS, 'accessible'])) return;
            context.report({ node: open, messageId: 'alt' });
          },
        };
      },
    },
    'textinput-has-name': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          name: 'A TextInput needs an accessible name: add accessibilityLabel, aria-label or aria-labelledby. A placeholder is not a label.',
        },
      },
      create(context) {
        return {
          JSXOpeningElement(open) {
            if (open.name.type !== 'JSXIdentifier' || open.name.name !== 'TextInput') return;
            if (hasSpread(open) || hasProp(open, [...NAME_PROPS, ...HIDDEN_PROPS])) return;
            context.report({ node: open, messageId: 'name' });
          },
        };
      },
    },
  },
};

// ─── Boundary: src/core ────────────────────────────────────────────────────────────────────────
const FRAMEWORK_MESSAGE =
  'src/core is pure TypeScript and must run in Node under Vitest. Put UI, platform and SDK code in src/features, src/runtime or src/infrastructure.';
const LAYER_MESSAGE =
  'src/core is the lowest layer. It must not import from the UI, runtime, infrastructure, state or services layers.';
const UPPER_LAYERS = ['infrastructure', 'features', 'runtime', 'components', 'design', 'state', 'services', 'app'];
// src/i18n holds pure language tables next to React hooks and components. The core may read the tables, not the rest.
const I18N_PURE = ['languages', 'scripts'];

const coreImportRestrictions = {
  paths: [
    ...['react', 'react-dom', 'react-native', 'firebase', 'expo', 'react-test-renderer'].map((name) => ({
      name,
      message: FRAMEWORK_MESSAGE,
    })),
    {
      name: '@/i18n',
      message: 'From src/i18n the core may import only the pure tables: ' + I18N_PURE.join(', ') + '.',
    },
  ],
  patterns: [
    {
      group: [
        'react/*',
        'react-dom/*',
        'react-native/*',
        'react-native-*',
        'react-native-*/*',
        '@react-native/*',
        '@react-native-*/*',
        'react-test-renderer/*',
      ],
      message: FRAMEWORK_MESSAGE,
    },
    { group: ['expo/*', 'expo-*', 'expo-*/*', '@expo/*', '@expo-google-fonts/*'], message: FRAMEWORK_MESSAGE },
    { group: ['firebase/*', '@firebase/*'], message: FRAMEWORK_MESSAGE },
    { group: UPPER_LAYERS.map((l) => `@/${l}`).concat(UPPER_LAYERS.map((l) => `@/${l}/*`)), message: LAYER_MESSAGE },
    { regex: `^(?:\\.\\./)+(?:${UPPER_LAYERS.join('|')})(?:/|$)`, message: LAYER_MESSAGE },
    {
      // A bare '@/i18n' would exclude its whole folder and stop the negations below, so the index is a path rule.
      group: ['@/i18n/*', ...I18N_PURE.map((n) => `!@/i18n/${n}`)],
      message: 'From src/i18n the core may import only the pure tables: ' + I18N_PURE.join(', ') + '.',
    },
    {
      regex: `^(?:\\.\\./)+i18n(?:/(?!(?:${I18N_PURE.join('|')})$).*)?$`,
      message: 'From src/i18n the core may import only the pure tables: ' + I18N_PURE.join(', ') + '.',
    },
  ],
};

// Core tests may exercise the real storage and provider modules (integration tests), so only the framework rule
// applies to them. They still must not import React, React Native, Expo or Firebase SDK packages directly.
const coreTestImportRestrictions = {
  paths: coreImportRestrictions.paths.filter((p) => p.message === FRAMEWORK_MESSAGE),
  patterns: coreImportRestrictions.patterns.filter((p) => p.message === FRAMEWORK_MESSAGE),
};

module.exports = defineConfig([
  globalIgnores([
    'node_modules/**',
    'dist/**',
    'dist-*/**',
    'web-build/**',
    '.expo/**',
    '.firebase/**',
    'android/**',
    'ios/**',
    'functions/lib/**',
    'functions/node_modules/**',
    'tests/e2e/.artifacts/**',
    'tests/evaluation/reports/**',
    'coverage/**',
    'expo-env.d.ts',
  ]),

  expoConfig,

  {
    plugins: { 'kalam-a11y': a11yPlugin },
    rules: {
      // ── Code is data, never executed from model output or user input ──
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',

      // ── React Hooks (the Expo base turns these on; stated here so the policy is visible) ──
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler checks (app.json sets reactCompiler). Warnings until the existing findings are cleared.
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/config': 'warn',
      'react-hooks/gating': 'warn',

      // ── Noise: TypeScript already checks these, and the import resolver is slow ──
      'import/no-unresolved': 'off',
      'import/named': 'off',
      'import/namespace': 'off',
      'import/export': 'off',
      'import/no-duplicates': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      // DOM-oriented. Apostrophes in React Native <Text> are fine.
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'warn',
    },
  },

  // ── TypeScript only (the @typescript-eslint plugin is not loaded for .js and .mjs files) ──
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { vars: 'all', args: 'none', ignoreRestSiblings: true, caughtErrors: 'none', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // The codebase and its contracts use Array<T> and ReadonlyArray<T> throughout. Not worth 50 warnings.
      '@typescript-eslint/array-type': 'off',
    },
  },

  // ── Accessibility, UI code only ──
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    rules: {
      'kalam-a11y/pressable-name-and-role': 'warn',
      'kalam-a11y/image-has-alt': 'warn',
      'kalam-a11y/textinput-has-name': 'warn',
    },
  },

  // ── Boundary: the core must stay pure ──
  {
    files: ['src/core/**/*.{ts,tsx}'],
    ignores: ['src/core/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', coreImportRestrictions] },
  },
  {
    files: ['src/core/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', coreTestImportRestrictions] },
  },

  // ── Detectors and attack fixtures have to contain the string "javascript:" to catch it ──
  {
    files: ['src/core/spec/validate.ts', '**/*.test.{ts,tsx}', 'tests/**'],
    rules: { 'no-script-url': 'off' },
  },

  // ── Node scripts, tests, config and Cloud Functions ──
  {
    files: ['scripts/**', 'tests/**', 'functions/**', '*.config.js', '*.config.ts', 'metro.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['*.config.js', 'metro.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.commonjs } },
  },
  {
    // Test files and fixtures may use any and require.
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
]);
