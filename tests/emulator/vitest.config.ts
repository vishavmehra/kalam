import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Auth and Cloud Functions tests need the emulators, so they stay out of the default `vitest run`.
// Run (needs Java 21 for the Firestore emulator): npm run test:emulators
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
