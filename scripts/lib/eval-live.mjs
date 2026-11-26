/**
 * Shared by scripts/eval.mjs and scripts/eval-judge.mjs: config loading, the hard spend cap on the wire,
 * Firebase and App Check start-up, and secret scrubbing. Values and keys are never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Public client config from .env.local, or from the environment (CI). Only EXPO_PUBLIC_* values. */
export function loadEnv(root) {
  const env = {};
  const file = join(root, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('EXPO_PUBLIC_') && v && !env[k]) env[k] = v;
  return env;
}

/** Puts the public config into process.env (the app reads it there) and returns a function that hides every value. */
export function applyEnv(env) {
  for (const [k, v] of Object.entries(env)) if (k.startsWith('EXPO_PUBLIC_')) process.env[k] = v;
  const secrets = Object.values(env).filter((v) => v && v.length >= 12);
  return (s) => secrets.reduce((acc, v) => acc.split(v).join('<redacted>'), String(s ?? ''));
}

/** Counts every model request and refuses the ones past the cap (hard spend limit, on the wire). */
export function installSpendCap(budget, scrub) {
  const http = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!/:(stream)?generateContent\b/i.test(String(url))) return realFetch(url, init);
    if (http.filter((h) => !h.refused).length >= budget) {
      http.push({ refused: true });
      return new Response(JSON.stringify({ error: { code: 429, message: 'eval budget reached' } }), { status: 429 });
    }
    const entry = { model: String(url).match(/models\/([^:/]+)/)?.[1] };
    http.push(entry);
    const res = await realFetch(url, init);
    entry.status = res.status;
    return res;
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...a) => original(...a.map((x) => (typeof x === 'string' ? scrub(x) : x)));
  }
  return {
    used: () => http.filter((h) => !h.refused).length,
    refused: () => http.filter((h) => h.refused).length,
    statuses: () => http.filter((h) => !h.refused).map((h) => h.status ?? 0),
  };
}

export async function initFirebase(env) {
  const missing = ['API_KEY', 'PROJECT_ID', 'APP_ID'].map((k) => `EXPO_PUBLIC_FIREBASE_${k}`).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Live mode needs ${missing.join(', ')} in .env.local or the environment.`);
  const { initializeApp } = await import('firebase/app');
  const { CustomProvider, getToken, initializeAppCheck } = await import('firebase/app-check');
  const app = initializeApp({
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
  });
  let appCheck = 'not_configured';
  if (env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN;
    const check = initializeAppCheck(app, {
      provider: new CustomProvider({ getToken: () => Promise.reject(new Error('unused')) }),
    });
    try {
      await getToken(check);
      appCheck = 'debug_token_exchanged';
    } catch {
      appCheck = 'debug_token_rejected';
    }
  }
  return { app, appCheck };
}

/** Adds up a list of {inputTokens, outputTokens, model}. */
export function sumUsage(items) {
  const total = { httpCalls: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
  for (const i of items) {
    const m = (total.byModel[i.model ?? 'unknown'] ??= { httpCalls: 0, inputTokens: 0, outputTokens: 0 });
    for (const t of [total, m]) {
      t.httpCalls += i.httpCalls ?? 1;
      t.inputTokens += i.inputTokens ?? 0;
      t.outputTokens += i.outputTokens ?? 0;
    }
  }
  return total;
}
