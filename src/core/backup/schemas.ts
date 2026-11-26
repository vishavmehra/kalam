/**
 * Zod shapes for untrusted backup content (docs/11 §13.2). Shared by the encrypted backup service and
 * the plain JSON import in the local database, so both trust boundaries apply the same rules.
 * Specs are checked separately with `validateSpec`; record values against their collection.
 */
import { z } from 'zod';
import type { CreationRoute, InputModality } from '../contracts';
import { limitsPolicy } from '../limits/policy';
import { COMPONENT_TYPES, idSchema } from '../spec/schema';
import { BASE64_RE } from './base64';

export const timestamp = z.number().int().nonnegative();
const finite = z.number().finite();
const coord = finite.min(-100_000).max(100_000);
const ITEM_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

/** Largest single local file (photo, frame, page image) Kalam stores, decoded. */
export const MAX_BLOB_BYTES = limitsPolicy.data.blobBytes;

const CREATION_ROUTES = [
  'template', 'template+on_device', 'cloud', 'cloud+repair', 'specialist', 'import', 'manual',
] as const satisfies readonly CreationRoute[];
const INPUT_MODALITIES = ['text', 'image', 'audio', 'video', 'drawing'] as const satisfies readonly InputModality[];

/** StoredApp envelope. Bad optional metadata is dropped; the spec is validated by validateSpec. */
export const storedAppShape = z.object({
  spec: z.unknown(),
  createdAt: timestamp.optional().catch(undefined),
  updatedAt: timestamp.optional().catch(undefined),
  lastOpenedAt: timestamp.optional().catch(undefined),
  pinned: z.boolean().optional().catch(undefined),
  archived: z.boolean().optional().catch(undefined),
  origin: z
    .object({
      route: z.enum(CREATION_ROUTES),
      provider: z.string().max(80).optional(),
      model: z.string().max(80).optional(),
      templateId: z.string().max(40).optional(),
    })
    .optional()
    .catch(undefined),
  creationInput: z
    .object({
      text: z.string().max(10_000),
      modalities: z.array(z.enum(INPUT_MODALITIES)).max(5),
      drawingId: z.string().max(128).optional(),
    })
    .optional()
    .catch(undefined),
});

export const recordShape = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  appId: z.string(),
  collectionId: z.string(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
  values: z.unknown(),
});

/**
 * The key the runtime keeps an unsent form draft under (runtime/engine/draft.ts). It is typed text that was never
 * saved, so it stays on this device: no backup, JSON export or account sync carries it, and a restore drops it.
 */
export const DRAFT_STATE_KEY = 'kalam_draft';
export const isLocalOnlyStateKey = (key: unknown): boolean => key === DRAFT_STATE_KEY;

export const stateRowSchema = z.object({
  appId: z.string(),
  key: idSchema,
  value: z.union([z.string().max(5_000), z.number().finite(), z.boolean(), z.null()]),
});

const FORBIDDEN_SEGMENT = /(^|\/)(__proto__|constructor|prototype)(\/|$)/;
const patchPath = z.string().max(500).refine((p) => !FORBIDDEN_SEGMENT.test(p));
export const versionRowShape = z.object({
  appId: z.string().max(128),
  version: z.number().int().min(1).max(1_000_000),
  createdAt: timestamp.catch(0),
  kind: z.enum(['snapshot', 'patch']),
  snapshot: z.unknown().optional(),
  patch: z
    .array(
      z.object({
        op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
        path: patchPath,
        from: patchPath.optional(),
        value: z.unknown().optional(),
      }),
    )
    .max(5_000)
    .optional(),
  summary: z.string().max(300).catch('Imported version'),
  source: z.enum(['create', 'edit', 'restore', 'import']).catch('import'),
  /** Who made the change. An unknown value is dropped, not rejected. */
  origin: z.enum(['user', 'ai', 'import', 'marketplace']).optional().catch(undefined),
});

// ─── Drawings (docs/08 §13) ───────────────────────────────────────────────────
const elementCommon = {
  id: z.string().regex(ITEM_ID_RE),
  zIndex: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  rotation: finite.min(-3600).max(3600).optional(),
  hint: z.string().max(60).optional(),
  groupId: z.string().max(160).optional(),
  // Object properties (DX1): without them a restored drawing silently loses its fill, corners, arrow head and text style.
  fill: z.string().max(64).optional(),
  radius: finite.min(0).max(400).optional(),
  headSize: finite.min(6).max(80).optional(),
  font: z.enum(['sans', 'serif', 'mono']).optional(),
  bold: z.boolean().optional(),
};
const color = z.string().max(64);
const box = { x: coord, y: coord, w: coord, h: coord };
const drawingElementSchema = z.union([
  z.object({
    ...elementCommon,
    kind: z.literal('stroke'),
    points: z.array(z.object({ x: coord, y: coord, pressure: z.number().min(0).max(1).optional() })).max(20_000),
    color,
    size: finite.min(0).max(1_000),
    tool: z.enum(['pen', 'marker', 'highlighter']),
  }),
  z.object({ ...elementCommon, kind: z.enum(['rect', 'ellipse', 'line', 'arrow']), ...box, color, size: finite.min(0).max(1_000) }),
  z.object({ ...elementCommon, kind: z.literal('text'), x: coord, y: coord, text: z.string().max(5_000), color, fontSize: finite.min(1).max(2_000) }),
  z.object({ ...elementCommon, kind: z.literal('stamp'), ...box, component: z.enum(COMPONENT_TYPES), label: z.string().max(200).optional() }),
  z.object({ ...elementCommon, kind: z.literal('image'), ...box, blobId: z.string().regex(ITEM_ID_RE), alt: z.string().max(500).optional() }),
]);
export const drawingSchema = z.object({
  id: z.string().regex(ITEM_ID_RE),
  title: z.string().max(200),
  createdAt: timestamp,
  updatedAt: timestamp,
  schemaVersion: z.number().int().min(1).max(1_000).optional(),
  activePageId: z.string().max(160).optional(),
  pages: z
    .array(
      z.object({
        id: z.string().regex(ITEM_ID_RE),
        title: z.string().max(200),
        width: finite.min(1).max(20_000),
        height: finite.min(1).max(20_000),
        elements: z.array(drawingElementSchema).max(10_000),
        background: z.enum(['plain', 'grid', 'dots']).optional(),
        backgroundColor: color.optional(),
      }),
    )
    .max(200),
});

// ─── Local files ──────────────────────────────────────────────────────────────
export const blobSchema = z.object({
  id: z.string().regex(ITEM_ID_RE),
  kind: z.enum(['image', 'image_original', 'audio', 'video_frame', 'drawing_png', 'listing_asset']),
  mimeType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]{1,80}$/i),
  base64: z.string().max(Math.ceil(MAX_BLOB_BYTES / 3) * 4).regex(BASE64_RE),
  createdAt: timestamp.optional(),
  ownerId: z.string().regex(ITEM_ID_RE).optional(),
});

// ─── Settings (only preferences; never consent or AI routing) ────────────────
const lang = z.string().regex(LANG_RE);
/**
 * Settings a backup may bring back. Consent (`allowCloud`, `allowExternalProviders`), `aiMode`,
 * `speech.keepRecordings` and device counters are deliberately absent: a restore never widens what
 * may leave this device or what is kept on it.
 */
export const settingsImportSchema = z.object({
  accessModes: z
    .object({
      large: z.boolean(), highContrast: z.boolean(), simple: z.boolean(), readAloud: z.boolean(), leftHanded: z.boolean(),
      voiceOnly: z.boolean(),
    })
    .partial()
    .optional()
    .catch(undefined),
  language: lang.optional().catch(undefined),
  colorScheme: z.enum(['system', 'light', 'dark']).optional().catch(undefined),
  reducedMotion: z.enum(['system', 'on', 'off']).optional().catch(undefined),
  speech: z
    .object({
      sttLanguage: lang,
      ttsLanguage: lang,
      voiceId: z.string().max(300).optional(),
      rate: z.number().min(0.5).max(2),
    })
    .optional()
    .catch(undefined),
  newAppLanguage: lang.optional().catch(undefined),
});
export type ImportedSettings = z.infer<typeof settingsImportSchema>;
