import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the evaluation runner and the golden files. Pure Node, no model, no network.
// Run: npx vitest run --config tests/evaluation/vitest.config.ts
// (Add 'tests/evaluation/**/*.test.ts' to the root vitest.config.ts include to run them with `npm test`.)
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/evaluation/**/*.test.ts'],
    // Shared dev machine: cap parallelism so other projects keep CPU.
    maxWorkers: 2,
    // The lint policy test loads the real ESLint config (TypeScript and React plugins), which takes a few seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
