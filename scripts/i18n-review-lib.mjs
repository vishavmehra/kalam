/**
 * Shared helpers for the native-speaker review workflow (i18n-review-build.mjs, i18n-apply-review.mjs).
 * Plain Node, no TypeScript imports. It reads three sources of Indian-language text:
 *   1. src/i18n/locales/<lang>.json          (the UI catalogue, compared with en.json)
 *   2. src/i18n/engine-messages.ts           (messages the runtime engine writes into generated apps)
 *   3. src/features/settings/speech/languages.ts   (the "Test voice" sentence per language)
 * Every piece of text becomes a "row" with a stable row key:
 *   shelf.empty.title        a catalogue string
 *   shelf.count[one]         one form of a plural message
 *   engine:required          an engine message
 *   speech:sample            the Test voice sentence
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// KALAM_I18N_ROOT lets a test point the scripts at a scratch copy of the repo layout.
export const ROOT = process.env.KALAM_I18N_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCALES_DIR = path.join(ROOT, 'src/i18n/locales');
export const ENGINE_FILE = path.join(ROOT, 'src/i18n/engine-messages.ts');
export const SPEECH_FILE = path.join(ROOT, 'src/features/settings/speech/languages.ts');
export const REVIEW_DIR = path.join(ROOT, '.handoff/i18n-review');
export const WORK_DIR = path.join(REVIEW_DIR, '_work');

/** The nine machine-translated languages. Script names match src/i18n/scripts.ts. */
export const LANGS = [
  { code: 'hi', english: 'Hindi', script: 'devanagari' },
  { code: 'gu', english: 'Gujarati', script: 'gujarati' },
  { code: 'mr', english: 'Marathi', script: 'devanagari' },
  { code: 'bn', english: 'Bengali', script: 'bengali' },
  { code: 'ta', english: 'Tamil', script: 'tamil' },
  { code: 'te', english: 'Telugu', script: 'telugu' },
  { code: 'kn', english: 'Kannada', script: 'kannada' },
  { code: 'ml', english: 'Malayalam', script: 'malayalam' },
  { code: 'pa', english: 'Punjabi', script: 'gurmukhi' },
];

export const CSV_COLUMNS = ['key', 'english', 'current_translation', 'back_translation', 'flag', 'reason', 'suggested_fix', 'reviewer_fix', 'reviewer_ok'];

// ---------------------------------------------------------------------------------------------
// Scripts and placeholders
// ---------------------------------------------------------------------------------------------

const BLOCKS = {
  devanagari: [[0x900, 0x97f], [0xa8e0, 0xa8ff]],
  bengali: [[0x980, 0x9ff]],
  gurmukhi: [[0xa00, 0xa7f]],
  gujarati: [[0xa80, 0xaff]],
  tamil: [[0xb80, 0xbff]],
  telugu: [[0xc00, 0xc7f]],
  kannada: [[0xc80, 0xcff]],
  malayalam: [[0xd00, 0xd7f]],
};
const LETTER = /[\p{L}\p{M}]/u;
const LATIN = /\p{Script=Latin}/u;

/** 'latin', an Indic script name, 'other' (any other letter script), or null for digits, punctuation, joiners. */
export function scriptOf(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0x964 || cp === 0x965) return null; // danda marks are shared by every Indic script
  if (!LETTER.test(ch)) return null;
  for (const [name, ranges] of Object.entries(BLOCKS)) if (ranges.some(([a, b]) => cp >= a && cp <= b)) return name;
  return LATIN.test(ch) ? 'latin' : 'other';
}

const TOKEN = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
export const placeholderNames = (s) => [...new Set([...s.matchAll(TOKEN)].map((m) => m[1]).filter(Boolean))].sort();
export const placeholderCount = (s) => [...s.matchAll(TOKEN)].length;
export const strayBraces = (s) => (s.replace(TOKEN, '').match(/[{}]/g) ?? []).length;

/** Script census of a text, ignoring {placeholders}. */
export function scriptCensus(text, ownScript) {
  const counts = {};
  for (const ch of text.replace(TOKEN, '')) {
    const s = scriptOf(ch);
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  const foreign = Object.keys(counts).filter((s) => s !== ownScript && s !== 'latin');
  return { own: counts[ownScript] ?? 0, latin: counts.latin ?? 0, foreign, counts };
}

/** Latin-script words in a text (placeholders removed). */
export const latinWords = (text) => text.replace(TOKEN, ' ').match(/[A-Za-z][A-Za-z'’]*/g) ?? [];

/**
 * Hard errors for a piece of translated text. Used by the build script (flag "fix") and by the apply
 * script (a reviewer's text is rejected if it has any). Returns a list of plain-English problems.
 */
export function hardErrors({ english, text, ownScript, allowEnglishCopy = false }) {
  const errors = [];
  if (typeof text !== 'string' || text.trim() === '') return ['empty'];
  const en = placeholderNames(english);
  const tr = placeholderNames(text);
  const fmt = (n) => (n.length ? n.map((x) => `{${x}}`).join(' ') : 'none');
  if (en.join(',') !== tr.join(',')) errors.push(`placeholders differ: English has ${fmt(en)}, this has ${fmt(tr)}`);
  if (strayBraces(text) > 0) errors.push('stray or broken curly brace');
  if (/[–—―]/.test(text)) errors.push('contains a long dash (copy rule: no dashes)');
  if (/[!！]/.test(text)) errors.push('contains an exclamation mark (copy rule)');
  const census = scriptCensus(text, ownScript);
  if (census.foreign.length) errors.push(`contains letters of another script: ${census.foreign.join(', ')}`);
  const hasLetters = /[\p{L}]/u.test(english.replace(TOKEN, ''));
  if (hasLetters && census.own === 0 && !allowEnglishCopy) errors.push('no letters of the language script (English left in place?)');
  if (hasLetters && !allowEnglishCopy && text.trim().toLowerCase() === english.trim().toLowerCase()) errors.push('identical to the English text');
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Reading the three sources
// ---------------------------------------------------------------------------------------------

const PLURAL = ['zero', 'one', 'two', 'few', 'many', 'other'];
const readJson = (code) => JSON.parse(readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));

/** Flat view of a locale file: key to string, or key to {one, other} for plural messages. */
export function flatten(raw) {
  const out = new Map();
  const walk = (node, prefix) => {
    for (const [name, v] of Object.entries(node)) {
      const p = prefix ? `${prefix}.${name}` : name;
      if (typeof v === 'string') out.set(p, v);
      else if (v && typeof v === 'object') {
        const ks = Object.keys(v);
        if (ks.length && typeof v.other === 'string' && ks.every((k) => PLURAL.includes(k) && typeof v[k] === 'string')) out.set(p, v);
        else walk(v, p);
      }
    }
  };
  const { $meta, ...rest } = raw;
  walk(rest, '');
  return out;
}

/** Row-keyed map of a catalogue (plural forms become `key[form]`). */
export function catalogueRows(flat) {
  const rows = new Map();
  for (const [key, v] of flat) {
    if (typeof v === 'string') rows.set(key, v);
    else for (const [form, text] of Object.entries(v)) rows.set(`${key}[${form}]`, text);
  }
  return rows;
}

/** `{ hi: { saved: '...', ... }, ... }` read from engine-messages.ts without importing TypeScript. */
export function readEngine(text = readFileSync(ENGINE_FILE, 'utf8')) {
  const out = {};
  let cur = null;
  for (const line of text.slice(text.indexOf('export const ENGINE_MESSAGES')).split(/\r?\n/)) {
    const head = line.match(/^ {2}([a-z]{2}): \{$/);
    if (head) { cur = head[1]; out[cur] = {}; continue; }
    if (/^ {2}\},?$/.test(line)) { cur = null; continue; }
    const m = cur && line.match(/^ {4}(\w+): '((?:[^'\\]|\\.)*)',?$/);
    if (m) out[cur][m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}

/** `{ hi: 'sample sentence', ... }` (English uses the en-IN row) read from languages.ts. */
export function readSpeech(text = readFileSync(SPEECH_FILE, 'utf8')) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/tag: '([a-z]{2})-[A-Z]{2}'.*sample: '((?:[^'\\]|\\.)*)'/);
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}

/**
 * Everything a review needs. `order` is the row order (English file order, then engine, then speech);
 * `english` and `byLang[code]` map row keys to text. Rows missing from a language are simply absent.
 */
export function loadSources() {
  const enFlat = flatten(readJson('en'));
  const engine = readEngine();
  const speech = readSpeech();
  const english = catalogueRows(enFlat);
  for (const [k, v] of Object.entries(engine.en)) english.set(`engine:${k}`, v);
  english.set('speech:sample', speech.en);
  const order = [...english.keys()];
  const byLang = {};
  const flats = {};
  const metas = {};
  for (const { code } of LANGS) {
    const raw = readJson(code);
    const flat = flatten(raw);
    flats[code] = flat;
    metas[code] = raw.$meta;
    const rows = catalogueRows(flat);
    for (const [k, v] of Object.entries(engine[code] ?? {})) rows.set(`engine:${k}`, v);
    if (speech[code] !== undefined) rows.set('speech:sample', speech[code]);
    byLang[code] = rows;
  }
  return { english, order, byLang, enFlat, flats, metas, engine, speech };
}

// ---------------------------------------------------------------------------------------------
// CSV (UTF-8 with BOM, CRLF, Excel friendly)
// ---------------------------------------------------------------------------------------------

const csvCell = (s) => {
  const v = String(s ?? '');
  return /[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
};

export const toCsv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** RFC 4180 parser. `delimiter` is sniffed from the first line when not given. */
export function parseCsv(text, delimiter) {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Bytes of a sheet to text: handles UTF-8 (with or without BOM) and the UTF-16 that Excel's "Unicode Text" makes. */
export function decodeSheet(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

// ---------------------------------------------------------------------------------------------
// Minimal-diff JSON edits (keeps the hand formatting of the locale files)
// ---------------------------------------------------------------------------------------------

/** Start and end offsets of every scalar (string, true, false, null, number) in a JSON object tree, by dotted path. */
export function locateScalars(text) {
  let i = 0;
  const out = new Map();
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const str = () => {
    const start = i;
    i++;
    while (text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    i++;
    return [start, i];
  };
  const value = (p) => {
    ws();
    if (text[i] === '"') { out.set(p, str()); return; }
    if (text[i] === '{') {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        const [ks, ke] = str();
        const key = JSON.parse(text.slice(ks, ke));
        ws(); i++; // ':'
        value(p ? `${p}.${key}` : key);
        ws();
        if (text[i] === ',') { i++; continue; }
        i++; // '}'
        return;
      }
    }
    const m = /^(true|false|null|-?\d[\d.eE+-]*)/.exec(text.slice(i));
    if (!m) throw new Error(`unsupported JSON at offset ${i}`);
    out.set(p, [i, i + m[0].length]);
    i += m[0].length;
  };
  value('');
  return out;
}

/** Replaces scalar values by dotted path, leaving every other byte alone. `edits` is [{ path, json }] (json is already stringified). */
export function spliceJson(text, edits) {
  const where = locateScalars(text);
  let out = text;
  for (const e of [...edits].sort((a, b) => (where.get(b.path)?.[0] ?? 0) - (where.get(a.path)?.[0] ?? 0))) {
    const at = where.get(e.path);
    if (!at) throw new Error(`path not found in file: ${e.path}`);
    out = out.slice(0, at[0]) + e.json + out.slice(at[1]);
  }
  return out;
}

/** Row key to the dotted JSON path of its value. `shelf.count[one]` becomes `shelf.count.one`. */
export const jsonPathOf = (rowKey) => rowKey.replace(/\[(\w+)\]$/, '.$1');
