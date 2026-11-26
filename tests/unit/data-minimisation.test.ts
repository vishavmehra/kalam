/**
 * Data minimisation (docs/17 §10.3, docs/11 §19.5, D17-042): "send only the information necessary for the
 * operation". This drives every code path that builds an AI request, records what it would send, and
 * checks three things:
 *   1. Shape: a request carries only the fields the contract allows, images only where a task needs them.
 *   2. Content: no record value, other form field, app id or key is in the system text, prompt, schema or images.
 *   3. Wire: whatever extra a request object carries, only the allowed fields reach the Firebase SDK and the
 *      specialist callable.
 * A last test lists the AI call sites in src/ and fails when a new one has no case here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAI, type FakeAI, type FakeAIOptions, type FakeReply } from '../fixtures/compiler/fake-ai';
import { loadFixture } from '../fixtures/specs/load';

import { createAppAssistant } from '@/core/assistant';
import { buildSafetyRequest } from '@/core/bazaar/publish';
import { tieBreakRequest } from '@/core/classifier/tie-break';
import { compileWithCloud } from '@/core/compiler/compile';
import { irToSpec } from '@/core/compiler/convert';
import { compilerIRSchema } from '@/core/compiler/ir';
import type {
  AIImage, InferenceMode, KalamRecord, NormalizedInput, RecordRepository, RecordValue, StructuredRequest, TaskClassification,
  TranslationCacheEntry, TranslationCacheRepository,
} from '@/core/contracts';
import { suggestFormula } from '@/core/formula-assist';
import { buildWorkflowRequest } from '@/core/media/workflow';
import { createApplicationPipeline } from '@/core/pipeline/create-application';
import { createReportService, suggestReports } from '@/core/reports';
import type { KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { createAIBlockService } from '@/core/tasks/ai-block-service';
import { createEditService } from '@/core/tasks/edit-service';
import { createTranscribeService } from '@/core/tasks/transcribe-service';
import { createTranslateService } from '@/core/tasks/translate-service';
import { createVoiceService } from '@/core/tasks/voice-service';
import { buildHandwritingRequest } from '@/features/drawing/handwriting-service';

// ─── Mocks for the wire tests (Firebase SDK and the callable) ─────────────────
const h = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
  getAI: vi.fn(),
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));
vi.mock('firebase/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/ai')>();
  return {
    ...actual,
    getAI: (...args: unknown[]) => { h.getAI(...args); return { fakeAi: true }; },
    getGenerativeModel: (...args: unknown[]) => { h.getGenerativeModel(...args); return { generateContent: h.generateContent }; },
  };
});
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({ app: {} }),
  connectFunctionsEmulator: () => undefined,
  httpsCallable: (...args: unknown[]) => { h.httpsCallable(...args); return h.callable; },
}));
vi.mock('@/infrastructure/firebase/app', () => ({
  getFirebaseApp: () => ({ name: '[DEFAULT]' }),
  isFirebaseConfigured: () => true,
  appCheckReady: async () => true,
}));
vi.mock('@/infrastructure/firebase/remote-config', () => ({ loadRemoteConfig: async () => undefined }));
vi.mock('@/infrastructure/firebase/on-device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/firebase/on-device')>()),
  getLanguageModel: () => undefined,
  onDeviceStatus: async () => ({ platform: 'web', apiExposed: false, availability: 'unavailable' }),
}));
const { createFirebaseProvider } = await import('@/infrastructure/firebase/firebase-provider');
const { createSpecialistProvider } = await import('@/infrastructure/specialist/specialist-provider');

// ─── The contract: what may leave ─────────────────────────────────────────────
type Req = StructuredRequest<unknown>;
/** StructuredRequest fields (core/contracts). `parse`, `signal` and `onUsage` are functions: they never serialise. */
const REQUEST_KEYS = new Set([
  'taskType', 'system', 'prompt', 'images', 'jsonSchema', 'parse', 'mode', 'temperature', 'maxOutputTokens', 'timeoutMs', 'role',
  'languages', 'signal', 'onUsage',
  // `maxRetries` is a local number map for the orchestrator's retry policy; `audio` is the one recording a person chose to transcribe.
  'maxRetries', 'audio',
]);
/** What a caller tells the orchestrator about the run. Used locally for routing and the activity log; the provider never sends it. */
const CONTEXT_KEYS = new Set(['taskType', 'complexity', 'appId', 'escalationReason', 'classification', 'sessionId']);
const AUDIO_TYPES = new Set(['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MODES = new Set<InferenceMode>(['only_on_device', 'prefer_on_device', 'only_in_cloud', 'prefer_in_cloud']);
/** Things that must never be in text bound for a model, whatever the task. */
const SECRET_SHAPES = /AIza[0-9A-Za-z_-]{30,}|\bsk-[A-Za-z0-9_-]{20,}|\bBearer\s+\S{10,}|-----BEGIN [A-Z ]*PRIVATE KEY/;

const wholeText = (r: Req) => [r.system ?? '', r.prompt, JSON.stringify(r.jsonSchema), ...(r.images ?? []).map((i) => i.base64), ...(r.audio ?? []).map((a) => a.base64)].join('\n');

interface Expect {
  /** Strings that must not appear anywhere in what is sent. */
  forbid: readonly string[];
  /** Strings that must appear (the request itself, so the test cannot pass on an empty prompt). */
  include?: readonly string[];
  /** Images allowed in a request, and which ones. Default none. */
  images?: readonly AIImage[];
  /** Recordings allowed in a request, and which ones. Default none: only the transcription call may carry one. */
  audio?: ReadonlyArray<{ base64: string }>;
  maxImages?: number;
  min?: number;
}

function assertOutgoing(calls: ReadonlyArray<{ req: Req; ctx: Record<string, unknown> }>, e: Expect): void {
  expect(calls.length, 'a request was built').toBeGreaterThanOrEqual(e.min ?? 1);
  for (const { req, ctx } of calls) {
    expect(Object.keys(req).filter((k) => !REQUEST_KEYS.has(k)), 'unexpected request fields').toEqual([]);
    expect(Object.keys(ctx).filter((k) => !CONTEXT_KEYS.has(k)), 'unexpected context fields').toEqual([]);
    expect(MODES.has(req.mode)).toBe(true);
    expect(typeof req.prompt).toBe('string');
    const images = req.images ?? [];
    expect(images.length).toBeLessThanOrEqual(e.maxImages ?? e.images?.length ?? 0);
    for (const img of images) {
      expect(Object.keys(img).sort()).toEqual(['base64', 'mimeType']);
      expect(IMAGE_TYPES.has(img.mimeType)).toBe(true);
      expect(e.images?.some((a) => a.base64 === img.base64), 'only an image the person chose').toBe(true);
    }
    const audio = req.audio ?? [];
    expect(audio.length).toBeLessThanOrEqual(e.audio?.length ?? 0);
    for (const a of audio) {
      expect(Object.keys(a).sort()).toEqual(['base64', 'mimeType']);
      expect(AUDIO_TYPES.has(a.mimeType)).toBe(true);
      expect(e.audio?.some((x) => x.base64 === a.base64), 'only a recording the person chose').toBe(true);
    }
    const text = wholeText(req);
    for (const s of e.forbid) expect(text, `forbidden text: ${s}`).not.toContain(s);
    for (const s of e.include ?? []) expect(text, `missing text: ${s}`).toContain(s);
    expect(text).not.toMatch(SECRET_SHAPES);
  }
}
const callsOf = (ai: FakeAI) => ai.calls.map((c) => ({ req: c.req, ctx: c.ctx as Record<string, unknown> }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const load = (name: string): KalamSpec => {
  const r = validateSpec(loadFixture('valid', name));
  if (!r.ok || !r.spec) throw new Error(`fixture ${name} is invalid`);
  return r.spec;
};
const expenses = load('expense-tracker');
const tailorIR = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const tailor = irToSpec(tailorIR, { appId: 'app_tailor01', now: 1 });
const NOW = new Date(Date.UTC(2026, 10, 25, 12));

const NOTE_A = 'SENTINEL-biryani-7731';
const NOTE_B = 'SENTINEL-taxi-4410';
const OTHER_FIELD = 'SENTINEL-other-field-7742';
const SECRET_TEXT = 'SENTINEL-secret-3319';
const RECORD_SENTINELS = [NOTE_A, NOTE_B, '7731', '4410'];
const rows: Array<Record<string, RecordValue>> = [
  { amount: 120.5, category: 'Food', date: '2026-11-18', note: NOTE_A },
  { amount: 80, category: 'Travel', date: '2026-11-18', note: NOTE_B },
  { amount: 300, category: 'Food', date: '2026-11-02', note: 'plain' },
];
const records: Pick<RecordRepository, 'list'> = {
  async list(appId, collectionId): Promise<KalamRecord[]> {
    return collectionId === 'expenses' ? rows.map((values, i) => ({ id: `r${i}`, appId, collectionId, createdAt: i, updatedAt: i, values })) : [];
  },
};
const PHOTO: AIImage = { mimeType: 'image/jpeg', base64: 'PHOTO_BASE64_ONE' };
const complex: TaskClassification = {
  taskType: 'create_app', complexity: 'complex', estimatedScreens: 3, estimatedCollections: 2, estimatedActions: 4,
  requiresMultimodalReasoning: false, requiresCloudReasoning: true, confidence: 0.8, method: 'deterministic', reasons: ['test'],
};
const failing = (extra: FakeAIOptions = {}) => createFakeAI({ onDevice: 'available', respond: () => ({ error: 'provider_error' as const }), ...extra });
const answering = (raw: unknown, extra: FakeAIOptions = {}) => createFakeAI({ onDevice: 'available', respond: () => ({ raw } as FakeReply), ...extra });

function memoryCache(): TranslationCacheRepository {
  const store = new Map<string, TranslationCacheEntry>();
  return {
    async get(appId, lang) { return store.get(`${appId}:${lang}`); },
    async put(entry) { store.set(`${entry.appId}:${entry.lang}`, entry); },
    async listForApp(appId) { return [...store.values()].filter((r) => r.appId === appId); },
    async removeForApp(appId) { for (const k of [...store.keys()]) if (k.startsWith(`${appId}:`)) store.delete(k); },
  };
}

// ─── Every code path that builds a request ────────────────────────────────────
/** Source files that call the orchestrator, and the case that covers each. The last describe keeps this list honest. */
const COVERED_CALL_SITES: Record<string, string> = {
  'src/core/assistant/assistant.ts': 'assistant',
  'src/core/formula-assist/suggest.ts': 'formula helper',
  'src/core/reports/explain.ts': 'report explanation',
  'src/core/tasks/voice-service.ts': 'voice command',
  'src/core/tasks/edit-service.ts': 'edit by words',
  'src/core/tasks/translate-service.ts': 'translation',
  'src/core/tasks/transcribe-service.ts': 'transcription',
  'src/core/tasks/ai-block-service.ts': 'AI step',
  'src/features/drawing/handwriting-service.ts': 'handwriting',
  'src/core/media/workflow.ts': 'video steps',
  'src/infrastructure/bazaar/bazaar-service.ts': 'Bazaar safety check',
  'src/core/compiler/compile.ts': 'compiler',
  'src/core/classifier/tie-break.ts': 'complexity tie-break',
  'src/core/pipeline/create-application.ts': 'compiler',
  // The orchestrator hands the request to a provider; the provider tests below cover what the providers send.
  'src/core/ai/orchestrator.ts': 'wire',
};

describe('requests built by every code path carry only what the task needs', () => {
  it('assistant: the question and the names in the app, never a record', async () => {
    const ai = answering({ answerable: false, formula: '' });
    await createAppAssistant({ ai, records, now: () => NOW }).ask(expenses, 'What did I spend on fuel?');
    assertOutgoing(callsOf(ai), { forbid: [...RECORD_SENTINELS, '120.5', expenses.id], include: ['fuel'] });
  });

  it('formula helper: the request and the names in the app, never a record', async () => {
    const ai = answering({ answerable: false, formula: '' });
    await suggestFormula(expenses, 'work out something', { ai, records, now: NOW });
    assertOutgoing(callsOf(ai), { forbid: [...RECORD_SENTINELS, '120.5', expenses.id], include: ['work out something'] });
  });

  it('report explanation: the computed totals, never a row', async () => {
    const ai = answering({ explanation: 'It went up.' });
    const service = createReportService({ ai, records, now: () => NOW, timeZone: 'UTC' });
    for (const def of suggestReports(expenses)) {
      const out = await service.run(expenses, def);
      if (!out.ok) throw new Error(out.errors.join('; '));
      await service.explain(out.result);
    }
    assertOutgoing(callsOf(ai), { forbid: [...RECORD_SENTINELS, '120.5', expenses.id] });
  });

  it('voice command: the words said and this app\'s action and field names', async () => {
    const ai = failing();
    await createVoiceService({ ai }).interpret(tailor, 'new_order', 'blue elephant xylophone');
    assertOutgoing(callsOf(ai), { forbid: [tailor.id], include: ['blue elephant xylophone'] });
  });

  it('transcription: the one recording the person chose and a fixed instruction, never an app or an entry', async () => {
    const ai = failing();
    const recording = { mimeType: 'audio/wav' as const, base64: 'UklGRg==' };
    await createTranscribeService({ ai }).transcribe(recording, { language: 'hi', sessionId: 'create_abc12345' });
    assertOutgoing(callsOf(ai), { forbid: [...RECORD_SENTINELS, tailor.id, expenses.id], audio: [recording], include: ['Transcribe this recording'] });
    expect(callsOf(ai)[0]!.req.mode).toBe('only_in_cloud');
    expect(callsOf(ai)[0]!.req.images).toBeUndefined();
  });

  it('edit by words: the instruction and the design, on device first and then one cloud call', async () => {
    const ai = failing();
    const svc = createEditService({
      ai,
      classifyEdit: () => ({ editClass: 'small', reasons: [] }),
      parseSmallEdit: () => ({ ops: [], confidence: 0.2, unmatched: ['make it feel softer'] }),
    });
    await svc.applyInstruction(tailor, 'make it feel softer');
    // The edit needs the app's own design, so the design is sent, with its id inside it. No record can be: the service is never given any.
    assertOutgoing(callsOf(ai), { forbid: [], include: ['make it feel softer', tailor.name], min: 2 });
    expect(ai.calls.filter((c) => c.req.mode === 'only_in_cloud')).toHaveLength(1);
  });

  it('translation: the labels of the app, in order to translate them, and nothing the app stores', async () => {
    const ai = failing();
    await createTranslateService({ ai, cache: memoryCache() }).translateApp(expenses, 'hi');
    assertOutgoing(callsOf(ai), { forbid: [...RECORD_SENTINELS, expenses.id], include: [expenses.name] });
  });

  it('AI step: the one field it reads, not the other fields of the form', async () => {
    const aiSpec: KalamSpec = {
      ...tailor,
      aiBlocks: { note_kind: { kind: 'classify', prompt: 'Is this note urgent or normal?', verified: 'unverified', labels: ['Urgent', 'Normal'], inputField: 'notes', outputField: 'notes' } },
    };
    const ai = failing();
    await createAIBlockService({ ai }).run({
      appId: aiSpec.id, blockId: 'note_kind', block: aiSpec.aiBlocks.note_kind, spec: aiSpec,
      formValues: { notes: 'pay the cloth shop today', customer: OTHER_FIELD, phone: SECRET_TEXT },
    });
    assertOutgoing(callsOf(ai), { forbid: [OTHER_FIELD, SECRET_TEXT, aiSpec.id], include: ['pay the cloth shop today'] });
  });

  it('handwriting: the one picture of the strokes', () => {
    const req = buildHandwritingRequest(PHOTO, 'prefer_on_device', ['en']);
    assertOutgoing([{ req: req as Req, ctx: { taskType: 'extract_data', complexity: 'simple' } }], { forbid: [], images: [PHOTO] });
  });

  it('video steps: at most six frames, the note and the speech, only to the cloud', () => {
    const frames = Array.from({ length: 9 }, (_, i) => ({ image: { mimeType: 'image/jpeg' as const, base64: `FRAME_${i}` }, timestampMs: i * 1000, frameId: `f${i}` }));
    const req = buildWorkflowRequest(frames, { durationMs: 9000, transcript: 'first open the register', note: 'my shop routine' });
    expect(req.mode).toBe('only_in_cloud');
    expect(req.images).toHaveLength(6);
    assertOutgoing([{ req: req as Req, ctx: { taskType: 'interpret_sketch' } }], {
      forbid: ['FRAME_6', 'FRAME_7', 'FRAME_8', 'f0'], images: frames.map((f) => f.image), maxImages: 6, include: ['first open the register', 'my shop routine'],
    });
  });

  it('Bazaar safety check: the listing and the app\'s own text, no entries, no id', () => {
    const req = buildSafetyRequest(tailor, { title: 'Tailor book', description: 'Orders for a tailor', tags: ['tailor'] });
    expect(req.images).toBeUndefined();
    assertOutgoing([{ req: req as Req, ctx: { taskType: 'safety_review', complexity: 'simple' } }], { forbid: [tailor.id, ...RECORD_SENTINELS], include: ['Tailor book'] });
  });

  it('compiler: what the person wrote and the pictures they added, nothing else', async () => {
    const ai = failing();
    const input: NormalizedInput = {
      text: 'a book for my tailor shop', modalities: ['text', 'image'],
      images: [{ id: 'img1', mimeType: 'image/jpeg', base64: PHOTO.base64, width: 100, height: 100, source: 'photo' }],
    };
    await compileWithCloud(input, complex, { ai, appId: 'app_secret_id_01' });
    assertOutgoing(callsOf(ai), { forbid: ['app_secret_id_01'], include: ['a book for my tailor shop'], images: [PHOTO], maxImages: 6 });
  });

  it('complexity tie-break: the request text, on this device only', () => {
    const req = tieBreakRequest('a book for my tailor shop', 'medium', 'complex');
    expect(req.mode).toBe('only_on_device');
    assertOutgoing([{ req: req as Req, ctx: { taskType: 'classify', complexity: 'medium' } }], { forbid: [], include: ['a book for my tailor shop'] });
  });

  it('the whole creation pipeline: the same, through the orchestrator', async () => {
    const ai = failing();
    await createApplicationPipeline({ ai, classify: () => complex })({ text: 'a book for my tailor shop', modalities: ['text'], images: [] });
    assertOutgoing(callsOf(ai), { forbid: [], include: ['a book for my tailor shop'] });
  });
});

describe('the check itself catches a leak', () => {
  const ctx = { taskType: 'classify' };
  const ok = (over: object = {}): { req: Req; ctx: Record<string, unknown> } => ({ req: { ...baseRequest(), ...over } as Req, ctx });

  it('fails on a record value in the prompt, in the schema or in the system text', () => {
    for (const where of ['prompt', 'system']) expect(() => assertOutgoing([ok({ [where]: `x ${NOTE_A}` })], { forbid: [NOTE_A] })).toThrow();
    expect(() => assertOutgoing([ok({ jsonSchema: { enum: [NOTE_A] } })], { forbid: [NOTE_A] })).toThrow();
  });

  it('fails on an extra request field, an extra context field, an unchosen image and a key', () => {
    expect(() => assertOutgoing([ok({ records: [] })], { forbid: [] })).toThrow();
    expect(() => assertOutgoing([{ req: ok().req, ctx: { taskType: 'classify', userEmail: 'a@b.c' } }], { forbid: [] })).toThrow();
    expect(() => assertOutgoing([ok({ images: [PHOTO] })], { forbid: [] })).toThrow();
    expect(() => assertOutgoing([ok({ prompt: 'key AIza' + 'x'.repeat(35) })], { forbid: [] })).toThrow();
    expect(() => assertOutgoing([ok()], { forbid: [] })).not.toThrow();
  });
});

// ─── What the providers put on the wire ───────────────────────────────────────
/** Every key of every object at every depth, as "a.b.c" paths (arrays share one path). */
function paths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => paths(v, prefix));
  if (value && typeof value === 'object' && !(value instanceof AbortSignal)) {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}${k}`, ...paths(v, `${prefix}${k}.`)]);
  }
  return [];
}
const dirty = (r: StructuredRequest<unknown>): StructuredRequest<unknown> => ({
  ...r,
  // Things a caller could attach by mistake. None may reach a provider.
  ...({ records: [{ note: NOTE_A }], appId: 'app_secret_id_01', userId: SECRET_TEXT, formValues: { phone: OTHER_FIELD } } as object),
});
const baseRequest = (over: Partial<Req> = {}): Req => ({
  taskType: 'create_app', system: 'You build apps.', prompt: 'A notes app', jsonSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  mode: 'only_in_cloud', parse: (raw) => ({ success: true, data: raw }), temperature: 0.2, maxOutputTokens: 4096, role: 'compiler', ...over,
});

describe('Firebase AI Logic provider: only the allowed fields reach the SDK', () => {
  beforeEach(() => {
    for (const m of [h.generateContent, h.getGenerativeModel, h.getAI, h.callable, h.httpsCallable]) m.mockReset();
  });

  it('sends the prompt, the system text, the images and the settings, and nothing that was attached to the request', async () => {
    h.generateContent.mockResolvedValue({ response: { inferenceSource: 'in_cloud', text: () => '{"a":"x"}' } });
    const res = await createFirebaseProvider().generateStructured(dirty(baseRequest({ images: [PHOTO], languages: ['en', 'hi'] })));
    expect(res.success).toBe(true);

    const [, params] = h.getGenerativeModel.mock.calls[0] as [unknown, Record<string, unknown>];
    const [parts, options] = h.generateContent.mock.calls[0] as [unknown[], Record<string, unknown>];
    expect(h.getAI).toHaveBeenCalledTimes(1);
    expect(Object.keys((h.getAI.mock.calls[0] as unknown[])[1] as object)).toEqual(['backend']);

    const allowed = new Set([
      'mode', 'inCloudParams', 'inCloudParams.model', 'inCloudParams.systemInstruction', 'inCloudParams.generationConfig',
      'inCloudParams.generationConfig.responseMimeType', 'inCloudParams.generationConfig.responseJsonSchema',
      'inCloudParams.generationConfig.maxOutputTokens', 'inCloudParams.generationConfig.temperature', 'inCloudParams.generationConfig.thinkingConfig',
      'inCloudParams.generationConfig.thinkingConfig.thinkingLevel',
      'onDeviceParams', 'onDeviceParams.createOptions', 'onDeviceParams.promptOptions',
      'onDeviceParams.createOptions.expectedInputs', 'onDeviceParams.createOptions.expectedInputs.type', 'onDeviceParams.createOptions.expectedInputs.languages',
      'onDeviceParams.createOptions.expectedOutputs', 'onDeviceParams.createOptions.expectedOutputs.type', 'onDeviceParams.createOptions.expectedOutputs.languages',
      'onDeviceParams.createOptions.initialPrompts', 'onDeviceParams.createOptions.initialPrompts.role', 'onDeviceParams.createOptions.initialPrompts.content',
      'onDeviceParams.createOptions.initialPrompts.content.type', 'onDeviceParams.createOptions.initialPrompts.content.value',
      'onDeviceParams.createOptions.signal', 'onDeviceParams.promptOptions.responseConstraint', 'onDeviceParams.promptOptions.signal',
    ]);
    // responseJsonSchema and responseConstraint are the output shape: their inner keys are JSON Schema words.
    const unexpected = paths(params).filter((p) => !allowed.has(p) && !/\.(responseJsonSchema|responseConstraint)\./.test(`.${p}`));
    expect(unexpected).toEqual([]);

    const partKeys = new Set(['type', 'text', 'inlineData', 'inlineData.mimeType', 'inlineData.data']);
    expect(paths(parts).filter((p) => !partKeys.has(p))).toEqual([]);
    expect(parts).toEqual([
      { type: 'text', text: 'A notes app' },
      { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: PHOTO.base64 } },
    ]);
    expect(Object.keys(options).sort()).toEqual(['signal', 'timeout']);

    const sent = JSON.stringify([params, parts]);
    for (const s of [NOTE_A, 'app_secret_id_01', SECRET_TEXT, OTHER_FIELD]) expect(sent).not.toContain(s);
  });

  it('sends nothing at all when the request is on-device only and the device cannot answer', async () => {
    const res = await createFirebaseProvider().generateStructured(baseRequest({ mode: 'only_on_device' }));
    expect(res).toMatchObject({ success: false, errorCode: 'model_unavailable' });
    expect(h.getGenerativeModel).not.toHaveBeenCalled();
    expect(h.generateContent).not.toHaveBeenCalled();
  });
});

describe('specialist provider (Claude, Nebius through the server): only the allowed fields reach the callable', () => {
  beforeEach(() => {
    for (const m of [h.callable, h.httpsCallable]) m.mockReset();
    process.env.EXPO_PUBLIC_SPECIALIST_ENABLED = 'true';
    h.callable.mockResolvedValue({ data: { output: { a: 'x' }, provider: 'claude', model: 'claude-test', latencyMs: 5 } });
  });

  it('sends the task, the prompt and a token cap; the server pins instructions and schema', async () => {
    await createSpecialistProvider().generateStructured(dirty(baseRequest({ taskType: 'plan_app', maxOutputTokens: 9000 })));
    const [payload] = h.callable.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(payload).sort()).toEqual(['maxOutputTokens', 'prompt', 'task']);
    expect(payload).toEqual({ task: 'plan_app', prompt: 'A notes app', maxOutputTokens: 9000 });
    expect(JSON.stringify(payload)).not.toMatch(/SENTINEL|app_secret_id_01|You build apps/);
  });

  it('adds pictures only for a sketch, at most four, as type and data only', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ mimeType: 'image/png' as const, base64: `IMG_${i}`, extra: SECRET_TEXT }));
    await createSpecialistProvider().generateStructured(dirty(baseRequest({ taskType: 'interpret_sketch', images: many as AIImage[] })));
    const [sketch] = h.callable.mock.calls[0] as [{ images: Array<Record<string, unknown>> }];
    expect(sketch.images).toHaveLength(4);
    expect(sketch.images.every((i) => Object.keys(i).sort().join() === 'base64,mimeType')).toBe(true);
    expect(JSON.stringify(sketch)).not.toContain(SECRET_TEXT);

    h.callable.mockClear();
    await createSpecialistProvider().generateStructured(baseRequest({ taskType: 'repair_spec', images: [PHOTO] }));
    expect(h.callable.mock.calls[0]![0]).not.toHaveProperty('images');
  });

  it('refuses tasks that are not specialist tasks, so user content for them never goes there', async () => {
    for (const taskType of ['classify', 'summarize', 'translate', 'voice_action', 'extract_data'] as const) {
      const res = await createSpecialistProvider().generateStructured(baseRequest({ taskType }));
      expect(res.success).toBe(false);
    }
    expect(h.callable).not.toHaveBeenCalled();
  });
});

// ─── Nothing new slips past ───────────────────────────────────────────────────
describe('every AI call site in src/ has a case above', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });

  it('finds the same files that call the orchestrator or a provider', () => {
    const found = walk(join(root, 'src'))
      .filter((f) => /\b(?:ai|orchestrator)\.run\s*[<(]|\.generateStructured\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split('\\').join('/'))
      .sort();
    expect(found).toEqual(Object.keys(COVERED_CALL_SITES).sort());
  });
});
