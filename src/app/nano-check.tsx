/**
 * `/nano-check` (deep link kalam://nano-check): a self-check of Kalam's real on-device AI path on a phone, for
 * Firebase Test Lab runs and demo recordings. No screen links here.
 *
 * On open it reports Gemini Nano's availability from the kalam-nano module (AICore through Firebase AI Logic's
 * Android on-device SDK) and, when the model cannot run, why (the AICore reason, in plain English). When the phone
 * offers a download it asks first, and downloads only if the person agrees, waiting up to 10 minutes. Then it loads
 * the model, runs one small structured prompt through Kalam's orchestrator with mode only_on_device, and shows
 * where the answer came from, the model, the latency and the schema-checked answer, plus the App Check status.
 * Every step is also one logcat line (tag ReactNativeJS) that starts with KALAM_NANO_CHECK.
 *
 * Only in development builds, or a build made with EXPO_PUBLIC_DIAGNOSTICS=true (the Test Lab APK). A store
 * build shows a short note and runs nothing.
 *
 * No cloud request: the orchestrator never widens only_on_device to the cloud (routing.ts), this screen does not
 * touch Remote Config, Firestore or Auth, and App Check asks Play Integrity for nothing until the first cloud
 * request (native-app-check.native.ts), so its row should stay "no token requested yet". The one network use left
 * is AICore downloading the model from Google, and only after the person said yes.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { z } from 'zod';

import { withBudget } from '@/core/ai/orchestrator';
import type { AIExecutionResult, AIOrchestrator, OnDeviceStatus, StructuredRequest } from '@/core/contracts';
import { Button, Screen, Text, useKalamTheme } from '@/design';
import { appCheckStatus } from '@/infrastructure/firebase/app';
import { onDeviceStatus } from '@/infrastructure/firebase/on-device';
import { getServices } from '@/services';

// ─── The check (pure: every effect comes in through NanoCheckDeps) ──────────────────────────────

export const NANO_CHECK_TAG = 'KALAM_NANO_CHECK';
export const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** Google publishes no size for Gemini Nano, only that it is gigabytes (AICore help, read 2026-11-25). */
export const DOWNLOAD_LABEL = 'Download the on-device model (a few GB, Wi-Fi recommended)';

/**
 * Development builds, or a build made with EXPO_PUBLIC_DIAGNOSTICS=true (the Test Lab APK), the same rule as /lab
 * plus that one opt-in for test builds. A store build has neither.
 */
export function nanoCheckAllowed(dev: boolean, diagnostics: string | undefined): boolean {
  return dev || diagnostics === 'true';
}
const PROMPT_TIMEOUT_MS = 90_000;

const CATEGORIES = ['shopping', 'work', 'health', 'travel'] as const;
export const NOTE = 'Buy milk, eggs and bread on the way home.';
export const EXPECTED_CATEGORY = 'shopping';
const answerSchema = z.object({ category: z.enum(CATEGORIES) });
export type NanoAnswer = z.infer<typeof answerSchema>;

/** The one prompt: tiny, English (a validated on-device language), with one right answer. */
export function nanoCheckRequest(): StructuredRequest<NanoAnswer> {
  return {
    taskType: 'classify',
    mode: 'only_on_device',
    system: 'You sort a short note into exactly one category.',
    prompt: `Note: "${NOTE}"\nCategories: ${CATEGORIES.join(', ')}.\nWhich category fits the note best?`,
    jsonSchema: {
      type: 'object',
      properties: { category: { type: 'string', enum: [...CATEGORIES] } },
      required: ['category'],
      additionalProperties: false,
    },
    parse: (raw) => {
      const r = answerSchema.safeParse(raw);
      return r.success ? { success: true, data: r.data } : { success: false, error: r.error.issues.map((i) => i.message).join('; ') };
    },
    timeoutMs: PROMPT_TIMEOUT_MS,
    languages: ['en'],
  };
}

export interface DeviceInfo {
  os: string;
  brand?: string;
  model?: string;
  release?: string;
  apiLevel?: string;
}

export type NanoCheckStep = 'status' | 'confirm' | 'download' | 'warmup' | 'prompt' | 'app_check' | 'done';
export type DownloadOutcome = 'not_needed' | 'declined' | 'running' | 'completed' | 'timed_out' | 'failed';

export interface NanoCheckReport {
  device: DeviceInfo;
  step: NanoCheckStep;
  startedAt: number;
  stepStartedAt: number;
  /** First availability, before any download. */
  status?: OnDeviceStatus;
  download: DownloadOutcome;
  downloadProgress?: number;
  downloadDetail?: string;
  /** Availability after the download step (or the same check again when none was needed). */
  statusAfter?: OnDeviceStatus;
  prompt?: AIExecutionResult<NanoAnswer> & { attempts: number };
  appCheck?: { status: string; detail?: string };
  finishedAt?: number;
  error?: string;
}

export interface NanoCheckDeps {
  device: DeviceInfo;
  /** Straight from the native module, without the orchestrator's 1.5 s budget (a first AICore bind can be slower). */
  status(): Promise<OnDeviceStatus>;
  /** Asks the person before a model download starts. Resolves true only on their yes. */
  confirmDownload(): Promise<boolean>;
  prepare(onProgress: (p: number) => void): Promise<OnDeviceStatus>;
  warmUp(): Promise<OnDeviceStatus>;
  run: AIOrchestrator['run'];
  appCheck(): Promise<{ status: string; detail?: string }>;
  now(): number;
  log(line: string): void;
  downloadTimeoutMs?: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const logLine = (step: string, fields: Record<string, unknown>) => `${NANO_CHECK_TAG} ${JSON.stringify({ step, ...fields })}`;

const failedStatus = (e: unknown): OnDeviceStatus => ({ platform: 'other', apiExposed: false, availability: 'unknown', detail: message(e) });

/** Runs every step once, reporting each change through `onChange`. Never throws. */
export async function runNanoCheck(deps: NanoCheckDeps, onChange: (r: NanoCheckReport) => void = () => {}): Promise<NanoCheckReport> {
  const startedAt = deps.now();
  let r: NanoCheckReport = { device: deps.device, step: 'status', startedAt, stepStartedAt: startedAt, download: 'not_needed' };
  const set = (patch: Partial<NanoCheckReport>) => {
    r = { ...r, ...patch };
    onChange(r);
  };
  const step = (s: NanoCheckStep) => set({ step: s, stepStartedAt: deps.now() });
  const log = (s: string, fields: Record<string, unknown>) => deps.log(logLine(s, fields));
  const status = () => deps.status().catch(failedStatus);

  try {
    log('start', { ...deps.device });
    onChange(r);

    const first = await status();
    set({ status: first });
    log('status', { availability: first.availability, apiExposed: first.apiExposed, reason: first.reason, reasonCode: first.reasonCode, detail: first.detail });

    // A download that is already running needs no new consent; starting one does.
    let agreed = first.availability === 'downloading';
    if (first.availability === 'downloadable') {
      step('confirm');
      log('download', { event: 'asked' });
      agreed = await deps.confirmDownload().catch(() => false);
      if (!agreed) {
        set({ download: 'declined' });
        log('download', { event: 'declined' });
      }
    }

    if (agreed) {
      step('download');
      set({ download: 'running', downloadProgress: first.progress });
      log('download', { event: 'start', from: first.availability, timeoutMs: deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS });
      let tenth = -1;
      const onProgress = (p: number) => {
        set({ downloadProgress: p });
        const t = Math.floor(p * 10);
        if (t > tenth) {
          tenth = t;
          log('download', { event: 'progress', percent: Math.round(p * 100) });
        }
      };
      const done = await withBudget<{ s: OnDeviceStatus } | { error: string } | { timedOut: true }>(
        deps.prepare(onProgress).then((s) => ({ s }), (e: unknown) => ({ error: message(e) })),
        deps.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS,
        { timedOut: true },
      );
      const download: DownloadOutcome = 'timedOut' in done ? 'timed_out'
        : 's' in done && done.s.availability === 'available' ? 'completed' : 'failed';
      const detail = 'error' in done ? done.error : 's' in done ? done.s.detail : undefined;
      set({ download, downloadDetail: detail });
      log('download', { event: download, percent: r.downloadProgress === undefined ? undefined : Math.round(r.downloadProgress * 100), detail });
    }

    const after = await status();
    set({ statusAfter: after });
    log('status_after', { availability: after.availability, reason: after.reason, reasonCode: after.reasonCode, detail: after.detail });

    if (after.availability === 'available') {
      step('warmup');
      const w = await deps.warmUp().catch(failedStatus);
      log('warmup', { availability: w.availability, warm: w.warm, detail: w.detail });
    }

    // Runs even when the model is not available: then the orchestrator must refuse (model_unavailable) rather
    // than send the request to the cloud, which is evidence of the code path too.
    step('prompt');
    const req = nanoCheckRequest();
    let attempts = 1;
    let res = await deps.run(req, { taskType: 'classify' });
    if (!res.success && res.errorCode === 'model_unavailable' && after.availability === 'available') {
      // The orchestrator's status check has a 1.5 s budget; a slow AICore answer reads as 'unknown'. One more try.
      log('prompt', { event: 'retry', errorCode: res.errorCode, errorMessage: res.errorMessage });
      attempts = 2;
      res = await deps.run(req, { taskType: 'classify' });
    }
    set({ prompt: { ...res, attempts } });
    log('prompt', {
      success: res.success, source: res.source, provider: res.provider, model: res.model, latencyMs: res.latencyMs,
      output: res.output, matchesExpected: res.output?.category === EXPECTED_CATEGORY,
      errorCode: res.errorCode, errorMessage: res.errorMessage, attempts,
    });

    step('app_check');
    const appCheck = await deps.appCheck().catch((e: unknown) => ({ status: 'error', detail: message(e) }));
    set({ appCheck });
    log('app_check', appCheck);
  } catch (e) {
    set({ error: message(e) });
    log('error', { message: message(e) });
  }
  set({ step: 'done', finishedAt: deps.now() });
  log('done', evidenceSummary(r));
  return r;
}

/** The fields the evidence JSON keeps: no prompt text beyond the fixed note, no identifiers. */
export function evidenceSummary(r: NanoCheckReport) {
  const p = r.prompt;
  return {
    device: r.device,
    availability: r.status?.availability,
    availabilityReason: r.status?.reason,
    availabilityReasonCode: r.status?.reasonCode,
    availabilityDetail: r.status?.detail,
    download: r.download,
    downloadPercent: r.downloadProgress === undefined ? undefined : Math.round(r.downloadProgress * 100),
    downloadDetail: r.downloadDetail,
    availabilityAfter: r.statusAfter?.availability,
    modelDetail: r.statusAfter?.detail,
    source: p?.source,
    model: p?.model,
    latencyMs: p?.latencyMs,
    outputValid: p?.success === true,
    output: p?.output,
    matchesExpected: p?.output?.category === EXPECTED_CATEGORY,
    errorCode: p?.errorCode,
    errorMessage: p?.errorMessage,
    appCheck: r.appCheck,
    totalMs: r.finishedAt === undefined ? undefined : r.finishedAt - r.startedAt,
    error: r.error,
  };
}

/** Brand, model and OS version only: never the serial or build fingerprint that Platform.constants also has. */
export function deviceInfo(platform: { OS: string; Version: string | number; constants?: object }): DeviceInfo {
  const c = (platform.constants ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
  return { os: platform.OS, brand: str(c.Brand), model: str(c.Model), release: str(c.Release), apiLevel: str(platform.Version) };
}

/** AICore's model name (nano-v3, nano-v4-full, ...), which on-device.native.ts puts in the detail once available. */
export function nativeModelName(s?: OnDeviceStatus): string | undefined {
  return s?.availability === 'available' ? /^Model on this phone: (.+)$/.exec(s.detail ?? '')?.[1] : undefined;
}

export const AVAILABILITY_TEXT: Record<OnDeviceStatus['availability'], string> = {
  available: 'Available', downloadable: 'Downloadable', downloading: 'Downloading', unavailable: 'Unavailable', unknown: 'Unknown',
};

/** The big label: where the answer really came from. */
export function sourceText(r: NanoCheckReport): string {
  const p = r.prompt;
  if (!p) return r.step === 'done' ? 'No answer' : 'Checking';
  if (!p.success) return 'Not run on device';
  return p.source === 'on_device' ? 'On device' : p.source === 'cloud' ? 'Cloud' : p.source;
}

export function downloadText(r: NanoCheckReport): string {
  const pct = r.downloadProgress === undefined ? '' : ` (${Math.round(r.downloadProgress * 100)}%)`;
  switch (r.download) {
    case 'not_needed': return r.status?.availability === 'available' ? 'Not needed, already on the phone' : 'Not offered';
    case 'declined': return 'Not started: you chose not to download';
    case 'running': return `Downloading${pct}`;
    case 'completed': return 'Completed';
    case 'timed_out': return `Still downloading after ${DOWNLOAD_TIMEOUT_MS / 60_000} min${pct}`;
    case 'failed': return `Failed${r.downloadDetail ? `: ${r.downloadDetail}` : ''}`;
  }
}

export function appCheckText(a: NanoCheckReport['appCheck']): string {
  if (!a) return 'Checking';
  if (a.status === 'active') return 'Active (Play Integrity token received)';
  if (a.status === 'debug') return 'Debug token (development build)';
  if (a.status === 'not_configured' && !a.detail) return 'Set up; no token requested yet';
  return a.detail ? `${a.status}: ${a.detail}` : a.status;
}

const STEP_TEXT: Record<NanoCheckStep, string> = {
  status: 'Asking the phone about Gemini Nano',
  confirm: 'Waiting for your answer',
  download: 'Downloading Gemini Nano',
  warmup: 'Loading Gemini Nano',
  prompt: 'Asking Gemini Nano on this phone',
  app_check: 'Reading App Check',
  done: 'Done',
};

// ─── Screen ──────────────────────────────────────────────────────────────────────────────

function realDeps(confirmDownload: () => Promise<boolean>): NanoCheckDeps {
  // Looked up per call, so a composition-root failure shows up as the check's error instead of a crash.
  const ai = () => getServices().ai;
  return {
    device: deviceInfo(Platform),
    status: onDeviceStatus,
    confirmDownload,
    prepare: (onProgress) => ai().prepareOnDevice(onProgress),
    warmUp: () => ai().warmUpOnDevice(),
    run: (req, ctx) => ai().run(req, ctx),
    // Read, never started here: on-device work requests no App Check token (native-app-check.native.ts).
    appCheck: async () => appCheckStatus(),
    now: Date.now,
    // Release builds keep console.log: React Native writes it to logcat under the ReactNativeJS tag.
    log: (line) => console.log(line),
  };
}

// Expo inlines EXPO_PUBLIC_* only when each one is read literally.
const ALLOWED = nanoCheckAllowed(typeof __DEV__ !== 'undefined' && __DEV__, process.env.EXPO_PUBLIC_DIAGNOSTICS);

export default function NanoCheckRoute() {
  return ALLOWED ? <NanoCheck /> : (
    <Screen safeBottom testID="nano-check-unavailable">
      <View style={{ gap: 8, paddingVertical: 20 }}>
        <Text variant="h1">Gemini Nano self-check</Text>
        <Text variant="bodyLarge" tone="secondary">This check is only in development and diagnostics builds of Kalam.</Text>
      </View>
    </Screen>
  );
}

function NanoCheck() {
  const theme = useKalamTheme();
  const c = theme.colors;
  const [report, setReport] = useState<NanoCheckReport>();
  const [now, setNow] = useState(() => Date.now());
  // Set while the check waits for the person's answer about the download.
  const [answer, setAnswer] = useState<(yes: boolean) => void>();
  const started = useRef(false);
  const done = report?.step === 'done';

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ask = () => new Promise<boolean>((resolve) => setAnswer(() => resolve));
    void runNanoCheck(realDeps(ask), setReport);
  }, []);

  const reply = (yes: boolean) => {
    answer?.(yes);
    setAnswer(undefined);
  };

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done]);

  const p = report?.prompt;
  const onDevice = p?.success === true && p.source === 'on_device';
  const d = report?.device ?? deviceInfo(Platform);
  const deviceLine = [[d.brand, d.model].filter(Boolean).join(' ') || d.os, d.release && `Android ${d.release}`, d.apiLevel && `API ${d.apiLevel}`]
    .filter(Boolean).join(' · ');
  const model = nativeModelName(report?.statusAfter);
  const heroBg = !done ? c.surfaceAlt : onDevice ? c.successSoft : c.warningSoft;
  const heroFg = !done ? c.text : onDevice ? c.sourceOnDevice : c.warning;

  return (
    <Screen safeBottom testID="nano-check">
      <View style={{ gap: 18, paddingVertical: 20 }}>
        <View style={{ gap: 4 }}>
          <Text variant="h4" tone="muted">Kalam self-check</Text>
          <Text variant="h1">Gemini Nano on this phone</Text>
          <Text variant="bodyLarge" tone="secondary" accessibilityLabel="nano-check-device">{deviceLine}</Text>
        </View>

        <View accessibilityLabel="nano-check-source" style={{ backgroundColor: heroBg, borderRadius: theme.radius.xl, padding: 20, gap: 8 }}>
          <Text variant="h4" tone="secondary">Answer came from</Text>
          {done ? (
            <Text variant={onDevice ? 'hero' : 'display'} style={{ color: heroFg }}>{report ? sourceText(report) : 'No answer'}</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="large" color={c.primary} />
              <Text variant="h2" style={{ flexShrink: 1 }}>
                {report ? STEP_TEXT[report.step] : 'Starting'}
                {report?.step === 'download' && report.downloadProgress !== undefined ? ` ${Math.round(report.downloadProgress * 100)}%` : ''}
              </Text>
            </View>
          )}
          {done && p?.success ? (
            <Text variant="h3" tone="secondary" numeric>
              {`${onDevice ? `Gemini Nano${model ? ` (${model})` : ''}` : p.model ?? 'Unknown model'} · ${Math.round(p.latencyMs).toLocaleString('en')} ms`}
            </Text>
          ) : null}
          {!done && report ? (
            <Text variant="h3" tone="secondary" numeric>{`${Math.max(0, Math.round((now - report.stepStartedAt) / 1000))} s`}</Text>
          ) : null}
          {/* Near the top on purpose: Test Lab's Robo script waits for this label, and Robo only sees what is on screen. */}
          {done && report ? (
            <Text variant="h4" tone="secondary" numeric accessibilityLabel="nano-check-finished" testID="nano-check-finished">
              Check finished in {Math.round(((report.finishedAt ?? now) - report.startedAt) / 1000)} s
            </Text>
          ) : null}
        </View>

        {answer ? (
          <View accessibilityLabel="nano-check-download-question" style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.xl, padding: 20, gap: 12 }}>
            <Text variant="h3">Download Gemini Nano to this phone?</Text>
            <Text variant="bodyLarge" tone="secondary">
              Android AICore can download the model now. It takes a few GB of storage and data, so Wi-Fi is recommended. Nothing downloads unless you choose to.
            </Text>
            <Button label={DOWNLOAD_LABEL} onPress={() => reply(true)} testID="nano-check-download-yes" />
            <Button label="Not now" variant="ghost" onPress={() => reply(false)} testID="nano-check-download-no" />
          </View>
        ) : null}

        <View accessibilityLabel="nano-check-answer" style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: theme.radius.xl, padding: 20, gap: 6 }}>
          <Text variant="h4" tone="secondary">Note</Text>
          <Text variant="h3">“{NOTE}”</Text>
          <Text variant="h4" tone="secondary" style={{ marginTop: 10 }}>Category from Gemini Nano</Text>
          <Text variant="display">{p?.output?.category ?? (done ? '—' : '…')}</Text>
          <Text variant="bodyLarge" tone={p?.success ? 'success' : done ? 'warning' : 'muted'}>
            {!p ? 'Waiting for the answer'
              : p.success ? `Valid JSON, accepted by Kalam's schema${p.output?.category === EXPECTED_CATEGORY ? ', and correct' : ''}`
                : `${p.errorCode ?? 'error'}: ${p.errorMessage ?? ''}`}
          </Text>
        </View>

        <Row id="availability" label="Gemini Nano on this phone"
          value={report?.status ? AVAILABILITY_TEXT[report.status.availability] : 'Checking'}
          note={report?.status?.availability === 'available' ? undefined : report?.status?.detail} />
        <Row id="download" label="Model download" value={report ? downloadText(report) : 'Checking'} />
        {report?.statusAfter && report.download !== 'not_needed' && report.download !== 'declined'
          ? <Row id="availability-after" label="After the download" value={AVAILABILITY_TEXT[report.statusAfter.availability]} note={report.statusAfter.detail} />
          : null}
        <Row id="model" label="Model" value={model ?? p?.model ?? 'Not loaded'} />
        <Row id="cloud" label="Cloud AI requests" value="None (mode only_on_device)" />
        <Row id="app-check" label="Firebase App Check" value={appCheckText(report?.appCheck)} />
        {report?.error ? <Row id="error" label="Error" value={report.error} /> : null}
      </View>
    </Screen>
  );
}

function Row({ id, label, value, note }: { id: string; label: string; value: string; note?: string }) {
  return (
    <View accessibilityLabel={`nano-check-${id}`} testID={`nano-check-${id}`} style={{ gap: 2 }}>
      <Text variant="body" tone="secondary">{label}</Text>
      <Text variant="h3">{value}</Text>
      {note ? <Text variant="bodyLarge" tone="muted">{note}</Text> : null}
    </View>
  );
}
