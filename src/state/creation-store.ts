/**
 * The creation session (docs/03 §6.2, docs/06 §3, §15). Survives navigation between the workspace,
 * Drawing Studio and Review, and a reload.
 *
 * Privacy (docs/11 §6.4, §7; lead decision 3): the draft lives in the local database, never in
 * AsyncStorage. Text, transcript and picture details go to `sessions`; photos, video frames and page
 * images go to `blobs` (local-only, never uploaded by storage). The session and its files are deleted
 * when the app is saved or the person starts over, and untouched drafts expire after 7 days. Raw audio
 * is never stored here. Only non-personal choices (theme, currency, language, last input) use AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type { CreationResult, CreationSession, CreationStage, NormalizedImage, StoredBlob } from '@/core/contracts';
import { THEME_PRESETS } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { advanceSteps, type ProgressStep } from '@/features/create/stages';
import {
  MAX_PHOTOS, MAX_TEXT_CHARS, type CreationDraft, type CreationPreferences, type DrawingAttachment, type VideoAttachment,
  type VoiceAttachment,
} from '@/features/input/normalize';
import { getDatabase } from '@/infrastructure/storage/database';

export type Modality = 'text' | 'photo' | 'voice' | 'video' | 'draw';

export interface CreationRun {
  status: 'idle' | 'running' | 'failed' | 'succeeded' | 'cancelled';
  steps: ProgressStep[];
  stage?: CreationStage;
  stageDetail?: string;
  startedAt?: number;
}

interface CreationState extends CreationDraft {
  modality: Modality;
  /** Drawing document currently linked to this session (edited in Drawing Studio). */
  drawingId?: string;
  run: CreationRun;
  result?: CreationResult;
  /** Draft snapshot the last result was produced from (docs/03 §6.5 step 2). */
  resultDraft?: CreationDraft;

  setText(text: string): void;
  setModality(m: Modality): void;
  addPhotos(images: NormalizedImage[]): void;
  removePhoto(id: string): void;
  setVoice(v: VoiceAttachment | undefined): void;
  setVideo(v: VideoAttachment | undefined): void;
  attachDrawing(att: DrawingAttachment): void;
  detachDrawing(): void;
  setDrawingId(id: string | undefined): void;
  setPreferences(p: Partial<CreationPreferences>): void;

  startRun(): void;
  onStage(stage: CreationStage, detail?: string): void;
  finishRun(result: CreationResult, draft: CreationDraft): void;
  cancelRun(): void;
  clearResult(): void;
  /**
   * After saving an app, or to start over: a fresh session that keeps the preferences. The stored draft
   * and its files are deleted. `keepInputsWith: appId` keeps the photos and pages on this device with
   * that app instead (ADR-005, only when the person asked for it).
   */
  resetSession(opts?: { keepInputsWith?: string }): void;
}

const IDLE: CreationRun = { status: 'idle', steps: [] };

// ─── Draft persistence (local database) ───────────────────────────────────────
const PREFS_KEY = 'kalam.creation-prefs';
/** Wave-1 AsyncStorage entry that held the text and transcript. Migrated once, then deleted. */
const LEGACY_KEY = 'kalam.creation-session';
const WRITE_DELAY_MS = 300;

type Persisted = Pick<CreationState, 'text' | 'photos' | 'voice' | 'video' | 'drawing' | 'drawingId' | 'preferences' | 'modality' | 'run' | 'result'>;
type Restored = Partial<Pick<CreationState, 'text' | 'photos' | 'voice' | 'video' | 'drawing' | 'drawingId' | 'preferences' | 'modality' | 'run' | 'result' | 'resultDraft'>>;
type Role = 'photo' | 'frame' | 'drawing';

const MODALITIES = ['text', 'photo', 'voice', 'video', 'draw'] as const;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const BLOB_KIND: Record<Role, StoredBlob['kind']> = { photo: 'image', frame: 'video_frame', drawing: 'drawing_png' };

const prefsSchema = z.object({
  preferences: z
    .object({ themePreset: z.enum(THEME_PRESETS).optional(), language: z.string().max(16), currency: z.string().max(8).optional() })
    .optional()
    .catch(undefined),
  modality: z.enum(MODALITIES).optional().catch(undefined),
});
const draftSchema = z.object({
  images: z
    .array(z.object({
      blobId: z.string().max(200),
      id: z.string().max(200),
      width: z.number().int().min(1).max(20_000),
      height: z.number().int().min(1).max(20_000),
      source: z.enum(['photo', 'drawing', 'video_frame', 'screenshot']),
      label: z.string().max(300).optional(),
      role: z.enum(['photo', 'frame', 'drawing']),
    }))
    .max(64)
    .catch([]),
  voice: z.object({ recognizedBy: z.enum(['on_device', 'cloud_service', 'typed']), durationSec: z.number().nonnegative().optional() }).optional().catch(undefined),
  video: z.object({ name: z.string().max(300).optional(), durationSec: z.number().nonnegative(), droppedFrames: z.number().int().nonnegative() }).optional().catch(undefined),
  drawing: z
    .object({
      title: z.string().max(300),
      summary: z.object({
        drawingId: z.string().max(200),
        pageCount: z.number().int().nonnegative(),
        elements: z.array(z.object({
          kind: z.string().max(60), label: z.string().max(500).optional(), page: z.number().int(),
          bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        })).max(10_000),
        texts: z.array(z.string().max(2_000)).max(5_000),
      }),
    })
    .optional()
    .catch(undefined),
  result: z.unknown().optional(),
});

/** The session being written: its id, when it started, and which files are already stored. */
const current = { id: undefined as string | undefined, createdAt: 0, files: new Set<string>() };
let pending: Persisted | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();
let lastPrefs = '';

function newSessionId(): string {
  const bytes = new Uint8Array(8);
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `s_${Date.now().toString(36)}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const fileId = (sessionId: string, image: NormalizedImage) => `${sessionId}.${image.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`;

function isEmpty(s: Persisted): boolean {
  return !s.text.trim() && !s.photos.length && !s.voice?.transcript.trim() && !s.video?.frames.length && !s.drawing && !s.drawingId;
}

function sessionState(s: Persisted): CreationSession['state'] {
  if (s.run.status === 'running') return 'compiling';
  if (s.run.status === 'succeeded') return s.result?.ok ? 'review' : 'failed';
  return s.run.status === 'failed' ? 'failed' : 'draft';
}

async function writeDraft(s: Persisted): Promise<void> {
  const prefs = JSON.stringify({ preferences: s.preferences, modality: s.modality });
  if (prefs !== lastPrefs) {
    await AsyncStorage.setItem(PREFS_KEY, prefs);
    lastPrefs = prefs;
  }
  const db = getDatabase();
  if (isEmpty(s)) {
    if (current.id) await db.sessions.remove(current.id);
    current.id = undefined;
    current.files.clear();
    return;
  }
  const id = (current.id ??= newSessionId());
  current.createdAt ||= Date.now();
  const images: Array<{ image: NormalizedImage; role: Role }> = [
    ...s.photos.map((image) => ({ image, role: 'photo' as const })),
    ...(s.video?.frames ?? []).map((image) => ({ image, role: 'frame' as const })),
    ...(s.drawing?.summary.images ?? []).map((image) => ({ image, role: 'drawing' as const })),
  ];
  const stored: z.infer<typeof draftSchema>['images'] = [];
  for (const { image, role } of images) {
    const blobId = fileId(id, image);
    if (!current.files.has(blobId)) {
      try {
        await db.blobs.put({ id: blobId, kind: BLOB_KIND[role], mimeType: image.mimeType, base64: image.base64, ownerId: id });
        current.files.add(blobId);
      } catch {
        continue; // kept in memory only: an unusual file must not block saving the rest of the draft
      }
    }
    stored.push({ blobId, id: image.id, width: image.width, height: image.height, source: image.source, role, ...(image.label ? { label: image.label } : {}) });
  }
  for (const blobId of [...current.files]) {
    if (stored.some((m) => m.blobId === blobId)) continue;
    await db.blobs.remove(blobId);
    current.files.delete(blobId);
  }
  const { themePreset, currency } = s.preferences;
  const { images: _pages, ...drawingSummary } = s.drawing?.summary ?? { images: [] };
  const row: CreationSession & { draft: Record<string, unknown> } = {
    id,
    state: sessionState(s),
    createdAt: current.createdAt,
    updatedAt: Date.now(),
    text: s.text.slice(0, MAX_TEXT_CHARS * 2),
    attachmentIds: stored.map((m) => m.blobId),
    ...(s.drawingId ? { drawingId: s.drawingId } : {}),
    ...(s.voice?.transcript.trim() ? { audioTranscript: s.voice.transcript } : {}),
    ...(themePreset || currency ? { preferences: { ...(themePreset ? { themePreset } : {}), ...(currency ? { currency } : {}) } } : {}),
    ...(s.run.status === 'failed' && s.result?.message ? { lastError: s.result.message.slice(0, 500) } : {}),
    draft: {
      images: stored,
      ...(s.voice ? { voice: { recognizedBy: s.voice.recognizedBy, ...(s.voice.durationSec !== undefined ? { durationSec: s.voice.durationSec } : {}) } } : {}),
      ...(s.video ? { video: { ...(s.video.name ? { name: s.video.name } : {}), durationSec: s.video.durationSec, droppedFrames: s.video.droppedFrames } } : {}),
      ...(s.drawing ? { drawing: { title: s.drawing.title, summary: drawingSummary } } : {}),
      // The built app (not yet saved) is kept so a reload on Review does not cost another cloud call.
      ...(s.run.status === 'succeeded' && s.result?.ok ? { result: s.result } : {}),
    },
  };
  await db.sessions.save(row);
}

function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch((error: unknown) => console.warn('[kalam/creation] draft not saved', error));
  return chain;
}

/** Writes the latest pending draft now instead of after the short delay. */
export function flushCreationDraft(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const s = pending;
  pending = undefined;
  return s ? enqueue(() => writeDraft(s)) : chain;
}

/** Moves this session's photos and pages to `appId`, so they stay (locally) with the saved app. */
function adoptFiles(appId: string): Promise<void> {
  return enqueue(async () => {
    const db = getDatabase();
    for (const blobId of current.files) {
      const blob = await db.blobs.get(blobId);
      if (blob) await db.blobs.put({ id: blob.id, kind: blob.kind, mimeType: blob.mimeType, base64: blob.base64, ownerId: appId });
    }
    current.files.clear();
  });
}

async function restoreSession(): Promise<Restored | undefined> {
  const db = getDatabase();
  const session = (await db.sessions.latest()) as (CreationSession & { draft?: unknown }) | undefined;
  if (!session || session.state === 'saved') return undefined;
  const draft = draftSchema.safeParse(session.draft ?? {});
  const extras = draft.success ? draft.data : draftSchema.parse({});
  const byRole: Record<Role, NormalizedImage[]> = { photo: [], frame: [], drawing: [] };
  const files = new Set<string>();
  for (const meta of extras.images) {
    const blob = await db.blobs.get(meta.blobId);
    const mimeType = IMAGE_TYPES.find((t) => t === blob?.mimeType);
    if (!blob || !mimeType) continue;
    files.add(meta.blobId);
    byRole[meta.role].push({
      id: meta.id, mimeType, base64: blob.base64, width: meta.width, height: meta.height, source: meta.source,
      ...(meta.label ? { label: meta.label } : {}),
    });
  }
  current.id = session.id;
  current.createdAt = session.createdAt;
  current.files = files;

  const restored: Restored = {
    text: session.text,
    photos: byRole.photo.slice(0, MAX_PHOTOS),
    ...(session.drawingId ? { drawingId: session.drawingId } : {}),
  };
  if (session.audioTranscript) {
    restored.voice = {
      transcript: session.audioTranscript,
      recognizedBy: extras.voice?.recognizedBy ?? 'typed',
      ...(extras.voice?.durationSec !== undefined ? { durationSec: extras.voice.durationSec } : {}),
    };
  }
  if (extras.video && byRole.frame.length) {
    restored.video = { ...(extras.video.name ? { name: extras.video.name } : {}), durationSec: extras.video.durationSec, frames: byRole.frame, droppedFrames: extras.video.droppedFrames };
  }
  if (extras.drawing) restored.drawing = { title: extras.drawing.title, summary: { ...extras.drawing.summary, images: byRole.drawing } };
  const result = extras.result as CreationResult | undefined;
  if (session.state === 'review' && result?.ok === true && validateSpec(result.spec).ok) {
    restored.result = result;
    restored.run = { status: 'succeeded', steps: [] };
  }
  return restored;
}

/** Wave-1 kept the text and transcript in AsyncStorage. Move them into a local session, then delete them. */
async function migrateLegacy(raw: string): Promise<Restored | undefined> {
  let legacy: { state?: { text?: unknown; preferences?: unknown; modality?: unknown; drawingId?: unknown; voice?: { transcript?: unknown; recognizedBy?: unknown } } };
  try {
    legacy = JSON.parse(raw) as typeof legacy;
  } catch {
    return undefined;
  }
  const st = legacy.state ?? {};
  const prefs = prefsSchema.parse({ preferences: st.preferences, modality: st.modality });
  const transcript = typeof st.voice?.transcript === 'string' ? st.voice.transcript.slice(0, MAX_TEXT_CHARS * 2) : '';
  const restored: Restored = {
    text: typeof st.text === 'string' ? st.text.slice(0, MAX_TEXT_CHARS * 2) : '',
    ...(prefs.preferences ? { preferences: prefs.preferences } : {}),
    ...(prefs.modality ? { modality: prefs.modality } : {}),
    ...(typeof st.drawingId === 'string' && st.drawingId.length <= 200 ? { drawingId: st.drawingId } : {}),
    ...(transcript ? { voice: { transcript, recognizedBy: st.voice?.recognizedBy === 'on_device' || st.voice?.recognizedBy === 'cloud_service' ? st.voice.recognizedBy : 'typed' } } : {}),
  };
  await writeDraft({ text: '', photos: [], preferences: { language: 'en' }, modality: 'text', run: IDLE, ...restored } as Persisted);
  return restored;
}

const draftStorage: PersistStorage<Persisted> = {
  async getItem(): Promise<StorageValue<Persisted> | null> {
    try {
      const prefsRaw = await AsyncStorage.getItem(PREFS_KEY);
      lastPrefs = prefsRaw ?? '';
      const prefs = prefsSchema.safeParse(prefsRaw ? JSON.parse(prefsRaw) : {});
      let restored = await restoreSession();
      const legacy = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        if (!restored) restored = await migrateLegacy(legacy);
        await AsyncStorage.removeItem(LEGACY_KEY);
      }
      const state: Restored = {
        ...(prefs.success && prefs.data.preferences ? { preferences: prefs.data.preferences } : {}),
        ...(prefs.success && prefs.data.modality ? { modality: prefs.data.modality } : {}),
        ...restored,
      };
      if (state.result) state.resultDraft = draftOf({ text: '', photos: [], preferences: { language: 'en' }, ...state });
      // Hydration merges this partial state over the defaults (see `merge` below).
      return { state: state as Persisted, version: 2 };
    } catch (error) {
      console.warn('[kalam/creation] draft could not be restored', error);
      return null;
    }
  },
  setItem(_name, value) {
    // Writes before hydration finishes carry the empty start state and would wipe the stored draft.
    if (!useCreationStore.persist.hasHydrated()) return;
    pending = value.state;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushCreationDraft(), WRITE_DELAY_MS);
  },
  removeItem() {
    pending = undefined;
    void enqueue(async () => {
      await AsyncStorage.removeItem(PREFS_KEY);
      if (current.id) await getDatabase().sessions.remove(current.id);
      current.id = undefined;
      current.files.clear();
    });
  },
};

export const useCreationStore = create<CreationState>()(
  persist(
    (set) => ({
      text: '',
      photos: [],
      preferences: { language: 'en' },
      modality: 'text',
      run: IDLE,

      setText: (text) => set({ text }),
      setModality: (modality) => set({ modality }),
      addPhotos: (images) => set((s) => ({ photos: [...s.photos, ...images].slice(0, MAX_PHOTOS) })),
      removePhoto: (id) => set((s) => ({ photos: s.photos.filter((p) => p.id !== id) })),
      setVoice: (voice) => set({ voice }),
      setVideo: (video) => set({ video }),
      attachDrawing: (drawing) => set({ drawing, drawingId: drawing.summary.drawingId }),
      detachDrawing: () => set({ drawing: undefined }),
      setDrawingId: (drawingId) => set({ drawingId }),
      setPreferences: (p) => set((s) => ({ preferences: { ...s.preferences, ...p } })),

      startRun: () => set({ run: { status: 'running', steps: [], startedAt: Date.now() }, result: undefined }),
      onStage: (stage, detail) => set((s) => (s.run.status !== 'running' ? s : {
        run: { ...s.run, stage, stageDetail: detail, steps: advanceSteps(s.run.steps, stage, detail) },
      })),
      finishRun: (result, draft) => set((s) => ({
        run: { ...s.run, status: result.ok ? 'succeeded' : 'failed', steps: advanceSteps(s.run.steps, result.ok ? 'done' : 'failed') },
        result,
        resultDraft: draft,
      })),
      cancelRun: () => set((s) => ({ run: { ...s.run, status: 'cancelled' } })),
      clearResult: () => set({ result: undefined, resultDraft: undefined, run: IDLE }),
      resetSession: (opts) => {
        if (opts?.keepInputsWith) void adoptFiles(opts.keepInputsWith);
        set((s) => ({
          text: '', photos: [], voice: undefined, video: undefined, drawing: undefined, drawingId: undefined,
          modality: 'text', run: IDLE, result: undefined, resultDraft: undefined, preferences: s.preferences,
        }));
        // Delete the stored draft now, not after the write delay: a quick reload must not bring it back.
        void flushCreationDraft();
      },
    }),
    {
      name: 'kalam.creation-session',
      version: 2,
      storage: draftStorage,
      partialize: (s): Persisted => ({
        text: s.text, photos: s.photos, voice: s.voice, video: s.video, drawing: s.drawing, drawingId: s.drawingId,
        preferences: s.preferences, modality: s.modality, run: s.run, result: s.result,
      }),
      // Only restored fields are applied; a run in progress never resumes after a reload.
      merge: (persisted, currentState) => {
        const restored = (persisted ?? {}) as Restored;
        return { ...currentState, ...restored, run: restored.run ?? IDLE };
      },
    },
  ),
);

/** Current draft (plain data) for normalisation. */
export function selectDraft(s: Pick<CreationState, 'text' | 'photos' | 'preferences' | 'voice' | 'video' | 'drawing'>): CreationDraft {
  return draftOf(s);
}

function draftOf(s: Pick<CreationState, 'text' | 'photos' | 'preferences' | 'voice' | 'video' | 'drawing'>): CreationDraft {
  return {
    text: s.text, photos: s.photos, preferences: s.preferences,
    ...(s.voice ? { voice: s.voice } : {}),
    ...(s.video ? { video: s.video } : {}),
    ...(s.drawing ? { drawing: s.drawing } : {}),
  };
}
