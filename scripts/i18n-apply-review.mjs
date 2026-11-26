#!/usr/bin/env node
/**
 * Applies filled-in native-speaker review sheets (.handoff/i18n-review/<lang>.csv) to the code.
 *
 *   node scripts/i18n-apply-review.mjs                       dry run on every sheet in .handoff/i18n-review
 *   node scripts/i18n-apply-review.mjs hi.csv gu.csv         dry run on chosen sheets
 *   node scripts/i18n-apply-review.mjs --write hi.csv        really change the files
 *   options: --lang hi (when the file name does not start with the language code), --force (apply a fix even
 *            when the catalogue text changed after the sheet was made)
 *
 * What it does for each sheet:
 *  - reads the CSV (UTF-8 with or without BOM, or Excel "Unicode Text"; comma, semicolon or tab separated);
 *  - for every row with a reviewer_fix: checks the text (same {placeholders} as English, written in the
 *    language's own script, not English, no dashes, no exclamation marks) and rejects the row if it fails;
 *  - writes accepted fixes into src/i18n/locales/<lang>.json (only those values change, the hand formatting
 *    of the file stays), into src/i18n/engine-messages.ts (rows "engine:*") and into
 *    src/features/settings/speech/languages.ts (row "speech:sample");
 *  - keeps "$meta.draft": true until EVERY row of the sheet has reviewer_ok set (y / yes / ok / 1 / a tick)
 *    and no row was rejected or stale. Only then it sets draft to false and notes who reviewed it and when.
 * Nothing is written without --write. A written file is re-read and compared with what was intended.
 */
import { readFileSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ENGINE_FILE, LANGS, LOCALES_DIR, REVIEW_DIR, SPEECH_FILE, decodeSheet, flatten, catalogueRows, hardErrors, jsonPathOf, loadSources, parseCsv, readEngine, readSpeech, spliceJson } from './i18n-review-lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const WRITE = flag('write');
const FORCE = flag('force');
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--lang');

const norm = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const isYes = (s) => /^(y|yes|ok|okay|1|true|x|✓|✔|✅)$/i.test(s.trim());
const atomicWrite = (file, text) => { writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); };
const tsEscape = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const src = loadSources();
let problems = 0;

function sheetFiles() {
  if (files.length) return files.map((f) => path.resolve(f));
  return readdirSync(REVIEW_DIR).filter((f) => /^[a-z]{2}\b.*\.csv$/i.test(f)).map((f) => path.join(REVIEW_DIR, f));
}

function processSheet(file) {
  const base = path.basename(file);
  const code = opt('lang') ?? base.match(/^([a-z]{2})(?![a-z])/i)?.[1]?.toLowerCase();
  const L = LANGS.find((l) => l.code === code);
  if (!L) { console.log(`${base}: cannot tell the language; name the file like hi.csv or pass --lang hi`); problems++; return; }

  const table = parseCsv(decodeSheet(readFileSync(file)));
  const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(['key', 'english', 'current_translation', 'reviewer_fix', 'reviewer_ok'].map((n) => [n, header.indexOf(n)]));
  const lost = Object.entries(col).filter(([, i]) => i < 0).map(([n]) => n);
  if (lost.length) { console.log(`${base}: missing column(s) ${lost.join(', ')}. Was the header row changed?`); problems++; return; }

  const current = src.byLang[L.code];
  const seen = new Set();
  const edits = []; // { key, value }
  const rejected = [];
  const stale = [];
  let withFix = 0;
  let okCount = 0;
  let reviewed = 0;

  for (const cells of table) {
    const get = (n) => (cells[col[n]] ?? '').trim();
    const key = get('key');
    if (!src.english.has(key)) { rejected.push(`${key || '(blank key)'}: unknown key, row ignored`); continue; }
    if (seen.has(key)) { rejected.push(`${key}: appears twice, the second one is ignored`); continue; }
    seen.add(key);
    const en = src.english.get(key);
    const now = current.get(key) ?? '';
    if (norm(get('english')) !== norm(en)) { stale.push(`${key}: the English text changed since this sheet was made`); continue; }
    if (norm(get('current_translation')) !== norm(now) && !FORCE) { stale.push(`${key}: the catalogue text changed since this sheet was made (use --force to apply anyway)`); continue; }

    const fix = get('reviewer_fix');
    const ok = isYes(get('reviewer_ok'));
    if (fix) {
      withFix++;
      const errors = hardErrors({ english: en, text: fix, ownScript: L.script, allowEnglishCopy: key === 'app.name' });
      if (errors.length) { rejected.push(`${key}: ${errors.join('; ')}`); continue; }
      if (norm(fix) !== norm(now)) edits.push({ key, value: fix });
    }
    if (ok) { okCount++; reviewed++; }
  }
  const missingRows = src.order.filter((k) => !seen.has(k));
  const complete = reviewed === src.order.length && !rejected.length && !stale.length && !missingRows.length;

  console.log(`\n${base} (${L.english}): ${table.length} rows, ${withFix} with reviewer_fix, ${edits.length} text changes accepted, ${okCount} marked ok`);
  for (const r of rejected) console.log(`  REJECTED ${r}`);
  for (const r of stale) console.log(`  STALE    ${r}`);
  if (missingRows.length) console.log(`  MISSING  ${missingRows.length} row(s) are not in the sheet (first: ${missingRows[0]})`);
  console.log(complete
    ? '  all rows reviewed: draft flag will be cleared'
    : `  draft stays on: ${src.order.length - reviewed} row(s) still need reviewer_ok (or have a problem above)`);
  if (rejected.length || stale.length) problems++;
  if (!WRITE) { for (const e of edits.slice(0, 5)) console.log(`  would change ${e.key}: ${e.value}`); if (edits.length > 5) console.log(`  ... and ${edits.length - 5} more`); return; }

  // ---- write: catalogue JSON
  const catEdits = edits.filter((e) => !e.key.includes(':'));
  const jsonFile = path.join(LOCALES_DIR, `${L.code}.json`);
  const oldJson = readFileSync(jsonFile, 'utf8');
  const jsonEdits = catEdits.map((e) => ({ path: jsonPathOf(e.key), json: JSON.stringify(e.value) }));
  if (complete) {
    jsonEdits.push({ path: '$meta.draft', json: 'false' });
    jsonEdits.push({ path: '$meta.note', json: JSON.stringify(`Reviewed by a native ${L.english} speaker on ${new Date().toISOString().slice(0, 10)}.`) });
  }
  if (jsonEdits.length) {
    const next = spliceJson(oldJson, jsonEdits);
    const before = catalogueRows(flatten(JSON.parse(oldJson)));
    const after = catalogueRows(flatten(JSON.parse(next)));
    const want = new Map(catEdits.map((e) => [e.key, e.value]));
    for (const [k, v] of before) if (after.get(k) !== (want.get(k) ?? v)) throw new Error(`${L.code}: unexpected change at ${k}, nothing written`);
    if (after.size !== before.size) throw new Error(`${L.code}: key set changed, nothing written`);
    atomicWrite(jsonFile, next);
    console.log(`  wrote ${path.relative(process.cwd(), jsonFile)}: ${catEdits.length} text change(s)${complete ? ', draft cleared' : ''}`);
  }

  // ---- write: engine messages and the Test voice sentence
  const engineEdits = edits.filter((e) => e.key.startsWith('engine:'));
  if (engineEdits.length) {
    let text = readFileSync(ENGINE_FILE, 'utf8');
    for (const e of engineEdits) {
      const name = e.key.slice('engine:'.length);
      const start = text.search(new RegExp(`^ {2}${L.code}: \\{\\r?$`, 'm'));
      const end = text.indexOf('\n  },', start);
      if (start < 0 || end < 0) throw new Error(`${L.code}: block not found in engine-messages.ts`);
      const re = new RegExp(`^( {4}${name}: ')((?:[^'\\\\]|\\\\.)*)(',?\\r?)$`, 'm');
      const block = text.slice(start, end);
      if (!re.test(block)) throw new Error(`${L.code}: ${name} not found in engine-messages.ts`);
      text = text.slice(0, start) + block.replace(re, (_, a, _b, c) => a + tsEscape(e.value) + c) + text.slice(end);
    }
    const check = readEngine(text)[L.code];
    for (const e of engineEdits) if (check[e.key.slice(7)] !== e.value) throw new Error(`${L.code}: engine message check failed for ${e.key}`);
    atomicWrite(ENGINE_FILE, text);
    console.log(`  wrote ${path.relative(process.cwd(), ENGINE_FILE)}: ${engineEdits.length} message(s)`);
  }
  const speech = edits.find((e) => e.key === 'speech:sample');
  if (speech) {
    const text = readFileSync(SPEECH_FILE, 'utf8');
    const re = new RegExp(`^(.*tag: '${L.code}-[A-Z]{2}'.*sample: ')((?:[^'\\\\]|\\\\.)*)(' \\}.*)$`, 'm');
    if (!re.test(text)) throw new Error(`${L.code}: sample line not found in languages.ts`);
    const next = text.replace(re, (_, a, _b, c) => a + tsEscape(speech.value) + c);
    if (readSpeech(next)[L.code] !== speech.value) throw new Error(`${L.code}: sample check failed`);
    atomicWrite(SPEECH_FILE, next);
    console.log(`  wrote ${path.relative(process.cwd(), SPEECH_FILE)}: Test voice sentence`);
  }
}

for (const f of sheetFiles()) {
  try { processSheet(f); } catch (e) { console.log(`${path.basename(f)}: ${e.message}`); problems++; }
}
console.log(WRITE
  ? '\nDone. Next: npx vitest run src/i18n --maxWorkers=1. If a language was cleared of draft, its "draft: true" expectation in src/i18n/catalogues.test.ts (and translator.test.ts for hi) needs updating by the owner of those tests.'
  : '\nDry run: nothing was written. Add --write to apply.');
process.exitCode = problems ? 1 : 0;
