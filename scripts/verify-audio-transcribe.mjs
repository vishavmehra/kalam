#!/usr/bin/env node
/**
 * Real cloud transcription check (docs/06 section 8.3, D00-026). Speaks one fixed, invented sentence into a WAV file with the
 * Windows speech voice, sends it through Kalam's REAL transcribe service and orchestrator to Gemini through Firebase AI Logic (audio part,
 * cloud only, App Check via the registered debug token), and checks the words that came back. One billed request.
 *
 *   node scripts/verify-audio-transcribe.mjs [--max-calls 1] [--write-evidence]
 *
 * The sentence is made up for this check, so the transcript is safe to keep in the evidence file. Keys and config values are never printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEnv, initFirebase, installSpendCap, loadEnv } from './lib/eval-live.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const maxCalls = Number(argv[argv.indexOf('--max-calls') + 1]) || 1;
const SAID = 'Add a customer called Raju Kumar, a blue kurta, chest forty two inches, delivery on Friday.';
const EXPECT = ['raju', 'kurta', 'friday'];

const env = loadEnv(ROOT);
const scrub = applyEnv(env);
const cap = installSpendCap(maxCalls, scrub);

/** Speaks `SAID` into a WAV with System.Speech (Windows). Returns the bytes, or undefined where there is no voice. */
function speak(dir) {
  const file = join(dir, 'said.wav');
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${file.replace(/'/g, "''")}'); $s.Speak('${SAID.replace(/'/g, "''")}'); $s.Dispose()`;
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60_000 });
  return run.status === 0 ? readFileSync(file) : undefined;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'kalam-audio-'));
  const { createServer } = await import('vite');
  let vite;
  try {
    const wav = speak(dir);
    if (!wav) throw new Error('No Windows speech voice could make the test recording.');
    const firebase = await initFirebase(env);
    vite = await createServer({
      root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', resolve: { alias: { '@': join(ROOT, 'src') } },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
    });
    const load = (p) => vite.ssrLoadModule(p);
    const [{ createFirebaseProvider }, appModule, { createOrchestrator }, { createTranscribeService }, { DEFAULT_SETTINGS }] = await Promise.all([
      load('/src/infrastructure/firebase/firebase-provider.ts'), load('/src/infrastructure/firebase/app.ts'), load('/src/core/ai/orchestrator.ts'),
      load('/src/core/tasks/transcribe-service.ts'), load('/src/core/contracts/index.ts'),
    ]);
    if (appModule.getFirebaseApp() !== firebase.app) throw new Error('The provider did not pick up the App Check-enabled Firebase app.');
    const events = [];
    let settings = { ...DEFAULT_SETTINGS, onboarded: true };
    const ai = createOrchestrator({
      rateLimit: false, cacheResults: false, firebase: createFirebaseProvider(),
      specialist: { name: 'claude', isConfigured: () => false, onDeviceStatus: async () => ({ platform: 'other', apiExposed: false, availability: 'unavailable' }), generateStructured: async () => ({ success: false, provider: 'none', source: 'cloud', latencyMs: 0, fallbackUsed: false, errorCode: 'not_configured' }) },
      events: { add: async (e) => { events.push(e); }, list: async () => events, clear: async () => { events.length = 0; } },
      settings: { get: async () => settings, update: async (p) => (settings = { ...settings, ...p }) },
      network: { online: () => true, subscribe: () => () => {} },
    });
    const t0 = performance.now();
    const out = await createTranscribeService({ ai }).transcribe({ mimeType: 'audio/wav', base64: wav.toString('base64') }, { language: 'en' });
    const latencyMs = Math.round(performance.now() - t0);
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]+/g, ' ');
    const matched = out.ok ? EXPECT.filter((w) => norm(out.text).includes(w)) : [];
    const result = {
      ok: out.ok && matched.length === EXPECT.length,
      appCheck: firebase.appCheck,
      recording: { mimeType: 'audio/wav', bytes: wav.length, spoken: SAID },
      outcome: out.ok ? { source: out.source, model: out.model, language: out.language, transcript: out.text } : { code: out.code, message: out.message },
      wordsFound: matched,
      wordsExpected: EXPECT,
      latencyMs,
      modelRequests: cap.used(),
      event: events.at(-1) && { task: events.at(-1).taskType, source: events.at(-1).source, provider: events.at(-1).provider, success: events.at(-1).success, platform: events.at(-1).platform },
    };
    console.log(JSON.stringify(result, null, 2));
    if (argv.includes('--write-evidence')) {
      mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
      const date = new Date().toLocaleDateString('sv-SE');
      writeFileSync(join(ROOT, 'docs', 'evidence', `audio-transcribe-${date}.json`), `${JSON.stringify({ kind: 'audio-cloud-transcription', recordedAt: new Date().toISOString(), command: 'node scripts/verify-audio-transcribe.mjs', ...result }, null, 2)}\n`);
    }
    return result.ok ? 0 : 1;
  } finally {
    await vite?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(scrub(e?.message ?? e)); process.exitCode = 2; });
