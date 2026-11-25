#!/usr/bin/env node
/**
 * Makes ONE tiny real structured call per specialist provider through the same adapter code the
 * Cloud Function uses (lib/providers.js — run `npm run build` first), then prints only:
 * provider, status, latency, model, token counts and whether the output passed validation.
 * Secrets are read from functions/.secret.local and are never printed or logged.
 *
 *   node scripts/verify-providers.mjs [--claude-model <id>] [--nebius-model <id>] [--only claude|nebius]
 */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpecialistError, TASK_CONFIG, callClaude, callNebius } from '../lib/providers.js';
import { APP_PLAN_JSON_SCHEMA, extractJson, validateOutput } from '../lib/schemas.js';

const here = dirname(fileURLToPath(import.meta.url));
const secrets = Object.fromEntries(
  readFileSync(join(here, '..', '.secret.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z0-9_]+\s*=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Solid red 32×32 PNG built in-process (no fixtures, no deps) — the model must see it to answer "red". */
function redPng() {
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const size = 32;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([0xe0, 0x10, 0x10]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

function report(row) {
  console.log(JSON.stringify(row));
}

async function verifyClaude() {
  const model = arg('--claude-model') ?? TASK_CONFIG.plan_app.model();
  const started = Date.now();
  if (!secrets.KALAM_ANTHROPIC_API_KEY) return report({ provider: 'claude', status: 'not_configured' });
  try {
    const reply = await callClaude({
      apiKey: secrets.KALAM_ANTHROPIC_API_KEY, model, maxTokens: 2048, timeoutMs: 60_000, structured: true, effort: 'low',
      system: TASK_CONFIG.plan_app.preamble,
      prompt: 'Plan this app.\n<untrusted_user_request>A counter for glasses of water I drink each day.</untrusted_user_request>',
    });
    const checked = validateOutput('plan_app', extractJson(reply.text));
    report({
      provider: 'claude', task: 'plan_app', status: 'ok', latencyMs: Date.now() - started, model: reply.model,
      inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, schema: Object.keys(APP_PLAN_JSON_SCHEMA.properties).length + ' keys',
      passedValidation: checked.ok, ...(checked.ok ? {} : { validationError: checked.error }),
    });
  } catch (e) {
    report({ provider: 'claude', status: e instanceof SpecialistError ? e.code : 'error', latencyMs: Date.now() - started, model, message: e instanceof SpecialistError ? e.message : String(e?.name ?? 'Error') });
  }
}

async function verifyNebius() {
  const model = arg('--nebius-model') ?? TASK_CONFIG.interpret_sketch.model();
  const started = Date.now();
  if (!secrets.KALAM_NEBIUS_API_KEY) return report({ provider: 'nebius', status: 'not_configured' });
  const schema = { type: 'object', required: ['color'], properties: { color: { type: 'string' } }, additionalProperties: false };
  try {
    const reply = await callNebius({
      apiKey: secrets.KALAM_NEBIUS_API_KEY, model, maxTokens: 1024, timeoutMs: 90_000,
      system: `Reply with one JSON object only, matching this JSON Schema: ${JSON.stringify(schema)}`,
      prompt: 'What is the single main colour of this image? One lowercase word.',
      images: [{ mimeType: 'image/png', base64: redPng() }],
    });
    const raw = extractJson(reply.text);
    // A vision probe, not an IR: checked against its own tiny schema here (the callable pins the IR).
    const checked = raw && typeof raw === 'object' && typeof raw.color === 'string' ? { ok: true } : { ok: false };
    const sawImage = checked.ok && /red/i.test(String(raw.color));
    report({
      provider: 'nebius', task: 'interpret_sketch (vision probe)', status: 'ok', latencyMs: Date.now() - started,
      model: reply.model, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens,
      passedValidation: checked.ok, imageUnderstood: sawImage,
    });
  } catch (e) {
    report({ provider: 'nebius', status: e instanceof SpecialistError ? e.code : 'error', latencyMs: Date.now() - started, model, message: e instanceof SpecialistError ? e.message : String(e?.name ?? 'Error') });
  }
}

if (arg("--only") !== "nebius") await verifyClaude();
if (arg("--only") !== "claude") await verifyNebius();
