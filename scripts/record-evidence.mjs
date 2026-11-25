#!/usr/bin/env node
/**
 * Records dated, redacted evidence for docs/FIREBASE_HYBRID_AI_VERIFICATION.md (docs/17 section 13.4).
 *
 *   node scripts/record-evidence.mjs cloud        one real, billed Firebase AI Logic cloud call
 *   node scripts/record-evidence.mjs on-device    Gemini Nano in the Kalam Chrome over CDP (default port 9333)
 *   node scripts/record-evidence.mjs all          both
 *
 * It runs scripts/verify-firebase-ai.mjs as a child process, scrubs anything secret-shaped from the
 * output (API key, App Check debug token, UUIDs, long tokens), and writes docs/evidence/<kind>-<date>.json.
 * Nothing private is recorded: the verify script only sends the fixed sample "Buy milk tomorrow."
 * Re-running on the same day overwrites that day's file. Do not run `cloud` in a loop: each run is billed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'evidence');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Secrets from .env.local are removed by value; the patterns catch anything else token-shaped.
const secrets = [];
try {
  for (const m of read('.env.local').matchAll(/^\s*EXPO_PUBLIC_(?:FIREBASE_API_KEY|APPCHECK_DEBUG_TOKEN|RECAPTCHA_SITE_KEY|FIREBASE_APP_ID)\s*=\s*["']?([^"'\r\n]+)/gm)) secrets.push(m[1]);
} catch { /* no .env.local: patterns below still apply */ }
function redact(text) {
  let t = String(text);
  for (const s of secrets) t = t.split(s).join('<redacted>');
  return t
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/AIza[0-9A-Za-z_-]{30,}/g, '<api-key>')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<token>')
    .replace(/(authorization|x-firebase-appcheck)["':\s=]+\S+/gi, '$1: <redacted>');
}

const cdpIndex = process.argv.indexOf('--cdp-port');
const cdpPort = cdpIndex > 0 ? process.argv[cdpIndex + 1] : '9333';
const date = new Date().toLocaleDateString('sv-SE'); // local date, YYYY-MM-DD
const versionOf = (pkg) => { try { return JSON.parse(read(`node_modules/${pkg}/package.json`)).version; } catch { return 'unknown'; } };

async function chromeVersion() {
  try {
    const j = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
    return j.Browser;
  } catch { return 'not reachable'; }
}

async function record(kind, args) {
  const run = spawnSync(process.execPath, [join(root, 'scripts', 'verify-firebase-ai.mjs'), ...args], { encoding: 'utf8', timeout: 180_000 });
  const stdout = redact(run.stdout ?? '').trim();
  const stderr = redact(run.stderr ?? '').trim();
  let result = null;
  // The child prints one pretty JSON object; SDK debug lines may precede it, so parse from the first "{".
  for (const text of [stdout, stderr]) {
    const start = text.indexOf('{');
    if (start < 0) continue;
    try { result = JSON.parse(text.slice(start)); break; } catch { /* keep looking */ }
  }
  const evidence = {
    kind,
    recordedAt: new Date().toISOString(),
    command: `node scripts/verify-firebase-ai.mjs ${args.join(' ')}`.trim(),
    exitCode: run.status,
    environment: {
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      sdk: { firebase: versionOf('firebase'), '@firebase/ai': versionOf('@firebase/ai') },
      ...(kind === 'on-device-inference' ? { chrome: await chromeVersion(), cdpPort } : {}),
    },
    result,
    ...(result ? {} : { rawStdout: stdout.slice(0, 2000), rawStderr: stderr.slice(0, 2000) }),
  };
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${kind}-${date}.json`);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`${kind}: exit ${run.status}, ok=${result?.ok ?? (result?.classify?.text ? true : 'n/a')} -> ${file}`);
  return run.status ?? 1;
}

const which = process.argv[2];
if (!['cloud', 'on-device', 'all'].includes(which)) {
  console.error('usage: node scripts/record-evidence.mjs cloud|on-device|all [--cdp-port 9333]');
  process.exit(2);
}
const codes = [];
if (which !== 'on-device') codes.push(await record('cloud-inference', []));
if (which !== 'cloud') codes.push(await record('on-device-inference', ['--on-device', '--cdp-port', cdpPort]));
process.exitCode = codes.some(Boolean) ? 1 : 0;
