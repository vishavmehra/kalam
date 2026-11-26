#!/usr/bin/env node
/**
 * Prepares the native-speaker review sheets for the nine machine-translated catalogues.
 *
 *   node scripts/i18n-review-build.mjs checks                       deterministic checks, no AI, no network
 *   node scripts/i18n-review-build.mjs ai --stage A|B [--lang hi,gu] [--concurrency 3] [--model id]
 *   node scripts/i18n-review-build.mjs sheets                       merge checks + AI, write the CSV sheets
 *
 * The AI part uses Firebase AI Logic only (same setup as scripts/verify-firebase-ai.mjs: Firebase JS SDK,
 * Gemini Developer API, App Check debug token from .env.local, nothing secret is printed). Budget: at most
 * 40 model calls in total, counted in .handoff/i18n-review/_work/calls.json across runs, retries included.
 *   Stage A: blind literal back-translation (the model sees only the translation, not the English).
 *   Stage B: judge (English, translation and back-translation side by side) returns ok / check / fix.
 * Model output is validated with Zod. Output: .handoff/i18n-review/<lang>.csv (UTF-8 with BOM).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CSV_COLUMNS, LANGS, REVIEW_DIR, ROOT, WORK_DIR, hardErrors, latinWords, loadSources, placeholderCount, toCsv } from './i18n-review-lib.mjs';

const BUDGET = 40;
const SEV = { ok: 0, check: 1, fix: 2 };
const worst = (a, b) => (SEV[a] >= SEV[b] ? a : b);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const selectedLangs = () => {
  const want = arg('lang')?.split(',');
  return LANGS.filter((l) => !want || want.includes(l.code));
};
const readWork = (name, fallback) => (existsSync(path.join(WORK_DIR, name)) ? JSON.parse(readFileSync(path.join(WORK_DIR, name), 'utf8')) : fallback);
const writeWork = (name, data) => {
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(path.join(WORK_DIR, name), JSON.stringify(data, null, 2) + '\n');
};

// ---------------------------------------------------------------------------------------------
// 1. Deterministic checks
// ---------------------------------------------------------------------------------------------

const FORMAT_WORDS = new Set(['Kalam', 'Gemini', 'Nano']);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 1; };
const endMark = (s) => { const t = s.trimEnd(); return t.endsWith('...') ? '…' : t.slice(-1); };

function runChecks(src) {
  const out = {};
  for (const L of LANGS) {
    const flat = src.flats[L.code];
    const rows = src.byLang[L.code];
    const seg = new Intl.Segmenter(L.code, { granularity: 'grapheme' });
    const graphemes = (s) => [...seg.segment(s.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, 'N'))].length;
    const structural = [];
    for (const [k, v] of src.enFlat) {
      const t = flat.get(k);
      if (t === undefined) structural.push(`missing key: ${k}`);
      else if ((typeof t === 'string') !== (typeof v === 'string')) structural.push(`wrong shape (string vs plural): ${k}`);
    }
    for (const k of flat.keys()) if (!src.enFlat.has(k)) structural.push(`extra key not in English: ${k}`);
    const needed = new Intl.PluralRules(L.code).resolvedOptions().pluralCategories;
    for (const [k, v] of flat) if (typeof v !== 'string') for (const c of needed) if (typeof v[c] !== 'string') structural.push(`missing plural form ${c}: ${k}`);
    for (const k of src.order.filter((r) => r.startsWith('engine:') || r.startsWith('speech:'))) if (!rows.has(k)) structural.push(`missing: ${k}`);

    const ratios = [];
    for (const key of src.order) {
      const en = src.english.get(key);
      const tr = rows.get(key);
      if (tr !== undefined && graphemes(en) >= 6) ratios.push(graphemes(tr) / graphemes(en));
    }
    const med = median(ratios);

    const found = {};
    const add = (key, sev, msg) => (found[key] ??= []).push({ sev, msg });
    for (const key of src.order) {
      const en = src.english.get(key);
      const tr = rows.get(key);
      if (tr === undefined) { add(key, 'fix', 'missing in the catalogue'); continue; }
      for (const e of hardErrors({ english: en, text: tr, ownScript: L.script, allowEnglishCopy: key === 'app.name' })) add(key, 'fix', e);
      if (placeholderCount(en) !== placeholderCount(tr)) add(key, 'check', `placeholder used ${placeholderCount(tr)} time(s), English uses it ${placeholderCount(en)}`);
      if (tr !== tr.trim() || /\s{2,}/.test(tr) || /\n/.test(tr) !== /\n/.test(en)) add(key, 'check', 'stray spaces or line breaks');
      const enEnd = endMark(en);
      const trEnd = endMark(tr);
      const enStop = enEnd === '.';
      const trStop = trEnd === '.' || trEnd === '।' || trEnd === '॥';
      if (enStop !== trStop) add(key, 'check', enStop ? 'English ends with a full stop, this does not' : 'this ends with a full stop, English does not');
      else if (['?', '…', ':'].includes(enEnd) && enEnd !== trEnd) add(key, 'check', `English ends with "${enEnd}", this ends with "${trEnd}"`);
      const kept = [...new Set(latinWords(tr).filter((w) => w.length >= 2 && !FORMAT_WORDS.has(w) && !/^[A-Z0-9]{2,6}$/.test(w)))];
      if (kept.length) add(key, 'check', `Latin-script words left: ${kept.join(', ')}`);
      if (/\d/.test(en) && !/\p{Nd}/u.test(tr)) add(key, 'check', 'English has a number but this has none');
      const ge = graphemes(en);
      const gt = graphemes(tr);
      const ratio = gt / ge;
      if (ge <= 24 && gt >= 14 && ratio > med * 2) add(key, 'check', `much longer than English (${gt} vs ${ge} characters); may overflow a button`);
      else if (ge > 24 && ratio > med * 1.9) add(key, 'check', `much longer than English (${gt} vs ${ge} characters)`);
      else if (ge >= 25 && ratio < med * 0.4) add(key, 'check', `much shorter than English (${gt} vs ${ge} characters); something may be missing`);
    }
    out[L.code] = { structural, medianRatio: Number(med.toFixed(2)), rows: found };
  }
  return out;
}

function printChecks(res, src) {
  for (const L of LANGS) {
    const r = res[L.code];
    const fixes = Object.entries(r.rows).filter(([, v]) => v.some((x) => x.sev === 'fix'));
    const checks = Object.entries(r.rows).filter(([, v]) => !v.some((x) => x.sev === 'fix'));
    console.log(`\n${L.code} ${L.english}: rows ${src.byLang[L.code].size}/${src.order.length}, structural problems ${r.structural.length}, hard errors ${fixes.length}, soft flags ${checks.length}, median length ratio ${r.medianRatio}`);
    for (const s of r.structural) console.log(`  STRUCT ${s}`);
    for (const [k, v] of fixes) for (const x of v) console.log(`  FIX    ${k}: ${x.msg}`);
    const kinds = {};
    for (const [, v] of checks) for (const x of v) { const kind = x.msg.replace(/[:(].*$/, '').trim(); kinds[kind] = (kinds[kind] ?? 0) + 1; }
    console.log(`  soft flags by kind: ${JSON.stringify(kinds)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Firebase AI Logic (back-translation and judge)
// ---------------------------------------------------------------------------------------------

class BudgetError extends Error {}

async function openModel(modelId) {
  const env = Object.fromEntries(
    readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  );
  const hidden = Object.entries(env).filter(([k]) => /KEY|TOKEN|APP_ID|SECRET/.test(k)).map(([, v]) => v).filter((v) => v.length > 6);
  const scrub = (s) => hidden.reduce((t, v) => t.split(v).join('<redacted>'), String(s));
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => original(...args.map((a) => (typeof a === 'string' ? scrub(a) : a)));
  }
  const missing = ['API_KEY', 'PROJECT_ID', 'APP_ID'].map((k) => `EXPO_PUBLIC_FIREBASE_${k}`).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing in .env.local: ${missing.join(', ')}`);
  const { initializeApp } = await import('firebase/app');
  const { AgentPlatformBackend, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, ThinkingLevel } = await import('firebase/ai');
  const { CustomProvider, getToken, initializeAppCheck } = await import('firebase/app-check');
  const app = initializeApp({
    apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
  });
  let appCheck = 'not_configured';
  if (env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN;
    const check = initializeAppCheck(app, { provider: new CustomProvider({ getToken: () => Promise.reject(new Error('unused')) }) });
    try { await getToken(check); appCheck = 'debug_token_exchanged'; } catch (e) { appCheck = `debug_token_rejected: ${scrub(e?.message ?? e).slice(0, 160)}`; }
  }
  const ai = getAI(app, { backend: env.EXPO_PUBLIC_AI_BACKEND === 'agent_platform' ? new AgentPlatformBackend(env.EXPO_PUBLIC_AI_LOCATION || undefined) : new GoogleAIBackend() });
  const call = ({ system, user, schema, maxOutputTokens }) => {
    const gm = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: modelId,
        systemInstruction: system,
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens, temperature: 0.2, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      },
    }, { timeout: 240_000 });
    return gm.generateContent(user);
  };
  return { call, scrub, appCheck };
}

/** Counts every attempt (failed ones too) against the hard budget, persisted across runs. */
function makeLedger(model) {
  const ledger = readWork('calls.json', { budget: BUDGET, model, calls: [] });
  ledger.model = model;
  return {
    ledger,
    reserve(info) {
      if (ledger.calls.length >= BUDGET) throw new BudgetError(`budget of ${BUDGET} calls reached`);
      const rec = { n: ledger.calls.length + 1, ...info, startedAt: new Date().toISOString() };
      ledger.calls.push(rec);
      writeWork('calls.json', ledger);
      return rec;
    },
    save: () => writeWork('calls.json', ledger),
  };
}

const sjson = (properties, required) => ({ type: 'object', properties, required });
const SCHEMA_A = sjson({ items: { type: 'array', items: sjson({ id: { type: 'integer' }, english: { type: 'string' } }, ['id', 'english']) } }, ['items']);
const ISSUES = ['meaning_drift', 'too_formal', 'too_casual', 'wrong_term', 'machine_feel', 'grammar', 'placeholder', 'other'];
const SCHEMA_B = sjson({
  items: {
    type: 'array',
    items: sjson({
      id: { type: 'integer' },
      flag: { type: 'string', enum: ['ok', 'check', 'fix'] },
      issues: { type: 'array', items: { type: 'string', enum: ISSUES } },
      reason: { type: 'string' },
      suggested_fix: { type: 'string' },
    }, ['id', 'flag', 'issues', 'reason', 'suggested_fix']),
  },
}, ['items']);
const ZA = z.object({ id: z.number().int(), english: z.string() });
const ZB = z.object({ id: z.number().int(), flag: z.enum(['ok', 'check', 'fix']), issues: z.array(z.enum(ISSUES)), reason: z.string(), suggested_fix: z.string() });
const ZEnvelope = z.object({ items: z.array(z.unknown()) });

const systemA = (L) => `You translate short user-interface strings from ${L.english} into English. Be literal and word for word. Do not improve, smooth over or guess the author's intent: if the ${L.english} text is awkward, wrong or says something odd, the English must be equally awkward, wrong or odd. Keep placeholders such as {count}, {name} and {label} exactly as written. Reply with JSON only, one result per input id.`;

const systemB = (L) => `You review machine-drafted ${L.english} text for a phone app called Kalam. People, mostly small shopkeepers, tailors and other small business owners in India, describe or draw a small app and then use it offline on their phone. Screen text is short and plain. Product terms: "shelf" is the home list of the person's apps, "Bazaar" is where apps are shared, "activity" is a log of what the AI did.

Each item has: id, key (where the text appears, for context), english (the source), translation (the ${L.english} text under review), and back (a literal English back-translation of the translation, made without seeing the source).

Decide for each item:
- ok: the meaning matches the source and it reads like normal everyday ${L.english} for a phone app. Most items should be ok.
- check: the meaning is roughly right but a native speaker should look. Use it for: tone too formal or bookish, or too casual or slangy, for a polite phone app used by shopkeepers; a stiff, literal machine-translation feel; a word that is understandable but not the usual one; small meaning drift, something added or missing; ambiguity.
- fix: the meaning is wrong, opposite or missing a key part; an app or technical term is wrong in a way that would confuse a user (for example delete versus remove, backup, undo, template, export, shelf); a grammar error; or the text reads as broken.

Rules:
- Common English loanwords that people really say in ${L.english} (app, backup, PDF, phone, online, offline, settings) are fine in native script. Do not flag a word only because it comes from English.
- The translation should address the user with the respectful "you" form for ${L.english}, consistently.
- Placeholders in curly braces such as {count} and {label} must stay exactly as written; if they changed, flag fix and add the issue "placeholder".
- Judge only what you can tell. If unsure, prefer ok over inventing a problem, but never hide a clear problem.
- reason: one short plain-English sentence (at most 25 words) naming the problem; an empty string when ok.
- issues: zero or more of ${ISSUES.join(', ')}.
- suggested_fix: a corrected text written in ${L.english} script, only when flag is check or fix and you are confident, keeping placeholders exactly; otherwise an empty string. Never use dashes (em or en) or exclamation marks.
Reply with JSON only, one result per input id.`;

/** Runs one logical batch with at most one retry for missing items. Returns { got: Map(id -> item) }. */
async function runBatch({ stage, L, batchNo, ids, buildUser, system, schema, zItem, maxOutputTokens, model, ledger }) {
  const got = new Map();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const missing = ids.filter((id) => !got.has(id));
    if (!missing.length) break;
    const rec = ledger.reserve({ stage, lang: L.code, batch: batchNo, attempt, items: missing.length });
    const t0 = performance.now();
    try {
      const { response } = await model.call({ system, user: buildUser(missing), schema, maxOutputTokens });
      const text = response.text();
      const u = response.usageMetadata;
      Object.assign(rec, { ms: Math.round(performance.now() - t0), promptTokens: u?.promptTokenCount, outputTokens: u?.candidatesTokenCount, totalTokens: u?.totalTokenCount, source: response.inferenceSource });
      const env = ZEnvelope.parse(JSON.parse(text));
      let bad = 0;
      for (const item of env.items) {
        const p = zItem.safeParse(item);
        if (p.success && missing.includes(p.data.id)) got.set(p.data.id, p.data); else bad++;
      }
      Object.assign(rec, { ok: true, accepted: got.size, rejected: bad });
    } catch (e) {
      Object.assign(rec, { ms: Math.round(performance.now() - t0), ok: false, error: model.scrub(`${e?.code ?? e?.name ?? 'error'}: ${e?.message ?? e}`).slice(0, 240) });
      if (e instanceof BudgetError) throw e;
    }
    ledger.save();
  }
  return got;
}

async function pool(tasks, n) {
  let next = 0;
  let stop = null;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length && !stop) {
      const task = tasks[next++];
      try { await task(); } catch (e) { if (e instanceof BudgetError) stop = e; else throw e; }
    }
  }));
  if (stop) console.log(`STOPPED: ${stop.message}`);
}

async function runAi(src) {
  const stage = arg('stage');
  if (!['A', 'B'].includes(stage)) throw new Error('--stage A or B is required');
  const modelId = arg('model', 'gemini-3.8-flash');
  const langs = selectedLangs();
  const model = await openModel(modelId);
  const led = makeLedger(modelId);
  console.log(`model=${modelId} appCheck=${model.appCheck} callsSoFar=${led.ledger.calls.length}/${BUDGET}`);
  const idOf = new Map(src.order.map((k, i) => [k, i + 1]));
  const keyOf = new Map(src.order.map((k, i) => [i + 1, k]));
  const tasks = [];

  for (const L of langs) {
    const rows = src.byLang[L.code];
    if (stage === 'A') {
      const file = `ai-A-${L.code}.json`;
      const store = readWork(file, { back: {} });
      const ids = src.order.filter((k) => rows.has(k) && store.back[k] === undefined).map((k) => idOf.get(k));
      if (!ids.length) { console.log(`${L.code} A: already done`); continue; }
      tasks.push(async () => {
        const got = await runBatch({
          stage, L, batchNo: 1, ids, model, ledger: led, system: systemA(L), schema: SCHEMA_A, zItem: ZA, maxOutputTokens: 32_000,
          buildUser: (want) => JSON.stringify(want.map((id) => ({ id, text: rows.get(keyOf.get(id)) }))),
        });
        for (const [id, item] of got) store.back[keyOf.get(id)] = item.english;
        writeWork(file, { model: modelId, ...store });
        console.log(`${L.code} A: ${got.size}/${ids.length} back-translations`);
      });
    } else {
      const back = readWork(`ai-A-${L.code}.json`, { back: {} }).back;
      const file = `ai-B-${L.code}.json`;
      const store = readWork(file, { judged: {} });
      const todo = src.order.filter((k) => rows.has(k) && back[k] !== undefined && store.judged[k] === undefined);
      const half = Math.ceil(src.order.length / 2);
      [todo.filter((k) => idOf.get(k) <= half), todo.filter((k) => idOf.get(k) > half)].forEach((keys, b) => {
        if (!keys.length) return;
        tasks.push(async () => {
          const got = await runBatch({
            stage, L, batchNo: b + 1, ids: keys.map((k) => idOf.get(k)), model, ledger: led, system: systemB(L), schema: SCHEMA_B, zItem: ZB, maxOutputTokens: 32_000,
            buildUser: (want) => JSON.stringify(want.map((id) => { const k = keyOf.get(id); return { id, key: k, english: src.english.get(k), translation: rows.get(k), back: back[k] }; })),
          });
          for (const [id, item] of got) store.judged[keyOf.get(id)] = { flag: item.flag, issues: item.issues, reason: item.reason, suggested_fix: item.suggested_fix };
          writeWork(file, { model: modelId, ...store });
          const flags = [...got.values()].reduce((a, x) => ({ ...a, [x.flag]: (a[x.flag] ?? 0) + 1 }), {});
          console.log(`${L.code} B${b + 1}: ${got.size}/${keys.length} judged ${JSON.stringify(flags)}`);
        });
      });
    }
  }
  await pool(tasks, Number(arg('concurrency', '3')));
  const calls = led.ledger.calls;
  console.log(`calls used: ${calls.length}/${BUDGET}; failed: ${calls.filter((c) => c.ok === false).length}`);
}

// ---------------------------------------------------------------------------------------------
// 3. Sheets
// ---------------------------------------------------------------------------------------------

function buildSheets(src) {
  const checks = readWork('checks.json');
  if (!checks) throw new Error('run "checks" first');
  mkdirSync(REVIEW_DIR, { recursive: true });
  const summary = {};
  let formulaCells = 0;
  for (const L of LANGS) {
    const back = readWork(`ai-A-${L.code}.json`, { back: {} }).back;
    const judged = readWork(`ai-B-${L.code}.json`, { judged: {} }).judged;
    const rows = src.byLang[L.code];
    const out = [];
    let aiMissing = 0;
    let droppedFixes = 0;
    src.order.forEach((key, index) => {
      const en = src.english.get(key);
      const tr = rows.get(key) ?? '';
      const det = checks[L.code].rows[key] ?? [];
      const ai = judged[key];
      let flag = det.reduce((f, x) => worst(f, x.sev), 'ok');
      const reasons = [];
      if (det.length) reasons.push(`[auto] ${det.map((x) => x.msg).join('; ')}`);
      let fix = '';
      if (ai) {
        flag = worst(flag, ai.flag);
        if (ai.flag !== 'ok') {
          reasons.push(`[AI] ${ai.reason || ai.issues.join(', ')}`);
          if (ai.suggested_fix.trim()) {
            const bad = hardErrors({ english: en, text: ai.suggested_fix.trim(), ownScript: L.script, allowEnglishCopy: key === 'app.name' });
            if (bad.length) { droppedFixes++; reasons.push(`[AI suggestion dropped: ${bad[0]}]`); } else fix = ai.suggested_fix.trim();
          }
        }
      } else if (tr) { aiMissing++; reasons.push('[AI] not checked'); }
      out.push({ index, cells: [key, en, tr, back[key] ?? '', flag, reasons.join(' | '), fix, '', ''], flag });
    });
    out.sort((a, b) => SEV[b.flag] - SEV[a.flag] || a.index - b.index);
    for (const r of out) for (const c of r.cells.slice(0, 7)) if (/^[=+\-@]/.test(c)) formulaCells++;
    writeFileSync(path.join(REVIEW_DIR, `${L.code}.csv`), toCsv([CSV_COLUMNS, ...out.map((r) => r.cells)]));
    const count = (f) => out.filter((r) => r.flag === f).length;
    summary[L.code] = { rows: out.length, ok: count('ok'), check: count('check'), fix: count('fix'), aiMissing, droppedFixes };
  }
  writeWork('summary.json', summary);
  console.log(JSON.stringify(summary, null, 2));
  if (formulaCells) console.log(`WARNING: ${formulaCells} cells start with = + - or @ and Excel may read them as formulas`);
}

// ---------------------------------------------------------------------------------------------

const command = process.argv[2];
const src = loadSources();
if (command === 'checks') {
  const res = runChecks(src);
  writeWork('checks.json', Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v])));
  printChecks(res, src);
} else if (command === 'ai') {
  runAi(src).catch((e) => { console.error(String(e?.message ?? e).slice(0, 400)); process.exitCode = 2; });
} else if (command === 'sheets') {
  buildSheets(src);
} else {
  console.error('usage: i18n-review-build.mjs checks | ai --stage A|B [--lang hi,gu] | sheets');
  process.exitCode = 1;
}
