/**
 * Media contracts of the multimodal engine (docs/06 §4, §8.4, §9.5, §12.5, §14.2). Every shape has a
 * Zod schema because restored sessions and model output are untrusted input. Pure TypeScript.
 */
import { z } from 'zod';

export const MEDIA_TYPES = ['image', 'audio', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** docs/06 §5.2: stages only, never an invented percentage. */
export const PROCESSING_STATUSES = [
  'pending', 'validating', 'processing_local', 'preparing_cloud', 'ready', 'partial', 'failed',
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/** docs/06 §14.2. */
export const MEDIA_ERROR_CODES = [
  'PERMISSION_DENIED', 'FILE_UNSUPPORTED', 'FILE_TOO_LARGE', 'FILE_CORRUPTED', 'IMAGE_DECODE_FAILED',
  'AUDIO_RECORDING_FAILED', 'AUDIO_TRANSCRIPTION_FAILED', 'VIDEO_DECODE_FAILED', 'VIDEO_EXTRACTION_FAILED',
  'DRAWING_EXPORT_FAILED', 'ATTACHMENT_STORAGE_FAILED', 'CONTEXT_BUILD_FAILED', 'COMPILER_INPUT_TOO_LARGE',
  'CLOUD_CONSENT_REQUIRED', 'NETWORK_UNAVAILABLE',
  // Recovery and speech consent (docs/06 §3.3, docs/10 §16.4).
  'PROCESSING_INTERRUPTED', 'ATTACHMENT_MISSING', 'SPEECH_CONSENT_REQUIRED', 'SPEECH_BLOCKED',
] as const;
export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const ms = z.number().int().nonnegative().max(24 * 60 * 60 * 1000);
const time = z.number().int().nonnegative();

export const mediaErrorSchema = z.object({ code: z.enum(MEDIA_ERROR_CODES), message: z.string().max(400) });

export const mediaAttachmentSchema = z.object({
  id,
  type: z.enum(MEDIA_TYPES),
  mimeType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]{1,80}$/i),
  sizeBytes: z.number().int().nonnegative(),
  /** Display name, already sanitised (docs/06 §16.2). */
  name: z.string().max(120).optional(),
  /** Fingerprint for duplicate detection (hash.ts). */
  contentHash: z.string().max(80).optional(),
  status: z.enum(PROCESSING_STATUSES),
  error: mediaErrorSchema.optional(),
  /** Blob ids (local only): original, display thumbnail. */
  originalAssetId: id.optional(),
  previewAssetId: id.optional(),
  /** Compiler-ready copy: the NormalizedImage id the creation draft holds (≤1280 px JPEG, EXIF removed). */
  preparedImageId: z.string().max(200).optional(),
  /** Local file reference on Android and iOS (never uploaded). Web object URLs do not survive a reload. */
  localUri: z.string().max(2000).optional(),
  /** The person's words about this attachment ("describe"). */
  note: z.string().max(1000).optional(),
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  durationMs: ms.optional(),
  fps: z.number().positive().max(1000).optional(),
  sampleRate: z.number().int().positive().max(400_000).optional(),
  channels: z.number().int().positive().max(16).optional(),
  hasAudio: z.boolean().optional(),
  /** Degrees clockwise the person rotated the picture. */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  createdAt: time,
  updatedAt: time,
});
export type MediaAttachment = z.infer<typeof mediaAttachmentSchema>;

/** docs/06 §9.5. `assetId` is the frame's NormalizedImage id. */
export const videoFrameSchema = z.object({
  id,
  attachmentId: id,
  assetId: z.string().max(200),
  timestampMs: ms,
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
});
export type VideoFrameArtifact = z.infer<typeof videoFrameSchema>;

export const transcriptSegmentSchema = z.object({
  text: z.string().max(20_000),
  startMs: ms.optional(),
  endMs: ms.optional(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

/** docs/06 §8.4, §8.5: the first machine text is kept next to the person's edit. */
export const audioTranscriptSchema = z.object({
  attachmentId: id,
  text: z.string().max(20_000),
  original: z.string().max(20_000),
  language: z.string().max(16).optional(),
  languageSource: z.enum(['speech_service', 'script', 'person']).optional(),
  segments: z.array(transcriptSegmentSchema).max(500).optional(),
  source: z.enum(['device', 'cloud', 'user_edited']),
  status: z.enum(['complete', 'partial', 'failed']),
});
export type AudioTranscript = z.infer<typeof audioTranscriptSchema>;

/** docs/06 §4.5. */
export const derivedArtifactSchema = z.object({
  id,
  sourceAttachmentIds: z.array(id).max(16),
  artifactType: z.enum(['transcript', 'ocr', 'frame', 'summary', 'thumbnail', 'drawing_export']),
  createdAt: time,
  processorVersion: z.string().max(40),
});
export type DerivedArtifact = z.infer<typeof derivedArtifactSchema>;

/** docs/06 §4.2. Corrections are new items; earlier items are never rewritten (§6.4). */
export const textInputSchema = z.object({
  id,
  text: z.string().max(8_000),
  role: z.enum(['primary_description', 'additional_requirement', 'correction', 'preference']),
  createdAt: time,
  updatedAt: time.optional(),
  /** What the item answers or describes, for provenance (docs/06 §12.6). */
  sourceAttachmentId: id.optional(),
  conflictId: z.string().max(80).optional(),
});
export type TextInputItem = z.infer<typeof textInputSchema>;

export const workflowStepSchema = z.object({
  order: z.number().int().min(1).max(50),
  description: z.string().max(300),
  timestampMs: ms,
  frameId: id.optional(),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

/** docs/06 §9.7: an intermediate representation, never KalamSpec. */
export const workflowSchema = z.object({
  attachmentId: id,
  name: z.string().max(120),
  steps: z.array(workflowStepSchema).max(20),
  source: z.enum(['draft', 'transcript', 'on_device', 'cloud', 'person']),
  reviewed: z.boolean(),
  updatedAt: time,
});
export type WorkflowSummary = z.infer<typeof workflowSchema>;

export const conflictOptionSchema = z.object({
  id: z.string().max(40),
  label: z.string().max(120),
  /** Recorded as a correction when chosen. */
  correction: z.string().max(300),
});

/** docs/06 §12.5, plus the plain-English question shown to the person. */
export const contextConflictSchema = z.object({
  id: z.string().max(80),
  topic: z.enum(['field_count', 'screen_count', 'language', 'currency']),
  observations: z
    .array(z.object({ sourceAttachmentId: id.optional(), sourceTextId: id.optional(), statement: z.string().max(300) }))
    .max(8),
  resolution: z.enum(['resolved', 'needs_user_confirmation']),
  resolutionNote: z.string().max(300).optional(),
  question: z.string().max(300),
  options: z.array(conflictOptionSchema).max(4),
  /** Stable fingerprint of the observations, so an answer is kept only while they stay the same. */
  key: z.string().max(400),
});
export type ContextConflict = z.infer<typeof contextConflictSchema>;
