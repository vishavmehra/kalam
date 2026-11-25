import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');

/** Same rules as build.mjs: missing R1/R2/R3 modules become empty, `?raw` imports are text. */
const kalam: Plugin = {
  name: 'kalam',
  enforce: 'pre',
  resolveId(id) {
    const m = /(?:^@|[\\/]src)[\\/]core[\\/](history|reports|formula-assist)$/.exec(id);
    if (m && !existsSync(path.join(src, 'core', m[1], 'index.ts'))) return '\0kalam-missing';
    return null;
  },
  load(id) {
    return id === '\0kalam-missing' ? 'export {}' : null;
  },
};

export default defineConfig({
  plugins: [kalam],
  resolve: {
    alias: { '@': src },
    // One zod for the server and src/core, as in the bundle.
    dedupe: ['zod'],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    maxWorkers: 1,
  },
});
