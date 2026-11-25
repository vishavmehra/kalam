/**
 * The one versioned limits policy (docs/04 §6.6: "configurable through versioned application policy",
 * "the compiler and runtime must enforce the same limits"; docs/11 §11.1 spec under 100 KB).
 *
 * Every number here was copied, unchanged, from the constant that enforces it today. Until those
 * files read from this object, `policy.test.ts` checks that both sides still agree, so a limit
 * cannot be raised in one place and forgotten in another. Bump `LIMITS_POLICY_VERSION` whenever a
 * value changes, so an old app or backup can say which limits it was made under.
 *
 * Left out on purpose: sizes that only shape the screen (card widths, chip and list lengths), the
 * formula parse cache (an internal speed-up, not a rule), and ranges that are not whole numbers
 * (speech rate). Nothing here is a secret, so the policy is safe to show, export and ship in a backup.
 *
 * Pure data: no imports, so any module (spec schema, storage, runtime, Bazaar) can read it.
 */

const KB = 1024;
const MB = 1024 * KB;
const DAY_MS = 24 * 60 * 60 * 1000;

export const LIMITS_POLICY_VERSION = '1.0.0';

const policy = {
  version: LIMITS_POLICY_VERSION,

  /** KalamSpec resource limits (docs/05 §13.2). Same keys as `LIMITS` in src/core/spec/schema.ts. */
  spec: {
    screens: 8,
    componentsPerScreen: 40,
    collections: 10,
    fieldsPerCollection: 30,
    aiBlocks: 15,
    actions: 60,
    intentPhrasesPerAction: 12,
    enumOptions: 50,
    nameLength: 60,
    labelLength: 120,
    descriptionLength: 280,
    promptLength: 1200,
    formulaLength: 300,
    formulaSteps: 10_000,
    classifyLabels: 12,
    tags: 8,
    /** Largest spec as UTF-8 JSON (docs/11 §11.1, lead decision 6). Same as the Bazaar listing cap. */
    specBytes: 100_000,
    /** Deepest nesting the validator walks (validate.ts MAX_DEPTH). */
    nestingDepth: 24,
    /** Deepest formula expression tree (formula/parse.ts MAX_DEPTH). */
    formulaDepth: 32,
    /** Most operations in one edit patch (edit/apply.ts MAX_OPS). */
    editOperations: 100,
  },

  /** What one device keeps (docs/11 §6.4, §15.4). */
  data: {
    recordsPerCollection: 5_000,
    /** Default longest text value in a record (record-validation.ts). */
    recordTextLength: 5_000,
    blobBytes: 10 * MB,
    eventLogEntries: 500,
    aiCacheEntries: 500,
    aiCacheTtlMs: 30 * DAY_MS,
    aiCacheEntryBytes: 256 * KB,
    draftSessions: 5,
    draftTtlMs: 7 * DAY_MS,
    /** Largest saved creation draft (repositories.ts MAX_DRAFT_JSON). */
    draftJsonBytes: 1 * MB,
    versionsKept: 20,
    /** Longest saved reminder settings text for one app (reminders/config.ts MAX_STORED_LENGTH). */
    reminderConfigChars: 4_500,
  },

  /** Files Kalam will read or write. */
  files: {
    importBytes: 10 * MB,
    /** Largest photo file accepted before it is re-encoded (use-photo-drop.ts). */
    photoFileBytes: 20 * MB,
    backupFileBytes: 96 * MB,
    backupPlaintextBytes: 160 * MB,
  },

  /** What one creation can take in (docs/06). */
  input: {
    photos: 4,
    textChars: 4_000,
    imageSide: 1280,
    videoSeconds: 60,
    videoFrames: 6,
    /** Most text and images the compiler prompt carries (compiler/prompt.ts). */
    promptTextChars: 4_000,
    promptImages: 6,
    /** Longest instruction text a visual edit reads (edit/visual-edit.ts MAX_WORDS, which cuts by characters). */
    visualEditChars: 300,
  },

  /** Drawing Studio (docs/08 §11, §12, §14, §17). */
  drawing: {
    pages: 8,
    objectsPerPage: 500,
    historySteps: 100,
    exportSide: 4_096,
    /** Largest coordinate a saved drawing may hold (model/migrate.ts MAX_COORD). */
    maxCoordinate: 100_000,
    /** Most points in one stroke (model/migrate.ts MAX_POINTS). */
    pointsPerStroke: 20_000,
    /** Text size range in points (model/geometry.ts). */
    fontSizeMin: 8,
    fontSizeMax: 160,
    /** Largest drawing the web crash-recovery copy will store (recovery.ts MAX_CHARS). */
    recoveryChars: 2_500_000,
  },

  /** Request limits for AI calls (docs/07 §16.2). Client side only: provider quotas still apply. */
  ai: {
    /** Extra attempts per error code (core/ai/limits.ts RETRY_LIMITS). */
    retries: { quota: 2, provider_error: 2, offline: 2, timeout: 1 },
    maxRateWaitMs: 5_000,
    /** Token bucket for compile, repair and safety tasks. */
    heavyBucket: { capacity: 6, perMinute: 6 },
    /** Token bucket for every other task. */
    lightBucket: { capacity: 20, perMinute: 30 },
    memoryCacheEntries: 500,
    assistantQuestionChars: 300,
  },

  /** Spoken output (infrastructure/platform/tts.shared.ts MAX_SPOKEN_CHARS). */
  speech: {
    spokenChars: 600,
  },

  /** App translation (docs/10 §11). */
  translation: {
    onDeviceLabels: 60,
    translationChars: 400,
  },

  /** Smart Reminders (docs/14 §10). Same keys as `REMINDER_LIMITS`. */
  reminders: {
    rulesPerApp: 4,
    notificationsPerApp: 24,
    horizonDays: 60,
    maxLeadDays: 30,
    messageLength: 120,
    overdueListLimit: 20,
  },

  /** Links that send entries from one app to another. Same keys as `SHARE_LIMITS` (core/share/model.ts). */
  share: {
    linksPerApp: 20,
    fieldsPerLink: 30,
    sendBatch: 100,
    sentLedger: 500,
    auditPerLink: 50,
  },

  /** Encrypted backups (core/backup/crypto.ts). Files outside the iteration range are refused. */
  backup: {
    passphraseMinLength: 10,
    kdfIterationsMin: 310_000,
    kdfIterationsMax: 5_000_000,
  },

  /** Kalam Bazaar (docs/12). `listing` has the same keys as `BAZAAR_LIMITS`. */
  bazaar: {
    listing: {
      title: 60,
      description: 500,
      tags: 8,
      tagLength: 24,
      keywords: 40,
      keywordLength: 30,
      makerName: 40,
      capabilities: 12,
      capabilityLength: 80,
      reasons: 5,
      reasonLength: 200,
      changeSummary: 200,
      specBytes: 100_000,
      specGzChars: 140_000,
      listingBytes: 20_000,
      reportNote: 500,
      pageSize: 20,
    },
    maxPrice: 1_000,
    review: { comment: 500, response: 500 },
    screenshots: { count: 3, maxBytes: 100_000, minSide: 64, maxSide: 1280, maxAspect: 4 },
    svg: { maxInput: 16_000, maxOutput: 8_000 },
    /** What the offline copy keeps (infrastructure/bazaar/cache.ts). */
    cache: { listings: 120, specs: 12, reviews: 50 },
  },
} as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Read-only: a limit can only change by editing this file and bumping the version. */
export const limitsPolicy = deepFreeze(policy);

export type LimitsPolicy = typeof limitsPolicy;
