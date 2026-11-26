#!/usr/bin/env node
/**
 * Builds the production web app for the Playwright suite (`npm run e2e`) with no Firebase config. Signing in is
 * required in a real build (src/features/auth/gate-logic.ts), but a build with no Firebase cannot sign anyone in,
 * so it is not gated and the journeys can reach Create and the Shelf. Expo never overrides a variable that is
 * already set, even to an empty string, so a developer's .env.local does not leak in.
 * Usage: npm run build:web:e2e
 * Set E2E_FIREBASE=placeholder to build with a placeholder Firebase and reCAPTCHA config instead (the sign-in gate is
 * then on, and Firebase and App Check load): tests/e2e/12-csp-production.spec.ts uses it to check that the Content
 * Security Policy blocks nothing the app needs. The values are fake and reach no real project.
 * Set E2E_DIST to build into another folder (for example dist-e2e) so a parallel build does not touch dist/; the
 * same variable tells tests/e2e/serve.mjs which folder to serve.
 */
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.E2E_DIST ? (isAbsolute(process.env.E2E_DIST) ? process.env.E2E_DIST : resolve(ROOT, process.env.E2E_DIST)) : resolve(ROOT, 'dist');
// The shell splits an absolute path that holds a space (this repo lives in "AI ML"), so pass it relative to ROOT.
const OUT = relative(ROOT, DIST) || 'dist';
const env = { ...process.env };
const PLACEHOLDER = {
  API_KEY: 'placeholder-api-key', AUTH_DOMAIN: 'placeholder-kalam.firebaseapp.com', PROJECT_ID: 'placeholder-kalam',
  STORAGE_BUCKET: 'placeholder-kalam.appspot.com', MESSAGING_SENDER_ID: '123456789012', APP_ID: '1:123456789012:web:0000000000000000',
};
const placeholder = process.env.E2E_FIREBASE === 'placeholder';
for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) env[`EXPO_PUBLIC_FIREBASE_${key}`] = placeholder ? PLACEHOLDER[key] : '';
// reCAPTCHA Enterprise is how the web app proves itself to Firebase (App Check). The key is the right shape and fake.
env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = placeholder ? '6LcPLACEHOLDER0000000000000000000000000' : '';
env.EXPO_PUBLIC_APPCHECK_PROVIDER = placeholder ? 'enterprise' : '';
env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN = '';

const run = (command, args) => {
  const r = spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', OUT]);
run('node', ['scripts/build-pwa.mjs', OUT]);
