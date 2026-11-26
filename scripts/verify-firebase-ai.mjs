#!/usr/bin/env node
/**
 * Real Firebase AI Logic cloud check (docs/07 CP1). One tiny structured request, ONLY_IN_CLOUD,
 * Gemini Developer API backend, config from .env.local. Prints outcome + latency, never config values.
 *
 *   node scripts/verify-firebase-ai.mjs [--model gemini-3.8-flash]
 *   node scripts/verify-firebase-ai.mjs --on-device [--cdp-port 9333]   (Gemini Nano in Chrome)
 *   node scripts/verify-firebase-ai.mjs --web-matrix [--cdp-port 9333]  (the six Chrome scenarios of docs/17 section 12.1)
 *
 * Node has no Chrome Prompt API and no reCAPTCHA, so this verifies the cloud leg only. If
 * EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN is set (and registered in Firebase console → App Check → Manage
 * debug tokens) it is exchanged for a real App Check token, exactly as the web dev build does.
 * The on-device leg is verified in Chrome (Prompt API), see the A3 report.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { AgentPlatformBackend, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, ThinkingLevel } from 'firebase/ai';
import { CustomProvider, getToken, initializeAppCheck } from 'firebase/app-check';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const redact = (s) => String(s).split(env.EXPO_PUBLIC_FIREBASE_API_KEY || '\u0000').join('<api-key>').slice(0, 800);
// The App Check SDK console.logs the debug token in debug mode: keep it (and the API key) out of the output.
const hidden = [env.EXPO_PUBLIC_FIREBASE_API_KEY, env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN].filter(Boolean);
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(...args.map((a) => (typeof a === 'string' ? hidden.reduce((t, v) => t.split(v).join('<redacted>'), a) : a)));
}

async function main() {
  const missing = ['API_KEY', 'PROJECT_ID', 'APP_ID'].map((k) => `EXPO_PUBLIC_FIREBASE_${k}`).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing in .env.local: ${missing.join(', ')}`);

  const modelArg = process.argv.indexOf('--model');
  const model = modelArg > 0 ? process.argv[modelArg + 1] : 'gemini-3.8-flash';
  const app = initializeApp({
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
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
      appCheck = `debug_token_rejected: ${redact(e?.message ?? e).slice(0, 200)}`;
    }
  }

  const schema = {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['shopping', 'work', 'health', 'other'] },
      confidence: { type: 'string', enum: ['high', 'low'] },
    },
    required: ['category', 'confidence'],
  };
  const gm = getGenerativeModel(getAI(app, { backend: env.EXPO_PUBLIC_AI_BACKEND === 'agent_platform' ? new AgentPlatformBackend(env.EXPO_PUBLIC_AI_LOCATION || undefined) : new GoogleAIBackend() }), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model,
      systemInstruction: 'Classify the note. Reply with JSON only.',
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    },
  });

  const t0 = performance.now();
  try {
    const { response } = await gm.generateContent('Buy milk tomorrow.');
    const out = JSON.parse(response.text());
    const ok = schema.properties.category.enum.includes(out.category) && schema.properties.confidence.enum.includes(out.confidence);
    const u = response.usageMetadata;
    console.log(JSON.stringify({
      ok, model, appCheck, inferenceSource: response.inferenceSource, latencyMs: Math.round(performance.now() - t0), output: out,
      usage: u && { prompt: u.promptTokenCount, output: u.candidatesTokenCount, total: u.totalTokenCount },
    }, null, 2));
    return ok ? 0 : 1;
  } catch (e) {
    console.error(JSON.stringify({
      ok: false, model, appCheck, latencyMs: Math.round(performance.now() - t0),
      code: e?.code, status: e?.customErrorData?.status, message: redact(e?.message ?? e),
    }, null, 2));
    return 1;
  }
}

/**
 * --on-device: drives the dedicated Kalam Chrome over CDP (default http://127.0.0.1:9333) in a NEW tab
 * on a localhost page served here (secure context), and runs exactly what Firebase's ChromeAdapter sends
 * for a hybrid request: LanguageModel.create({ expectedInputs/Outputs, initialPrompts: [system] }) then
 * session.prompt([user message], { responseConstraint }). Also checks the sanitised-schema keywords
 * (type arrays, anyOf, enum, additionalProperties, min/maxItems) are accepted. Closes only its own tab.
 */
async function onDevice() {
  const { createServer } = await import('node:http');
  const portArg = process.argv.indexOf('--cdp-port');
  const cdp = `http://127.0.0.1:${portArg > 0 ? process.argv[portArg + 1] : 9333}`;
  const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Kalam Nano check</title>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://localhost:${server.address().port}/`;
  let tab;
  try {
    tab = await (await fetch(`${cdp}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP websocket failed')); });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
    const evaluate = (expression) => new Promise((r) => {
      const id = ++seq;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    for (let i = 0; i < 50 && (await evaluate('document.readyState')).result?.result?.value !== 'complete'; i++) await new Promise((r) => setTimeout(r, 100));
    const res = await evaluate(`(async () => {
      if (!('LanguageModel' in self)) return { apiExposed: false };
      const io = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
      const availability = await LanguageModel.availability(io);
      if (availability !== 'available') return { apiExposed: true, availability };
      const run = async (system, user, schema) => {
        const t0 = performance.now();
        const s = await LanguageModel.create({ ...io, initialPrompts: [{ role: 'system', content: [{ type: 'text', value: system }] }] });
        const createMs = Math.round(performance.now() - t0);
        const t1 = performance.now();
        try {
          const text = await s.prompt([{ role: 'user', content: [{ type: 'text', value: user }] }], { responseConstraint: schema });
          return { createMs, promptMs: Math.round(performance.now() - t1), text };
        } catch (e) { return { createMs, error: e.name + ': ' + e.message }; } finally { s.destroy(); }
      };
      const classify = await run('Classify the note. Reply with JSON only.', 'Buy milk tomorrow.', {
        type: 'object', required: ['category', 'confidence'],
        properties: { category: { type: 'string', enum: ['shopping', 'work', 'health', 'other'] }, confidence: { type: 'string', enum: ['high', 'low'] } },
      });
      const voice = await run('Map the spoken command to an action. Reply with JSON only.', "Add Raju's order, kurta, chest 40.", {
        type: 'object', additionalProperties: false, required: ['action', 'fields', 'note'],
        properties: {
          action: { anyOf: [{ type: 'string', enum: ['createOrder', 'deleteOrder'] }, { type: 'null' }] },
          fields: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', required: ['name', 'value'], properties: { name: { type: 'string' }, value: { type: ['string', 'number'] } } } },
          note: { type: ['string', 'null'] },
        },
      });
      return { apiExposed: true, availability, classify, voice };
    })()`);
    ws.close();
    const value = res.result?.result?.value ?? res.result?.exceptionDetails ?? res;
    console.log(JSON.stringify(value, null, 2));
    return value?.classify?.text ? 0 : 1;
  } finally {
    if (tab?.id) await fetch(`${cdp}/json/close/${tab.id}`).catch(() => {});
    server.closeAllConnections(); // Chrome keeps the page's socket alive otherwise
    server.close();
  }
}


/**
 * --web-matrix: the six Chrome scenarios of docs/17 section 12.1, run with Kalam's own orchestrator and Firebase provider
 * (tests/evaluation/browser/web-matrix.entry.ts, bundled here with Vite) in real browsers:
 *   A, C, D, E, F in the dedicated Kalam Chrome over CDP (Gemini Nano present), each in its own new tab;
 *   B in Playwright's Chromium, a real browser with no Prompt API.
 * Cloud steps are real and billed (about six small requests). The bundle holds the public Firebase config and the App Check
 * debug token, so it is built into a temporary folder that is deleted afterwards. Closes only its own tabs.
 */
async function webMatrix() {
  const { mkdtempSync, rmSync, readFileSync: read, writeFileSync } = await import('node:fs');
  const { createServer } = await import('node:http');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const portArg = process.argv.indexOf('--cdp-port');
  const cdp = `http://127.0.0.1:${portArg > 0 ? process.argv[portArg + 1] : 9333}`;
  const outDir = mkdtempSync(join(tmpdir(), 'kalam-web-matrix-'));
  let server;
  const tabs = [];
  try {
    const define = { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' };
    for (const [k, v] of Object.entries(env)) if (k.startsWith('EXPO_PUBLIC_')) define[`process.env.${k}`] = JSON.stringify(v);
    const { build } = await import('vite');
    await build({
      root, configFile: false, logLevel: 'error', define,
      resolve: { alias: { '@': join(root, 'src') }, extensions: ['.web.ts', '.web.tsx', '.ts', '.tsx', '.mjs', '.js', '.json'] },
      build: {
        outDir, emptyOutDir: true, minify: false, target: 'es2022',
        lib: { entry: join(root, 'tests', 'evaluation', 'browser', 'web-matrix.entry.ts'), formats: ['iife'], name: 'KalamMatrix', fileName: () => 'matrix.js' },
      },
    });
    writeFileSync(join(outDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Kalam web matrix</title><script src="matrix.js"></script>');
    const bundle = read(join(outDir, 'matrix.js'));
    server = createServer((req, res) => {
      if (req.url?.startsWith('/matrix.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><meta charset="utf-8"><title>Kalam web matrix</title><script src="matrix.js"></script>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const pageUrl = `http://localhost:${server.address().port}/`;

    /** One new tab in the Kalam Chrome. */
    const openTab = async () => {
      const tab = await (await fetch(`${cdp}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
      const ws = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP websocket failed')); });
      let seq = 0;
      const pending = new Map();
      ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
      const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
      const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
      for (let i = 0; i < 100 && !(await evaluate('Boolean(window.__matrix && window.__matrix.ready)')); i++) await new Promise((r) => setTimeout(r, 100));
      const handle = { send, evaluate, run: (id) => evaluate(`window.__matrix.run(${JSON.stringify(id)})`), close: async () => { ws.close(); await fetch(`${cdp}/json/close/${tab.id}`).catch(() => {}); } };
      tabs.push(handle);
      return handle;
    };

    const version = await (await fetch(`${cdp}/json/version`)).json();
    const results = [];
    // `--only A,F,G` runs part of the matrix while it is being debugged.
    const onlyArg = process.argv.indexOf('--only');
    const want = (id) => onlyArg < 0 || process.argv[onlyArg + 1].split(',').includes(id);
    // A and F share a tab: the first Nano session of a page takes about 40 s, later ones about 0.1 s.
    // F takes the tab offline and G puts it back, so the reconnect is part of the same recorded run.
    if (want('A') || want('F') || want('G')) {
      const tabA = await openTab();
      if (want('A')) results.push(await tabA.run('A'));
      if (want('F') || want('G')) {
        await tabA.send('Network.enable');
        if (want('F')) {
          await tabA.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
          results.push(await tabA.run('F'));
          await tabA.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
          await new Promise((r) => setTimeout(r, 1500)); // let the page see the network return
        }
        if (want('G')) results.push(await tabA.run('G'));
      }
      await tabA.close();
    }
    for (const id of ['C', 'D', 'E', 'H']) {
      if (!want(id)) continue;
      const tab = await openTab();
      results.push(await tab.run(id));
      await tab.close();
    }
    // B and C2 run in Playwright's Chromium, which is a real browser: B with the Prompt API switched off (no local model at all),
    // C2 as it ships (Prompt API exposed, Gemini Nano not installed: availability "downloadable").
    let chromiumVersion = 'unavailable';
    if (want('B') || want('C2')) {
      let playwright;
      try { playwright = await import('playwright'); } catch (e) { playwright = undefined; chromiumVersion = `not available: ${redact(e?.message ?? e)}`; }
      const variants = [
        ['B', ['--disable-features=PromptAPIForGeminiNano,AIPromptAPI,AIPromptAPIMultimodalInput,OptimizationGuideOnDeviceModel']],
        ['C2', []],
      ];
      for (const [id, args] of variants) {
        if (!want(id)) continue;
        try {
          if (!playwright) throw new Error(chromiumVersion);
          const browser = await playwright.chromium.launch({ args });
          chromiumVersion = `Chromium ${browser.version()} (Playwright)`;
          const page = await browser.newPage();
          await page.goto(pageUrl);
          await page.waitForFunction(() => window.__matrix?.ready === true);
          results.push(await page.evaluate((scenario) => window.__matrix.run(scenario), id));
          await browser.close();
        } catch (e) {
          results.push({ id, title: id === 'B' ? 'Chrome without a local model' : 'Local model not ready (real)', how: 'Playwright Chromium', pass: false, observed: {}, events: [], failures: [`could not run: ${redact(e?.message ?? e)}`] });
        }
      }
    }
    results.sort((a, b) => a.id.localeCompare(b.id));
    const out = {
      ok: results.length === (onlyArg < 0 ? 9 : process.argv[onlyArg + 1].split(',').length) && results.every((r) => r.pass),
      kalamChrome: version.Browser,
      withoutLocalModel: chromiumVersion,
      scenarios: results,
    };
    console.log(JSON.stringify(out, null, 2));
    return out.ok ? 0 : 1;
  } finally {
    for (const t of tabs) await t.close().catch(() => {});
    server?.closeAllConnections();
    server?.close();
    rmSync(outDir, { recursive: true, force: true });
  }
}

// exitCode (not process.exit) avoids a libuv handle-closing assertion on Windows with pending fetch handles.
(process.argv.includes('--web-matrix') ? webMatrix() : process.argv.includes('--on-device') ? onDevice() : main()).then((code) => { process.exitCode = code; }, (e) => { console.error(redact(e?.message ?? e)); process.exitCode = 2; });
