/**
 * What a queued operation keeps of its input, as plain data (no React, no network).
 *
 * - Build: a frozen copy of the creation draft. Text, transcript and the drawing outline are JSON in the
 *   operation row. Pictures (photos, video frames, drawing pages) go to the local file store under the
 *   operation id, as references, never inline (docs/09 §18.2). The live draft stays editable and separate.
 * - AI step: the typed text, or a reference to one picture, and which step to run.
 * - Results are read back through a schema too: a row is data from disk, not trusted code.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { stableStringify } from '@/core/ai/cache';
import type { CreationResult, NormalizedImage, RecordValue, StoredBlob } from '@/core/contracts';
import type { PendingOperation, SendKind } from '@/core/queue/model';
import { THEME_PRESETS } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { briefOf, MAX_BRIEF_CHARS, MAX_PHOTOS, MAX_TEXT_CHARS, type CreationDraft } from '@/features/input/normalize';

export const SNAPSHOT_VERSION = 1;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type Role = 'photo' | 'frame' | 'drawing';
const BLOB_KIND: Record<Role, StoredBlob['kind']> = { photo: 'image', frame: 'video_frame', drawing: 'drawing_png' };

const imageRef = z.object({
  blobId: z.string().min(1).max(300),
  id: z.string().max(200),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  source: z.enum(['photo', 'drawing', 'video_frame', 'screenshot']),
  label: z.string().max(300).optional(),
  role: z.enum(['photo', 'frame', 'drawing']),
});

export const compileSnapshotSchema = z.object({
  v: z.literal(SNAPSHOT_VERSION),
  text: z.string().max(MAX_TEXT_CHARS * 2),
  preferences: z.object({
    themePreset: z.enum(THEME_PRESETS).optional(),
    language: z.string().max(16),
    currency: z.string().max(8).optional(),
    targetUser: z.string().max(MAX_BRIEF_CHARS).optional(),
    constraints: z.string().max(MAX_BRIEF_CHARS).optional(),
  }),
  voice: z.object({
    transcript: z.string().max(MAX_TEXT_CHARS * 2),
    recognizedBy: z.enum(['on_device', 'cloud_service', 'typed']),
    durationSec: z.number().nonnegative().optional(),
  }).optional(),
  video: z.object({
    name: z.string().max(300).optional(),
    durationSec: z.number().nonnegative(),
    droppedFrames: z.number().int().nonnegative(),
    summary: z.string().max(MAX_TEXT_CHARS * 2).optional(),
  }).optional(),
  drawing: z.object({
    title: z.string().max(300),
    summary: z.object({
      drawingId: z.string().max(200),
      pageCount: z.number().int().nonnegative(),
      elements: z.array(z.object({
        kind: z.string().max(60), label: z.string().max(500).optional(), page: z.number().int(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), hint: z.string().max(60).optional(),
      })).max(10_000),
      texts: z.array(z.string().max(2_000)).max(5_000),
      notes: z.array(z.string().max(500)).max(200).optional(),
    }),
  }).optional(),
  images: z.array(imageRef).max(64),
});
export type CompileSnapshot = z.infer<typeof compileSnapshotSchema>;

export interface PreparedBuild {
  /** JSON for the operation row. */
  snapshot: string;
  /** Files to store under the operation id before the row is written. */
  files: Array<{ blobId: string; kind: StoredBlob['kind']; mimeType: string; base64: string }>;
  sends: SendKind[];
  dedupeKey: string;
}

const hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/** Which kinds of content a build sends if it goes to the cloud, in plain categories. */
export function buildSends(d: CreationDraft): SendKind[] {
  const sends: SendKind[] = [];
  if (d.text.trim()) sends.push('text');
  if (d.photos.length) sends.push('photos');
  if (d.voice?.transcript.trim()) sends.push('voice_text');
  if (d.video?.frames.length) sends.push('video_frames');
  if (d.drawing && (d.drawing.summary.elements.length || d.drawing.summary.images.length)) sends.push('drawing');
  return sends;
}

/** Freezes a draft for a queued build. Throws when it holds nothing to build from. */
export function prepareBuild(d: CreationDraft, opId: string): PreparedBuild {
  const sends = buildSends(d);
  if (!sends.length) throw new Error('empty draft');
  const groups: Array<{ role: Role; images: readonly NormalizedImage[] }> = [
    { role: 'photo', images: d.photos.slice(0, MAX_PHOTOS) },
    { role: 'frame', images: d.video?.frames ?? [] },
    { role: 'drawing', images: d.drawing?.summary.images ?? [] },
  ];
  const files: PreparedBuild['files'] = [];
  const images: CompileSnapshot['images'] = [];
  for (const { role, images: list } of groups) {
    for (const image of list) {
      const blobId = `${opId}.${files.length}`;
      files.push({ blobId, kind: BLOB_KIND[role], mimeType: image.mimeType, base64: image.base64 });
      images.push({
        blobId, id: image.id, width: image.width, height: image.height, source: image.source, role,
        ...(image.label ? { label: image.label } : {}),
      });
    }
  }
  const { themePreset, language, currency } = d.preferences;
  const snapshot: CompileSnapshot = {
    v: SNAPSHOT_VERSION,
    text: d.text.slice(0, MAX_TEXT_CHARS * 2),
    preferences: { language, ...(themePreset ? { themePreset } : {}), ...(currency ? { currency } : {}), ...briefOf(d.preferences) },
    ...(d.voice ? { voice: { transcript: d.voice.transcript, recognizedBy: d.voice.recognizedBy, ...(d.voice.durationSec !== undefined ? { durationSec: d.voice.durationSec } : {}) } } : {}),
    ...(d.video ? { video: { ...(d.video.name ? { name: d.video.name } : {}), durationSec: d.video.durationSec, droppedFrames: d.video.droppedFrames, ...(d.video.summary ? { summary: d.video.summary.slice(0, MAX_TEXT_CHARS * 2) } : {}) } } : {}),
    ...(d.drawing ? {
      drawing: {
        title: d.drawing.title,
        summary: {
          drawingId: d.drawing.summary.drawingId, pageCount: d.drawing.summary.pageCount,
          elements: d.drawing.summary.elements, texts: d.drawing.summary.texts,
          ...(d.drawing.summary.notes ? { notes: d.drawing.summary.notes } : {}),
        },
      },
    } : {}),
    images,
  };
  const checked = compileSnapshotSchema.parse(snapshot);
  // Same inputs, same key, whatever the file ids are: a second tap never queues a second build.
  const dedupeKey = `compile:${hex(stableStringify({ ...checked, images: [...groups.flatMap((g) => g.images.map((i) => [g.role, hex(i.base64)]))] })).slice(0, 40)}`;
  return { snapshot: JSON.stringify(checked), files, sends, dedupeKey };
}

/** Rebuilds the draft from a snapshot and its files. Undefined when the snapshot or a file is gone or unreadable. */
export async function restoreBuild(
  snapshot: string | undefined,
  loadBlob: (id: string) => Promise<Pick<StoredBlob, 'mimeType' | 'base64'> | undefined>,
): Promise<CreationDraft | undefined> {
  if (!snapshot) return undefined;
  let parsed: CompileSnapshot;
  try {
    parsed = compileSnapshotSchema.parse(JSON.parse(snapshot));
  } catch {
    return undefined;
  }
  const byRole: Record<Role, NormalizedImage[]> = { photo: [], frame: [], drawing: [] };
  for (const ref of parsed.images) {
    const blob = await loadBlob(ref.blobId);
    const mimeType = IMAGE_TYPES.find((t) => t === blob?.mimeType);
    if (!blob || !mimeType) return undefined; // a missing picture would change what is built: stop instead
    byRole[ref.role].push({
      id: ref.id, mimeType, base64: blob.base64, width: ref.width, height: ref.height, source: ref.source,
      ...(ref.label ? { label: ref.label } : {}),
    });
  }
  return {
    text: parsed.text,
    photos: byRole.photo,
    preferences: parsed.preferences,
    ...(parsed.voice ? { voice: parsed.voice } : {}),
    ...(parsed.video ? { video: { ...parsed.video, frames: byRole.frame } } : {}),
    ...(parsed.drawing ? { drawing: { title: parsed.drawing.title, summary: { ...parsed.drawing.summary, images: byRole.drawing } } } : {}),
  };
}

/** The app a finished build made, checked again before it can reach the review screen (like a restored draft). */
export function readBuildResult(op: Pick<PendingOperation, 'kind' | 'status' | 'result'>): CreationResult | undefined {
  if (op.kind !== 'compile' || op.status !== 'completed' || !op.result) return undefined;
  try {
    const result = JSON.parse(op.result) as CreationResult;
    if (result?.ok !== true || !result.spec) return undefined;
    const checked = validateSpec(result.spec);
    return checked.ok && checked.spec ? { ...result, spec: checked.spec } : undefined;
  } catch {
    return undefined;
  }
}

// ─── AI step ──────────────────────────────────────────────────────────────────
export const aiStepSnapshotSchema = z.object({
  v: z.literal(SNAPSHOT_VERSION),
  blockId: z.string().min(1).max(100),
  /** The text the step reads. Kept only until the step ends. */
  input: z.string().max(MAX_TEXT_CHARS).optional(),
  /** One picture for a photo step, in the file store under the operation id. */
  imageBlobId: z.string().max(300).optional(),
});
export type AIStepSnapshot = z.infer<typeof aiStepSnapshotSchema>;

export const aiStepResultSchema = z.object({
  blockId: z.string().max(100),
  output: z.record(z.string().max(100), z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()])),
});
export type AIStepResult = { blockId: string; output: Record<string, RecordValue> };

export function aiStepDedupeKey(appId: string, snapshot: AIStepSnapshot, imageBase64?: string): string {
  return `ai:${hex(stableStringify({ appId, blockId: snapshot.blockId, input: snapshot.input, image: imageBase64 ? hex(imageBase64) : undefined })).slice(0, 40)}`;
}

export function parseAiStepSnapshot(snapshot: string | undefined): AIStepSnapshot | undefined {
  try {
    return snapshot ? aiStepSnapshotSchema.parse(JSON.parse(snapshot)) : undefined;
  } catch {
    return undefined;
  }
}

/** The values a finished AI step found, to be shown to the person as a proposal like any other AI step. */
export function readAiStepResult(op: Pick<PendingOperation, 'kind' | 'status' | 'result'>): AIStepResult | undefined {
  if (op.kind !== 'ai_step' || op.status !== 'completed' || !op.result) return undefined;
  try {
    return aiStepResultSchema.parse(JSON.parse(op.result));
  } catch {
    return undefined;
  }
}

// ─── Results of the other kinds ───────────────────────────────────────────────
export const translateResultSchema = z.object({ lang: z.string().max(16), missing: z.number().int().nonnegative() });
export type TranslateResult = z.infer<typeof translateResultSchema>;

export function readTranslateResult(op: Pick<PendingOperation, 'kind' | 'status' | 'result'>): TranslateResult | undefined {
  if (op.kind !== 'translate' || op.status !== 'completed' || !op.result) return undefined;
  try {
    return translateResultSchema.parse(JSON.parse(op.result));
  } catch {
    return undefined;
  }
}
