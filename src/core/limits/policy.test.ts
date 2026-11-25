/**
 * The limits policy must say exactly what the code enforces today. Exported constants are imported;
 * private ones (not exported, so they cannot be imported) are read from the source text.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MAX_IMPORT_BYTES } from '@/components/files/limits';
import { rateLimitFor, RETRY_LIMITS, MAX_RATE_WAIT_MS } from '@/core/ai/limits';
import { CACHE_MAX_ENTRIES } from '@/core/ai/cache';
import { TASK_POLICIES } from '@/core/ai/routing';
import { MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS, MIN_PASSPHRASE_LENGTH } from '@/core/backup/crypto';
import { MAX_BACKUP_FILE_BYTES } from '@/core/backup/envelope';
import { MAX_PLAINTEXT_BYTES } from '@/core/backup/payload';
import { MAX_BLOB_BYTES } from '@/core/backup/schemas';
import { SCREENSHOT_LIMITS, SVG_MAX_INPUT, SVG_MAX_OUTPUT } from '@/core/bazaar/media';
import { BAZAAR_LIMITS, MAX_PRICE } from '@/core/bazaar/model';
import { REVIEW_LIMITS } from '@/core/bazaar/reviews';
import type { TaskType } from '@/core/contracts';
import { MAX_TRANSLATION_CHARS } from '@/core/i18n-labels/validate';
import { SHARE_LIMITS } from '@/core/share/model';
import { LIMITS } from '@/core/spec/schema';
import { MAX_SPEC_BYTES } from '@/core/spec/validate';
import { ON_DEVICE_MAX_LABELS } from '@/core/tasks/translate-service';
import { MAX_VERSIONS } from '@/core/versioning';
import { HISTORY_LIMIT } from '@/features/drawing/model/history';
import { MAX_EXPORT_SIDE } from '@/features/drawing/model/export-math';
import { MAX_IMAGE_SIDE, MAX_VIDEO_FRAMES, MAX_VIDEO_SECONDS } from '@/features/input/media-math';
import { MAX_PHOTOS, MAX_TEXT_CHARS } from '@/features/input/normalize';
import { REMINDER_LIMITS } from '@/features/reminders/types';
import {
  AI_CACHE_CAP, AI_CACHE_TTL_MS, EVENT_CAP, MAX_AI_CACHE_ENTRY_BYTES, MAX_SESSIONS, RECORD_CAP, SESSION_TTL_MS,
} from '@/infrastructure/storage/storage-limits';

import { LIMITS_POLICY_VERSION, limitsPolicy as p } from './policy';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Value of `const NAME = <digits and *>;` in a source file. Throws if the line is not that simple. */
function constIn(file: string, name: string): number {
  const text = readFileSync(`${ROOT}${file}`, 'utf8');
  const match = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*([^;]+);`).exec(text);
  if (!match) throw new Error(`${name} not found in ${file}`);
  const parts = match[1].split('*').map((s) => s.trim().replace(/_/g, ''));
  if (!parts.every((s) => /^\d+$/.test(s))) throw new Error(`${name} in ${file} is not a plain number: ${match[1]}`);
  return parts.reduce((n, s) => n * Number(s), 1);
}

describe('limits policy', () => {
  it('has a semantic version', () => {
    expect(LIMITS_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(p.version).toBe(LIMITS_POLICY_VERSION);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.spec)).toBe(true);
    expect(Object.isFrozen(p.bazaar.listing)).toBe(true);
    expect(Object.isFrozen(p.ai.retries)).toBe(true);
  });

  it('holds only positive whole numbers', () => {
    const bad: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'number') {
        if (!Number.isInteger(value) || value <= 0) bad.push(path);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    for (const [k, v] of Object.entries(p)) if (k !== 'version') walk(v, k);
    expect(bad).toEqual([]);
  });
});

describe('policy equals the constants the code enforces today', () => {
  it('spec: every key of LIMITS, same value', () => {
    for (const [key, value] of Object.entries(LIMITS)) {
      expect(p.spec[key as keyof typeof p.spec], `spec.${key}`).toBe(value);
    }
  });

  it('spec: the 100 KB size cap matches the validator and the Bazaar publish cap', () => {
    expect(p.spec.specBytes).toBe(100_000);
    expect(p.spec.specBytes).toBe(MAX_SPEC_BYTES);
    expect(p.spec.specBytes).toBe(BAZAAR_LIMITS.specBytes);
  });

  it('spec: private depth and operation limits', () => {
    expect(p.spec.nestingDepth).toBe(constIn('src/core/spec/validate.ts', 'MAX_DEPTH'));
    expect(p.spec.formulaDepth).toBe(constIn('src/core/formula/parse.ts', 'MAX_DEPTH'));
    expect(p.spec.editOperations).toBe(constIn('src/core/edit/apply.ts', 'MAX_OPS'));
  });

  it('data: storage limits', () => {
    expect(p.data.recordsPerCollection).toBe(RECORD_CAP);
    expect(p.data.blobBytes).toBe(MAX_BLOB_BYTES);
    expect(p.data.eventLogEntries).toBe(EVENT_CAP);
    expect(p.data.aiCacheEntries).toBe(AI_CACHE_CAP);
    expect(p.data.aiCacheTtlMs).toBe(AI_CACHE_TTL_MS);
    expect(p.data.aiCacheEntryBytes).toBe(MAX_AI_CACHE_ENTRY_BYTES);
    expect(p.data.draftSessions).toBe(MAX_SESSIONS);
    expect(p.data.draftTtlMs).toBe(SESSION_TTL_MS);
    expect(p.data.versionsKept).toBe(MAX_VERSIONS);
  });

  it('data: private storage limits', () => {
    expect(p.data.recordTextLength).toBe(constIn('src/infrastructure/storage/record-validation.ts', 'DEFAULT_TEXT_LIMIT'));
    expect(p.data.draftJsonBytes).toBe(constIn('src/infrastructure/storage/repositories.ts', 'MAX_DRAFT_JSON'));
    expect(p.data.reminderConfigChars).toBe(constIn('src/features/reminders/config.ts', 'MAX_STORED_LENGTH'));
  });

  it('files', () => {
    expect(p.files.importBytes).toBe(MAX_IMPORT_BYTES);
    expect(p.files.backupFileBytes).toBe(MAX_BACKUP_FILE_BYTES);
    expect(p.files.backupPlaintextBytes).toBe(MAX_PLAINTEXT_BYTES);
    expect(p.files.photoFileBytes).toBe(constIn('src/features/create/panels/use-photo-drop.ts', 'MAX_FILE_BYTES'));
  });

  it('input', () => {
    expect(p.input.photos).toBe(MAX_PHOTOS);
    expect(p.input.textChars).toBe(MAX_TEXT_CHARS);
    expect(p.input.imageSide).toBe(MAX_IMAGE_SIDE);
    expect(p.input.videoSeconds).toBe(MAX_VIDEO_SECONDS);
    expect(p.input.videoFrames).toBe(MAX_VIDEO_FRAMES);
    expect(p.input.promptTextChars).toBe(constIn('src/core/compiler/prompt.ts', 'MAX_TEXT'));
    expect(p.input.promptImages).toBe(constIn('src/core/compiler/prompt.ts', 'MAX_IMAGES'));
    expect(p.input.visualEditChars).toBe(constIn('src/core/edit/visual-edit.ts', 'MAX_WORDS'));
  });

  it('drawing', () => {
    expect(p.drawing.pages).toBe(constIn('src/features/drawing/model/constants.ts', 'MAX_PAGES'));
    expect(p.drawing.objectsPerPage).toBe(constIn('src/features/drawing/model/constants.ts', 'PAGE_OBJECT_CAP'));
    expect(p.drawing.historySteps).toBe(HISTORY_LIMIT);
    expect(p.drawing.exportSide).toBe(MAX_EXPORT_SIDE);
    expect(p.drawing.pages).toBe(p.spec.screens);
    expect(p.drawing.maxCoordinate).toBe(constIn('src/features/drawing/model/migrate.ts', 'MAX_COORD'));
    expect(p.drawing.pointsPerStroke).toBe(constIn('src/features/drawing/model/migrate.ts', 'MAX_POINTS'));
    expect(p.drawing.fontSizeMin).toBe(constIn('src/features/drawing/model/geometry.ts', 'MIN_FONT'));
    expect(p.drawing.fontSizeMax).toBe(constIn('src/features/drawing/model/geometry.ts', 'MAX_FONT'));
    expect(p.drawing.recoveryChars).toBe(constIn('src/features/drawing/recovery.ts', 'MAX_CHARS'));
  });

  it('ai', () => {
    expect(p.ai.retries).toEqual(RETRY_LIMITS);
    expect(p.ai.maxRateWaitMs).toBe(MAX_RATE_WAIT_MS);
    expect(p.ai.memoryCacheEntries).toBe(CACHE_MAX_ENTRIES);
    expect(p.ai.assistantQuestionChars).toBe(constIn('src/core/assistant/assistant.ts', 'MAX_QUESTION'));
    const buckets = new Map<string, { capacity: number; perMinute: number }>();
    for (const task of Object.keys(TASK_POLICIES) as TaskType[]) {
      const b = rateLimitFor(task);
      buckets.set(`${b.capacity}/${b.perMinute}`, b);
    }
    expect([...buckets.values()].sort((a, b) => a.capacity - b.capacity)).toEqual([p.ai.heavyBucket, p.ai.lightBucket]);
  });

  it('speech, share links and backups', () => {
    expect(p.speech.spokenChars).toBe(constIn('src/infrastructure/platform/tts.shared.ts', 'MAX_SPOKEN_CHARS'));
    expect(p.share).toEqual(SHARE_LIMITS);
    expect(p.backup).toEqual({
      passphraseMinLength: MIN_PASSPHRASE_LENGTH, kdfIterationsMin: MIN_KDF_ITERATIONS, kdfIterationsMax: MAX_KDF_ITERATIONS,
    });
  });

  it('translation and reminders', () => {
    expect(p.translation.onDeviceLabels).toBe(ON_DEVICE_MAX_LABELS);
    expect(p.translation.translationChars).toBe(MAX_TRANSLATION_CHARS);
    expect(p.reminders).toEqual(REMINDER_LIMITS);
  });

  it('bazaar', () => {
    expect(p.bazaar.listing).toEqual(BAZAAR_LIMITS);
    expect(p.bazaar.maxPrice).toBe(MAX_PRICE);
    expect(p.bazaar.review).toEqual(REVIEW_LIMITS);
    expect(p.bazaar.screenshots).toEqual(SCREENSHOT_LIMITS);
    expect(p.bazaar.svg).toEqual({ maxInput: SVG_MAX_INPUT, maxOutput: SVG_MAX_OUTPUT });
    expect(p.bazaar.cache).toEqual({
      listings: constIn('src/infrastructure/bazaar/cache.ts', 'MAX_LISTINGS'),
      specs: constIn('src/infrastructure/bazaar/cache.ts', 'MAX_SPECS'),
      reviews: constIn('src/infrastructure/bazaar/cache.ts', 'MAX_REVIEWS'),
    });
  });
});
