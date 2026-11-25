import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests cover the pure-TypeScript core (spec, formula, templates, classifier, AI routing,
// pipeline, storage). UI is verified with Playwright against the web build (tests/e2e).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/evaluation/**/*.test.ts'],
    exclude: ['node_modules', 'functions/**', 'tests/e2e/**'],
    setupFiles: ['fake-indexeddb/auto'],
    // Shared dev machine: cap parallelism so other projects keep CPU (user request 2026-11-18).
    maxWorkers: 2,
  },
});
