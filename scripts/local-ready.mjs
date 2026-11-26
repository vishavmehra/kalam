#!/usr/bin/env node
/**
 * Per-task local-ready benchmark (docs/07 §6.7, §20.5). Runs one task's cases through the REAL on-device model and
 * prints the record that src/core/ai/local-ready.ts needs, plus the gate's verdict.
 *
 *   node scripts/local-ready.mjs --task classify --cdp-port 9333 [--offline]   Gemini Nano in the Kalam Chrome
 *   node scripts/local-ready.mjs --task voice_action --offline                  the same for another task
 *   node scripts/local-ready.mjs --task classify --self-test                    harness check, stub model, writes nothing
 *
 * Case sets: `classify` (the tie-break, cases from tests/fixtures/requests and the golden sets) is built here; the others
 * (voice_action, summarize, translate) are in tests/evaluation/local-tasks, where each case is the real request the app sends.
 * Tasks with no case set (extract_data, generate_patch, extract_template_params, create_simple_app) are not run and stay unproven.
 * The raw run (case ids, outcome, ms: never request text) goes to docs/evidence. A task becomes `ready` only after the printed
 * record is added to LOCAL_EVIDENCE and clears its gate.
 *
 * `--provider cloud` asks the same cases of the Firebase cloud model instead (the real provider, App Check, a spend cap of --max-calls, default
 * 120), for the provider comparison of docs/07 section 20.2. It writes docs/evidence/provider-<task>-cloud-<date>.json and never makes a
 * LOCAL_EVIDENCE record, because a cloud run says nothing about the device.
 *
 * `--offline` puts the tab's network off (DevTools network emulation) and checks the page really reports offline before any
 * case runs, so the record may say the task worked offline. `--offline-verified` is the manual claim for a run made another way.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { applyEnv, initFirebase, installSpendCap, loadEnv } from './lib/eval-live.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const task = opt('task', 'classify');
const selfTest = flag('self-test');
const cdp = `http://127.0.0.1:${opt('cdp-port', '9333')}`;
const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8')).cases;

/** Drives the Kalam Chrome over CDP, as scripts/verify-firebase-ai.mjs --on-device does: one session per case. */
async function openDevice() {
  const server = createHttp((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Kalam local-ready</title>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const tab = await (await fetch(`${cdp}/json/new?${encodeURIComponent(`http://localhost:${server.address().port}/`)}`, { method: 'PUT' })).json();
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
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  let offline = false;
  if (flag('offline')) {
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    offline = (await evaluate('navigator.onLine === false')).result?.result?.value === true;
    if (!offline) throw new Error('The page still reports it is online, so this run cannot be recorded as offline.');
  }
  const state = (await evaluate(`(async () => {
    if (!('LanguageModel' in self)) return { apiExposed: false };
    const io = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
    return { apiExposed: true, availability: await LanguageModel.availability(io), version: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] };
  })()`)).result?.result?.value;
  if (state?.availability !== 'available') throw new Error(`Gemini Nano is not available in this Chrome (${JSON.stringify(state)})`);
  const answer = async (req) => {
    const t0 = performance.now();
    // The Prompt API speaks English, Spanish and Japanese; a request names its languages and English is always allowed (prompt-io.ts).
    const langs = [...new Set(['en', ...(req.languages ?? []).filter((l) => ['en', 'es', 'ja'].includes(l))])];
    const res = (await evaluate(`(async () => {
      const lang = ${JSON.stringify(langs)};
      const io = { expectedInputs: [{ type: 'text', languages: lang }], expectedOutputs: [{ type: 'text', languages: lang }] };
      const s = await LanguageModel.create({ ...io, initialPrompts: [{ role: 'system', content: [{ type: 'text', value: ${JSON.stringify(req.system ?? '')} }] }] });
      try { return { text: await s.prompt([{ role: 'user', content: [{ type: 'text', value: ${JSON.stringify(req.prompt)} }] }], { responseConstraint: ${JSON.stringify(req.jsonSchema)} }) }; }
      catch (e) { return { error: e.name + ': ' + e.message }; } finally { s.destroy(); }
    })()`)).result?.result?.value ?? { error: 'no result' };
    return { ...res, ms: Math.round(performance.now() - t0) };
  };
  const close = async () => { ws.close(); await fetch(`${cdp}/json/close/${tab.id}`).catch(() => {}); server.closeAllConnections(); server.close(); };
  return { answer, close, offline, model: `gemini-nano, ${state.version ?? 'Chrome'}` };
}

/**
 * The same `answer(req)` the device uses, answered by the real Firebase provider in the cloud. The provider parses the answer itself, so the
 * raw JSON is captured from the parser the case carries and handed back as text for the harness to judge like any other.
 */
async function openCloud(vite) {
  const env = loadEnv(ROOT);
  const scrub = applyEnv(env);
  const cap = installSpendCap(Number(opt('max-calls', '120')), scrub);
  const firebase = await initFirebase(env);
  const [{ createFirebaseProvider }, appModule] = await Promise.all([
    vite.ssrLoadModule('/src/infrastructure/firebase/firebase-provider.ts'), vite.ssrLoadModule('/src/infrastructure/firebase/app.ts'),
  ]);
  if (appModule.getFirebaseApp() !== firebase.app) throw new Error('The provider did not pick up the App Check-enabled Firebase app.');
  const provider = createFirebaseProvider();
  const models = new Set();
  const answer = async (req) => {
    let raw;
    const t0 = performance.now();
    const res = await provider.generateStructured({ ...req, mode: 'only_in_cloud', timeoutMs: 60_000, parse: (r) => { raw = r; return req.parse(r); } });
    if (res.model) models.add(res.model);
    const ms = Math.round(performance.now() - t0);
    return res.success || raw !== undefined ? { text: JSON.stringify(raw ?? null), ms } : { error: scrub(`${res.errorCode}: ${res.errorMessage ?? ''}`).slice(0, 120), ms };
  };
  return { answer, close: async () => {}, model: 'Gemini in the cloud (Firebase AI Logic)', models: () => `${[...models].sort().join(', ') || 'gemini'} (Firebase AI Logic, cloud)`, offline: false, requests: () => cap.used() };
}

async function main() {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', resolve: { alias: { '@': join(ROOT, 'src') } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  let device;
  try {
    const [{ tieBreakRequest }, { runLocalBenchmark }, local] = await Promise.all([
      vite.ssrLoadModule('/src/core/classifier/tie-break.ts'), vite.ssrLoadModule('/src/core/ai/local-bench.ts'),
      vite.ssrLoadModule('/tests/evaluation/local-tasks/index.ts'),
    ]);
    if (task !== 'classify' && !local.LOCAL_CASE_TASKS.includes(task)) {
      console.error(`No case set for "${task}". Tasks with one: classify, ${local.LOCAL_CASE_TASKS.join(', ')}.`);
      return 2;
    }
    // Every text request in the labelled sets, asked as a two-way choice between the right level and its nearest wrong one.
    const rows = task !== 'classify' ? [] : [
      ...read('tests/fixtures/requests/classifier-cases.json').filter((c) => !c.images && !c.drawingPages && !c.videoFrames && !c.existingTemplate)
        .map((c) => [c.id, [c.text, c.audioTranscript].filter(Boolean).join('\n'), c.expected.complexity]),
      ...read('tests/evaluation/golden/text-requests.json').map((c) => [c.id, c.text, c.expected.complexity]),
      ...read('tests/evaluation/golden/modalities.json').filter((c) => c.modality === 'audio' && c.audioTranscript)
        .map((c) => [c.id, [c.text, c.audioTranscript].filter(Boolean).join('\n'), c.expected.complexity]),
    ].filter(([, text]) => text.trim().length > 8);
    const wrong = { simple: 'medium', complex: 'medium' };
    const cases = task !== 'classify' ? await local.buildCases(task) : rows.map(([id, text, expected], i) => {
      const other = wrong[expected] ?? (i % 2 ? 'simple' : 'complex');
      const [a, b] = i % 2 ? [other, expected] : [expected, other];
      return { id, request: tieBreakRequest(text, a, b), judge: (o) => (o.complexity === expected ? 'right' : 'wrong'), expected };
    });
    if (selfTest && task !== 'classify') {
      console.log(`SELF-TEST: ${task} builds ${cases.length} case(s) from the app's own requests. No model was asked.`);
      return cases.length >= 20 ? 0 : 1;
    }
    let answer;
    let model;
    if (selfTest) {
      let n = 0;
      answer = async (req) => {
        const expected = cases.find((c) => c.request === req).expected;
        const pick = ++n % 10 === 0 ? (JSON.stringify(req.jsonSchema).match(/"enum":\["(\w+)","(\w+)"\]/)?.slice(1).find((v) => v !== expected) ?? expected) : expected;
        return { text: JSON.stringify({ complexity: pick }), ms: 40 + (n % 7) };
      };
      model = 'stub (self-test)';
    } else {
      device = flag('provider') && opt('provider') === 'cloud' ? await openCloud(vite) : await openDevice();
      ({ answer, model } = device);
    }
    // `--show` prints each answer next to its verdict, to check a judge against what the model said. Only for the invented
    // sentences of the case sets in tests/evaluation/local-tasks, never for the labelled request sets, and never written to a file.
    if (flag('show') && task !== 'classify') {
      const ask = answer;
      let i = 0;
      answer = async (req) => {
        const res = await ask(req);
        console.log(`${cases[i++]?.id}: ${(res.text ?? res.error ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
        return res;
      };
    }
    const date = new Date().toISOString().slice(0, 10);
    const cloud = opt('provider') === 'cloud' && !selfTest;
    const evidence = cloud ? `docs/evidence/provider-${task}-cloud-${date}.json` : `docs/evidence/local-ready-${task}-web-${date}.json`;
    const run = await runLocalBenchmark(
      { task, platform: 'web', model, date, evidence, ...(flag('offline-verified') || device?.offline ? { offlineOk: true } : {}) },
      cases, answer,
    );
    if (cloud) run.record.model = device.models();
    console.log(`${selfTest ? 'SELF-TEST (stub model, no record is valid)' : cloud ? 'Cloud comparison run' : 'Run'}: ${task}, ${run.record.cases} cases`);
    console.log(JSON.stringify(run.record, null, 2));
    console.log(`Gate: ${run.verdict.status}${run.verdict.reasons.length ? ` (${run.verdict.reasons.join('; ')})` : ''}`);
    if (!selfTest) {
      mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
      writeFileSync(join(ROOT, evidence), JSON.stringify({
        kind: cloud ? 'provider-comparison' : 'local-ready', record: run.record, verdict: run.verdict, outcomes: run.outcomes,
        ...(cloud ? { modelRequests: device.requests(), note: 'Cloud run of the same cases the device model was asked. Not a record for LOCAL_EVIDENCE.' } : {}),
      }, null, 2));
      console.log(cloud ? `Raw run written to ${evidence}.` : `Raw run written to ${evidence}. To count it, add the record above to LOCAL_EVIDENCE in src/core/ai/local-ready.ts.`);
    }
    return selfTest || run.verdict.status !== 'failed' ? 0 : 1;
  } finally {
    await device?.close();
    await vite.close();
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message ?? e); process.exitCode = 2; });
