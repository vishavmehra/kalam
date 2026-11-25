#!/usr/bin/env node
/**
 * Real Firebase AI Logic cloud check (docs/07 CP1). One tiny structured request, ONLY_IN_CLOUD,
 * Gemini Developer API backend, config from .env.local. Prints outcome + latency, never config values.
 *
 *   node scripts/verify-firebase-ai.mjs [--model gemini-3.8-flash]
 *   node scripts/verify-firebase-ai.mjs --on-device [--cdp-port 9333]   (Gemini Nano in Chrome)
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

// exitCode (not process.exit) avoids a libuv handle-closing assertion on Windows with pending fetch handles.
(process.argv.includes('--on-device') ? onDevice() : main()).then((code) => { process.exitCode = code; }, (e) => { console.error(redact(e?.message ?? e)); process.exitCode = 2; });
