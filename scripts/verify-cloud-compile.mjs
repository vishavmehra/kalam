#!/usr/bin/env node
/**
 * Real end-to-end cloud compile check (docs/07 CP5). Runs Kalam's REAL creation pipeline
 * (classifier → Firebase AI Logic cloud compiler → IR → convert → validate, at most one repair pass)
 * with the real Firebase provider, the backend from .env.local (Agent Platform on Blaze) and App Check
 * via the registered debug token, then prints route, provider, model, latency, validation and the
 * shape of the generated app. Node has no Gemini Nano, so this exercises the cloud leg only.
 *
 *   node scripts/verify-cloud-compile.mjs ["request text"] [--max-calls 2] [--out spec.json] [--dry-run]
 *
 * Every real model call costs money. --max-calls (default 2: one compile + one repair) is a hard cap
 * on HTTP generateContent requests (retries and fallbacks included), enforced on `fetch` itself:
 * requests past the cap get a synthetic 429 and never leave the machine. --dry-run swaps in a fake
 * provider answering with tests/fixtures/compiler/tailor-shop.ir.json, to test this script offline.
 * Config values and keys are never printed: console output (including the Firebase SDK's own
 * "App Check debug token" line) and error text are redacted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_REQUEST =
  'A tailor shop app with customers and their orders, measurements per order, delivery dates and advance payments';

// ─── Args + env ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const optionNames = new Set(['--max-calls', '--out']);
const request = argv.find((a, i) => !a.startsWith('--') && !optionNames.has(argv[i - 1])) ?? DEFAULT_REQUEST;
const maxCalls = Math.max(0, Number(option('--max-calls', '2')) || 0);
const dryRun = flag('--dry-run');
const outFile = option('--out', join(tmpdir(), 'kalam-verify-cloud-compile.spec.json'));

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
// Only public client config, exactly what the web bundle inlines. Must happen before modules load.
for (const [k, v] of Object.entries(env)) if (k.startsWith('EXPO_PUBLIC_')) process.env[k] = v;
const secrets = Object.values(env).filter((v) => v && v.length >= 12);
const scrub = (s) => secrets.reduce((acc, v) => acc.split(v).join('<redacted>'), String(s ?? ''));
const redact = (s) => scrub(s).slice(0, 400);
// The App Check SDK prints the debug token with console.log in debug mode; nothing printed here may carry it.
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(...args.map((a) => (typeof a === 'string' ? scrub(a) : a)));
}

// Hard spend cap on the wire: count every model request, refuse the ones past the cap.
const http = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!/:(stream)?generateContent\b/i.test(u)) return realFetch(url, init);
  if (http.length >= maxCalls) {
    http.push({ refused: true });
    return new Response(JSON.stringify({ error: { code: 429, message: 'verify script call cap reached' } }), { status: 429 });
  }
  const t0 = performance.now();
  const entry = { model: u.match(/models\/([^:/]+)/)?.[1] };
  http.push(entry);
  const res = await realFetch(url, init);
  Object.assign(entry, { status: res.status, ms: Math.round(performance.now() - t0) });
  return res;
};

// ─── Firebase app + App Check (debug token), shared with the provider via getApps() ───
async function initFirebase() {
  const missing = ['API_KEY', 'PROJECT_ID', 'APP_ID'].map((k) => `EXPO_PUBLIC_FIREBASE_${k}`).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing in .env.local: ${missing.join(', ')}`);
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
    // Debug mode replaces the provider; CustomProvider only avoids reCAPTCHA's DOM requirement in Node.
    const check = initializeAppCheck(app, { provider: new CustomProvider({ getToken: () => Promise.reject(new Error('unused')) }) });
    try {
      await getToken(check);
      appCheck = 'debug_token_exchanged';
    } catch (e) {
      appCheck = `debug_token_rejected: ${redact(e?.message ?? e).slice(0, 160)}`;
    }
  }
  return { app, appCheck };
}

async function main() {
  const firebase = dryRun ? { app: undefined, appCheck: 'skipped (dry run)' } : await initFirebase();

  // Vite's SSR loader runs the app's TypeScript (with the `@/` alias) exactly as written; no build step.
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
    resolve: { alias: { '@': join(ROOT, 'src') } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const load = (p) => vite.ssrLoadModule(p);
    const [{ createFirebaseProvider }, appModule, { createOrchestrator }, { createApplicationPipeline }, { validateSpec }, { DEFAULT_SETTINGS }] =
      await Promise.all([
        load('/src/infrastructure/firebase/firebase-provider.ts'),
        load('/src/infrastructure/firebase/app.ts'),
        load('/src/core/ai/orchestrator.ts'),
        load('/src/core/pipeline/create-application.ts'),
        load('/src/core/spec/validate.ts'),
        load('/src/core/contracts/index.ts'),
      ]);
    if (!dryRun && appModule.getFirebaseApp() !== firebase.app) {
      throw new Error('The provider did not pick up the App Check-enabled Firebase app (module instances differ).');
    }

    // ── Provider call log (the spend cap itself sits on fetch, above) ──
    const real = dryRun ? fakeProvider() : createFirebaseProvider();
    const calls = [];
    const drafts = [];
    const logged = {
      ...real,
      async generateStructured(req) {
        const t0 = performance.now();
        const r = await real.generateStructured(req);
        if (r.success) drafts.push({ task: req.taskType, ir: r.output }); // raw model output, for diagnosis
        calls.push({
          task: req.taskType, role: req.role, mode: req.mode, ok: r.success, source: r.source, model: r.model,
          ms: Math.round(performance.now() - t0), ...(r.success ? {} : { errorCode: r.errorCode, error: redact(r.errorMessage) }),
        });
        return r;
      },
    };
    const events = [];
    let settings = { ...DEFAULT_SETTINGS, onboarded: true };
    const ai = createOrchestrator({
      // A live check must reach the model every time: no client token bucket, no reused answers.
      rateLimit: false,
      cacheResults: false,
      firebase: logged,
      specialist: {
        name: 'claude', isConfigured: () => false,
        onDeviceStatus: async () => ({ platform: 'other', apiExposed: false, availability: 'unavailable' }),
        generateStructured: async () => ({ success: false, provider: 'none', source: 'cloud', latencyMs: 0, fallbackUsed: false, errorCode: 'not_configured' }),
      },
      events: { add: async (e) => { events.push(e); }, list: async () => events, clear: async () => { events.length = 0; } },
      settings: { get: async () => settings, update: async (p) => (settings = { ...settings, ...p }) },
      network: { online: () => true, subscribe: () => () => {} },
    });

    // Every validation attempt is kept, so a repair pass shows what the first draft got wrong.
    const attempts = [];
    const validate = (input) => {
      const v = validateSpec(input);
      attempts.push({ ok: v.ok, errors: v.errors.slice(0, 8).map((e) => `${e.path || '(root)'}: ${e.message}`), warnings: v.warnings.map((w) => w.code) });
      return v;
    };
    const stages = [];
    const started = performance.now();
    const create = createApplicationPipeline({ ai, validate, specialistConsent: () => false });
    const res = await create(
      { text: request, modalities: ['text'], images: [], language: 'en' },
      { onStage: (s, d) => stages.push(`${s}${d ? `(${d})` : ''} @${Math.round(performance.now() - started)}ms`) },
    );

    const spec = res.spec;
    if (spec) writeFileSync(outFile, `${JSON.stringify(spec, null, 2)}\n`);
    const draftFile = outFile.replace(/(\.spec)?\.json$/, '') + '.drafts.json';
    if (drafts.length) writeFileSync(draftFile, `${JSON.stringify(drafts, null, 2)}\n`);
    const summary = {
      dryRun, request, ok: res.ok, route: res.route, provider: res.provider, model: res.model, latencyMs: res.latencyMs,
      realModelRequests: http.filter((h) => !h.refused).length, http, appCheck: firebase.appCheck,
      backend: `${env.EXPO_PUBLIC_AI_BACKEND || 'google'}${env.EXPO_PUBLIC_AI_LOCATION ? `/${env.EXPO_PUBLIC_AI_LOCATION}` : ''}`,
      classification: {
        complexity: res.classification.complexity, method: res.classification.method, confidence: res.classification.confidence,
        matchingTemplate: res.classification.matchingTemplate, reasons: res.classification.reasons,
      },
      validation: {
        finalSpecValid: spec ? validateSpec(spec).ok : false,
        warnings: res.warnings.map((w) => `${w.code}: ${w.message}`),
        errors: res.errors.slice(0, 8).map((e) => `${e.path || '(root)'}: ${e.message}`),
        attempts,
      },
      app: spec && {
        name: spec.name, screens: spec.screens.length, collections: Object.keys(spec.collections).length,
        actions: Object.keys(spec.actions).length, aiBlocks: Object.keys(spec.aiBlocks).length,
        screenTitles: spec.screens.map((s) => `${s.id}: ${s.title} (${s.children.length} items)`),
        fields: Object.fromEntries(Object.entries(spec.collections).map(([id, c]) => [id, Object.entries(c.fields).map(([f, d]) => `${f}:${d.type}`)])),
        stats: spec.screens.flatMap((s) => s.children).filter((c) => c.type === 'stat').map((c) => `${c.label} = ${c.expr}`),
        generator: spec.meta.generator, savedTo: outFile,
      },
      assumptions: res.understanding?.assumptions, clarifications: res.clarifications, message: res.message,
      stages, calls, modelDrafts: drafts.length ? draftFile : undefined,
      events: events.map((e) => ({ task: e.taskType, route: e.route, provider: e.provider, model: e.model, source: e.source, ms: e.latencyMs, ok: e.success, errorCode: e.errorCode, note: e.escalationReason })),
    };
    console.log(JSON.stringify(summary, null, 2));
    return res.ok && summary.validation.finalSpecValid ? 0 : 1;
  } finally {
    await vite.close();
  }
}

/** --dry-run only: answers every compile with the checked-in tailor-shop IR fixture. */
function fakeProvider() {
  const ir = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/compiler/tailor-shop.ir.json'), 'utf8'));
  return {
    name: 'firebase', isConfigured: () => true,
    onDeviceStatus: async () => ({ platform: 'other', apiExposed: false, availability: 'unavailable' }),
    async generateStructured(req) {
      const parsed = req.parse(ir);
      return parsed.success
        ? { success: true, output: parsed.data, provider: 'firebase', source: 'cloud', model: 'dry-run-fixture', latencyMs: 1, fallbackUsed: false }
        : { success: false, provider: 'firebase', source: 'cloud', latencyMs: 1, fallbackUsed: false, errorCode: 'invalid_output', errorMessage: parsed.error };
    },
  };
}

// exitCode (not process.exit) avoids a libuv handle-closing assertion on Windows with pending fetch handles.
main().then((code) => { process.exitCode = code; }, (e) => { console.error(redact(e?.stack ?? e?.message ?? e)); process.exitCode = 2; });
