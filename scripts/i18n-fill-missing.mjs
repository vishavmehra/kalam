#!/usr/bin/env node
/**
 * Fills the keys that en.json has and a locale lacks, by asking Gemini through Firebase AI Logic (cloud only,
 * config from .env.local like verify-firebase-ai.mjs). Keeps {placeholders} and plural forms, rejects bad
 * output (wrong placeholders, wrong script, dashes, exclamation marks), drops keys absent from en.json,
 * and leaves "$meta.draft": true so the native-speaker review still applies.
 *
 *   node scripts/i18n-fill-missing.mjs [hi gu ...] [--model gemini-3.8-flash] [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { CustomProvider, getToken, initializeAppCheck } from 'firebase/app-check';
import { AgentPlatformBackend, getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, ThinkingLevel } from 'firebase/ai';

const DIR = new URL('../src/i18n/locales/', import.meta.url);
const NAMES = { hi: ['Hindi', 'Devanagari'], gu: ['Gujarati', 'Gujarati'], mr: ['Marathi', 'Devanagari'], bn: ['Bengali', 'Bengali'], ta: ['Tamil', 'Tamil'], te: ['Telugu', 'Telugu'], kn: ['Kannada', 'Kannada'], ml: ['Malayalam', 'Malayalam'], pa: ['Punjabi (Gurmukhi)', 'Gurmukhi'] };
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const mi = args.indexOf('--model');
const MODEL = mi >= 0 ? args[mi + 1] : 'gemini-3.8-flash';
const langs = args.filter((a, i) => NAMES[a] && args[i - 1] !== '--model');
const todo = langs.length ? langs : Object.keys(NAMES);

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const app = initializeApp({ apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY, authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, appId: env.EXPO_PUBLIC_FIREBASE_APP_ID });
// App Check debug token (registered in the Firebase console), same as verify-firebase-ai.mjs. Never printed.
if (env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN) {
  globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN;
  const log = console.log;
  console.log = (...a) => log(...a.map((x) => (typeof x === 'string' ? x.split(env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN).join('<redacted>') : x)));
  await getToken(initializeAppCheck(app, { provider: new CustomProvider({ getToken: () => Promise.reject(new Error('unused')) }) }));
}
const model = getGenerativeModel(getAI(app, { backend: env.EXPO_PUBLIC_AI_BACKEND === 'agent_platform' ? new AgentPlatformBackend(env.EXPO_PUBLIC_AI_LOCATION || undefined) : new GoogleAIBackend() }), {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: MODEL, generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } },
});

const isObj = (v) => v && typeof v === 'object';
const isPlural = (v) => isObj(v) && 'other' in v;
function flat(tree, pre = '', out = {}) {
  for (const [k, v] of Object.entries(tree)) {
    if (pre === '' && k === '$meta') continue;
    if (isObj(v) && !isPlural(v)) flat(v, `${pre}${k}.`, out); else out[pre + k] = v;
  }
  return out;
}
const forms = (v) => (typeof v === 'string' ? [v] : Object.values(v));
const ph = (v) => [...new Set(forms(v).flatMap((s) => s.match(/\{[^}]+\}/g) ?? []))].sort().join(',');

const en = JSON.parse(readFileSync(new URL('en.json', DIR), 'utf8'));
const enFlat = flat(en);

function valid(code, src, out) {
  const need = isPlural(src) ? new Intl.PluralRules(code).resolvedOptions().pluralCategories : null;
  if ((typeof src === 'string') !== (typeof out === 'string')) return false;
  if (need && !need.every((c) => typeof out[c] === 'string')) return false;
  if (ph(src) !== ph(out)) return false;
  const script = new RegExp(`\\p{Script=${NAMES[code][1]}}`, 'u');
  return forms(out).every((s) => s.trim() && script.test(s) && !/[–—!]/.test(s));
}

async function translate(code, batch) {
  const [name] = NAMES[code];
  const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories.join(', ');
  const prompt = `Translate these UI strings of the app Kalam from English to ${name}. Plain, natural, everyday ${name} for ordinary users. Keep every {placeholder} exactly as written. Keep the brand name Kalam as is. No em dashes, no en dashes, no exclamation marks. Write numbers and unit words (MB, min) in ${name} script where a word is needed. A value that is an object is a plural message: return an object with the keys ${cats}, each form containing {count}. Return one JSON object mapping each key to its translation, with exactly the same keys.\n\n${JSON.stringify(batch)}`;
  const { response } = await model.generateContent(prompt);
  return JSON.parse(response.text());
}

for (const code of todo) {
  const file = new URL(`${code}.json`, DIR);
  const cur = JSON.parse(readFileSync(file, 'utf8'));
  const have = flat(cur);
  const missing = Object.keys(enFlat).filter((k) => !(k in have));
  const extra = Object.keys(have).filter((k) => !(k in enFlat));
  const got = {};
  let pending = missing;
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    for (let i = 0; i < pending.length; i += 60) {
      const keys = pending.slice(i, i + 60);
      const batch = Object.fromEntries(keys.map((k) => [k, enFlat[k]]));
      try {
        const res = await translate(code, batch);
        for (const k of keys) if (res[k] !== undefined && valid(code, enFlat[k], res[k])) got[k] = res[k];
      } catch (e) { console.error(`${code}: batch failed`, String(e?.message ?? e).replace(/key=[^&s"]+/g, ""), JSON.stringify(e?.customErrorData ?? {}).slice(0, 300)); }
    }
    pending = missing.filter((k) => !(k in got));
  }
  console.log(`${code}: missing ${missing.length}, filled ${Object.keys(got).length}, still missing ${pending.length}, removed ${extra.length}`);
  if (DRY) continue;
  const merged = { $meta: cur.$meta ?? { draft: true, note: `Drafted by an AI model. Needs review by a native ${NAMES[code][0]} speaker before release.` } };
  merged.$meta.draft = true;
  for (const [k, v] of Object.entries(enFlat)) {
    const val = k in have ? have[k] : got[k];
    if (val === undefined) continue;
    const parts = k.split('.');
    let node = merged;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    node[parts.at(-1)] = val;
  }
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
}
