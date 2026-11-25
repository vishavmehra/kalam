import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Firestore rules and Bazaar integration tests need the emulator, so they are kept out of the default `vitest run`.
// Run: firebase emulators:exec --only firestore --project demo-kalam "npx vitest run --config tests/rules/vitest.config.ts --maxWorkers=2"
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
