/**
 * Creation-session draft → NormalizedInput (docs/07 §11.3 stage 2, docs/06 §3). The draft keeps
 * every modality the user supplied; normalisation snapshots it into the one contract the
 * pipeline accepts. Raw audio and raw video never enter NormalizedInput.
 */
import type { DrawingSummary, InputModality, NormalizedImage, NormalizedInput } from '@/core/contracts';
import type { ThemePreset } from '@/core/spec/schema';

export const MAX_PHOTOS = 4;
export const MAX_TEXT_CHARS = 4000;

export interface VoiceAttachment {
  transcript: string;
  /** Local recording, kept on this device only. */
  audioUri?: string;
  durationSec?: number;
  /** Where speech recognition actually ran (shown to the user). */
  recognizedBy: 'on_device' | 'cloud_service' | 'typed';
}
export interface VideoAttachment {
  name?: string;
  durationSec: number;
  frames: NormalizedImage[];
  /** Frames dropped as near-duplicates (for honest status text). */
  droppedFrames: number;
  /** What the person said about the video's steps, when a media session folded it in (needed by a queued build). */
  summary?: string;
}
export interface DrawingAttachment {
  title: string;
  summary: DrawingSummary;
}
/** Longest "who is it for" or "must and must not" note. A short note is read; an essay belongs in the description. */
export const MAX_BRIEF_CHARS = 300;
export interface CreationPreferences {
  themePreset?: ThemePreset;
  language: string;
  currency?: string;
  /** Who will use the app (docs/15 §8.2). Written by the person, kept with this session only. */
  targetUser?: string;
  /** Things the app must or must not do (docs/15 §8.2). Written by the person, kept with this session only. */
  constraints?: string;
}

/** The two notes the person wrote about the app, trimmed, or undefined when both are empty. */
export function briefOf(p: Pick<CreationPreferences, 'targetUser' | 'constraints'>): { targetUser?: string; constraints?: string } | undefined {
  const targetUser = p.targetUser?.trim().slice(0, MAX_BRIEF_CHARS);
  const constraints = p.constraints?.trim().slice(0, MAX_BRIEF_CHARS);
  if (!targetUser && !constraints) return undefined;
  return { ...(targetUser ? { targetUser } : {}), ...(constraints ? { constraints } : {}) };
}

/** Only language, currency and look are remembered between sessions. The notes about one app are not. */
export function sharedPreferences(p: CreationPreferences): CreationPreferences {
  const { targetUser: _who, constraints: _limits, ...rest } = p;
  return rest;
}
export interface CreationDraft {
  text: string;
  photos: NormalizedImage[];
  voice?: VoiceAttachment;
  video?: VideoAttachment;
  drawing?: DrawingAttachment;
  preferences: CreationPreferences;
}

export function draftModalities(d: CreationDraft): InputModality[] {
  const m: InputModality[] = [];
  if (d.text.trim()) m.push('text');
  if (d.photos.length) m.push('image');
  if (d.voice?.transcript.trim()) m.push('audio');
  if (d.video?.frames.length) m.push('video');
  if (d.drawing && (d.drawing.summary.elements.length || d.drawing.summary.images.length)) m.push('drawing');
  return m;
}

/** Why "Create app" is disabled, in plain language — or undefined when the draft is usable. */
export function draftBlockerKey(d: CreationDraft): 'create.ws.blockEmpty' | 'create.ws.blockLong' | undefined {
  if (draftModalities(d).length === 0) return 'create.ws.blockEmpty';
  return d.text.length > MAX_TEXT_CHARS ? 'create.ws.blockLong' : undefined;
}

const BLOCKER_EN: Record<NonNullable<ReturnType<typeof draftBlockerKey>>, string> = {
  'create.ws.blockEmpty': 'Describe your app, add a photo or sketch, speak, attach a video or draw it first.',
  'create.ws.blockLong': `Keep the description under ${MAX_TEXT_CHARS} characters.`,
};

/** English wording of `draftBlockerKey`, for callers outside the translated screens (features/media). One decision, two wordings. */
export function draftBlocker(d: CreationDraft): string | undefined {
  const key = draftBlockerKey(d);
  return key ? BLOCKER_EN[key] : undefined;
}

/**
 * Snapshot the draft for one compilation. `text` is the typed description only; the pipeline
 * reads `audioTranscript` alongside it, so the transcript is never duplicated into `text`.
 */
export function buildNormalizedInput(d: CreationDraft): NormalizedInput {
  const typed = d.text.trim().slice(0, MAX_TEXT_CHARS);
  const transcript = d.voice?.transcript.trim() || undefined;
  const input: NormalizedInput = {
    text: typed,
    modalities: draftModalities(d),
    images: d.photos.slice(0, MAX_PHOTOS),
    language: d.preferences.language,
  };
  if (transcript) input.audioTranscript = transcript;
  if (d.video?.frames.length) input.video = { frames: d.video.frames, durationSec: d.video.durationSec, ...(d.video.summary ? { summary: d.video.summary } : {}) };
  if (d.drawing) input.drawing = d.drawing.summary;
  // The compiler contract (src/core/contracts) names theme and currency; the two notes ride along on the same
  // object for the compiler prompt to read once its type lists them (docs/15 §8.2).
  const prefs: NonNullable<NormalizedInput['preferences']> & { targetUser?: string; constraints?: string } = {};
  if (d.preferences.themePreset) prefs.themePreset = d.preferences.themePreset;
  if (d.preferences.currency) prefs.currency = d.preferences.currency;
  Object.assign(prefs, briefOf(d.preferences));
  if (Object.keys(prefs).length) input.preferences = prefs;
  return input;
}

/** Shown in the attachment list and stored as StoredApp.creationInput. */
export function creationInputRecord(d: CreationDraft): { text: string; modalities: InputModality[]; drawingId?: string } {
  const rec: { text: string; modalities: InputModality[]; drawingId?: string } = {
    text: d.text.trim() || d.voice?.transcript.trim() || '',
    modalities: draftModalities(d),
  };
  if (d.drawing) rec.drawingId = d.drawing.summary.drawingId;
  return rec;
}
