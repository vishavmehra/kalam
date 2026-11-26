#!/usr/bin/env node
/**
 * Deploys Kalam to Firebase, then smoke-checks it (docs/04 §22.1, checklist D04-062).
 *
 *   node scripts/deploy.mjs [--only hosting|functions|rules|all] [--project <id>] [--url https://<site>.web.app]
 *                           [--skip-build] [--skip-smoke] [--dry-run]
 *
 * The Firebase project is shared with another app, so this script only ever deploys Kalam's own resources, each
 * named explicitly: Hosting target "kalam", Functions codebase "kalam", and Firestore database "kalam" (rules and
 * indexes). It never runs a bare `firebase deploy`, and it refuses `--force`. `--dry-run` prints the steps and runs
 * none of them. Nothing here reads or prints a secret.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Firebase CLI targets, one per thing Kalam owns. */
export const TARGETS = { hosting: 'hosting:kalam', functions: 'functions:kalam', rules: 'firestore:kalam' };

/** Provider keys must never reach the client bundle (docs/11 §14). Same pattern as the CI scan. */
export const SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]{20,}|(ANTHROPIC|NEBIUS)_API_KEY["']?\s*[:=]\s*["'][^"']{12,}/;

/** Reads the command line. Throws on anything that must not be allowed. */
export function parseArgs(argv) {
  const opts = { only: 'hosting', project: undefined, url: undefined, skipBuild: false, skipSmoke: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force' || a.startsWith('--force=') || a === '-f') throw new Error('--force is not allowed. Deploy without it, or ask the owner.');
    if (a === '--only') opts.only = argv[++i];
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--skip-build') opts.skipBuild = true;
    else if (a === '--skip-smoke') opts.skipSmoke = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!['hosting', 'functions', 'rules', 'all'].includes(opts.only)) throw new Error('--only must be hosting, functions, rules or all');
  if (opts.project !== undefined && !/^[a-z][a-z0-9-]{4,29}$/.test(opts.project)) throw new Error('--project is not a valid Firebase project id');
  if (opts.url !== undefined && !/^https:\/\/[^\s/]+\/?$/.test(opts.url)) throw new Error('--url must be an https address with no path');
  return opts;
}

/** The ordered steps for these options. Pure, so it can be tested without deploying anything. */
export function planDeploy(opts) {
  const what = opts.only === 'all' ? ['rules', 'functions', 'hosting'] : [opts.only];
  const steps = [];
  if (what.includes('hosting') && !opts.skipBuild) steps.push({ label: 'Build the web app', cmd: 'npm', args: ['run', 'build:web'] });
  if (what.includes('hosting')) steps.push({ label: 'Check the bundle has no provider keys', check: 'bundle-secrets' });
  for (const key of what) {
    const args = ['deploy', '--only', TARGETS[key], '--non-interactive'];
    if (opts.project) args.push('--project', opts.project);
    steps.push({ label: `Deploy ${TARGETS[key]}`, cmd: 'firebase', args });
  }
  if (what.includes('hosting') && !opts.skipSmoke) steps.push({ label: 'Smoke check the live site', smoke: true });
  return steps;
}

/** Looks for a provider key in the built JavaScript. Returns the offending files. */
export function bundleSecretFiles(dir, { walk, read } = {}) {
  const files = walk ?? (() => []);
  const text = read ?? ((f) => readFileSync(f, 'utf8'));
  return files(dir).filter((f) => f.endsWith('.js') && SECRET_PATTERN.test(text(f)));
}

/** The default site's address from .firebaserc, when the "kalam" Hosting target names one. */
export function siteUrlFromFirebaserc(rc) {
  for (const project of Object.values(rc?.targets ?? {})) {
    const site = project?.hosting?.kalam?.[0];
    if (site) return `https://${site}.web.app`;
  }
  return undefined;
}

function walkDir(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkDir(p));
    else out.push(p);
  }
  return out;
}

function run(step, dryRun) {
  console.log(`\n> ${step.label}${step.cmd ? `: ${step.cmd} ${step.args.join(' ')}` : ''}`);
  if (dryRun) return 0;
  if (step.check === 'bundle-secrets') {
    const dist = join(ROOT, 'dist');
    if (!existsSync(join(dist, 'index.html'))) {
      console.error('dist/ has no index.html. Build first (drop --skip-build).');
      return 1;
    }
    const bad = bundleSecretFiles(dist, { walk: walkDir });
    if (bad.length) {
      console.error(`A provider API key appears in the web bundle (${bad.length} file). Remove it and rotate the key.`);
      return 1;
    }
    console.log('No provider keys found in dist.');
    return 0;
  }
  return spawnSync(step.cmd, step.args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const steps = planDeploy(opts);
  let deployedHosting = false;
  for (const step of steps) {
    if (step.smoke) {
      const rcPath = join(ROOT, '.firebaserc');
      const url = opts.url ?? process.env.KALAM_URL ?? (existsSync(rcPath) ? siteUrlFromFirebaserc(JSON.parse(readFileSync(rcPath, 'utf8'))) : undefined);
      if (!url && opts.dryRun) {
        console.log(`
> ${step.label}: needs --url https://<site>.web.app (or KALAM_URL, or a site in .firebaserc)`);
        continue;
      }
      if (!url) {
        console.error('\nDeployed, but the smoke check could not run: pass --url https://<site>.web.app (or set KALAM_URL), then run npm run smoke -- <url>.');
        process.exit(2);
      }
      const args = ['scripts/smoke-check.mjs', url, ...(opts.project ? ['--functions', opts.project] : [])];
      if (opts.dryRun) console.log(`\n> ${step.label}: node ${args.join(' ')}`);
      else if (spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' }).status !== 0) process.exit(1);
      continue;
    }
    if (run(step, opts.dryRun) !== 0) {
      console.error(`\nStopped at: ${step.label}${deployedHosting ? ' (Hosting was already deployed)' : ''}`);
      process.exit(1);
    }
    if (step.args?.includes(TARGETS.hosting)) deployedHosting = true;
  }
  console.log(opts.dryRun ? '\nDry run finished. Nothing was built or deployed.' : '\nDone.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
