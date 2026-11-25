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
}
export interface DrawingAttachment {
  title: string;
  summary: DrawingSummary;
}
export interface CreationPreferences {
  themePreset?: ThemePreset;
  language: string;
  currency?: string;
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
export function draftBlocker(d: CreationDraft): string | undefined {
  if (draftModalities(d).length === 0) {
    return 'Describe your app, add a photo or sketch, speak, attach a video or draw it first.';
  }
  if (d.text.length > MAX_TEXT_CHARS) return `Keep the description under ${MAX_TEXT_CHARS} characters.`;
  return undefined;
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
  if (d.video?.frames.length) input.video = { frames: d.video.frames, durationSec: d.video.durationSec };
  if (d.drawing) input.drawing = d.drawing.summary;
  const prefs: NonNullable<NormalizedInput['preferences']> = {};
  if (d.preferences.themePreset) prefs.themePreset = d.preferences.themePreset;
  if (d.preferences.currency) prefs.currency = d.preferences.currency;
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
