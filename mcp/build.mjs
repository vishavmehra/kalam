// Bundles the server and the src/core code it uses into one file: dist/server.js.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');
// Built by other packages (R1, R2, R3). A missing one becomes an empty module; its tools say so.
const OPTIONAL = /^@\/core\/(history|reports|formula-assist)$/;

const kalam = {
  name: 'kalam',
  setup(b) {
    b.onResolve({ filter: OPTIONAL }, (args) => {
      const file = path.join(src, args.path.slice(2), 'index.ts');
      return existsSync(file) ? { path: file } : { path: args.path, namespace: 'kalam-missing' };
    });
    b.onLoad({ filter: /.*/, namespace: 'kalam-missing' }, () => ({ contents: 'export {}', loader: 'js' }));
    // `@/x` is `../src/x`, in server files and in src/core files alike.
    b.onResolve({ filter: /^@\// }, (args) => b.resolve(`./${args.path.slice(2)}`, { kind: args.kind, resolveDir: src }));
    // One zod in the bundle: src/core uses the server's copy (same major version as the app).
    b.onResolve({ filter: /^zod(\/.*)?$/ }, (args) =>
      args.resolveDir.startsWith(here) ? undefined : b.resolve(args.path, { kind: args.kind, resolveDir: here }));
    // `./file.md?raw` is the file as a string.
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};

await build({
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(here, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Loaded only by kalam_compile_with_firebase, from the Kalam repo's node_modules.
  external: ['firebase', 'firebase/*', '@firebase/*'],
  // Bundled CommonJS packages call require(); ESM output needs a real one.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __kalamRequire } from 'node:module';\nconst require = __kalamRequire(import.meta.url);" },
  plugins: [kalam],
  legalComments: 'none',
  logLevel: 'info',
});
