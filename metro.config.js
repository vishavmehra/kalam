// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared dev machine: keep Metro from claiming every core so other projects stay responsive.
config.maxWorkers = 2;

// The MCP server (mcp/) is a separate Node package with its own node_modules, and ios/ is a
// generated native project. Metro must not crawl or bundle either of them.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const underRoot = (dir) => new RegExp('^' + escapeRe(path.join(__dirname, dir)) + '[\\\\/].*');
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  underRoot('mcp'),
  underRoot('ios'),
];

// Production web only: Metro does not tree-shake, so `import { X } from 'lucide-react-native'` pulls in all ~1900
// icons (about 700 KB minified). Resolve the package to a generated barrel that re-exports just the icons src/ uses.
if (process.env.NODE_ENV === 'production') {
  const fs = require('fs');
  const root = path.join(__dirname, 'node_modules', 'lucide-react-native', 'dist', 'esm');
  const used = new Set(['createLucideIcon', 'Icon', 'LucideProvider', 'useLucideContext']);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name)) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'lucide-react-native'/g))
          for (const n of m[1].split(',')) used.add(n.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim());
      }
    }
  };
  walk(path.join(__dirname, 'src'));
  const out = fs.readFileSync(path.join(root, 'lucide-react-native.mjs'), 'utf8')
    .split(/\r?\n/).filter((l) => l.startsWith('export {'))
    .map((l) => {
      const m = l.match(/^export \{(.*)\} from '(.*)';$/);
      if (!m) return '';
      const specs = m[1].split(',').map((x) => x.trim()).filter((x) => /^default as /.test(x) ? used.has(x.slice(11)) : used.has(x));
      return specs.length ? `export { ${specs.join(', ')} } from ${JSON.stringify(path.join(root, m[2]).replace(/\\/g, '/'))};` : '';
    }).filter(Boolean).join(String.fromCharCode(10));
  const shim = path.join(__dirname, '.expo', 'lucide-web.mjs');
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(shim, out + String.fromCharCode(10));
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (ctx, name, platform) =>
    platform === 'web' && name === 'lucide-react-native'
      ? { type: 'sourceFile', filePath: shim }
      : (upstream ?? ctx.resolveRequest)(ctx, name, platform);
}

module.exports = config;
