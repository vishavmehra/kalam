/**
 * Batch Document Intelligence (docs/14 §9.6): several photos or PDF pages become several records, read
 * one page at a time so the person sees progress, can stop, and keeps what was already read. Duplicates
 * are marked, never dropped. Nothing is inserted here: `chosenRecords` returns what the person approved,
 * and the caller saves it after the person confirms. Pages live in memory only; this module writes nothing.
 */
import type { AIBlockService, AIErrorCode, AIImage, InferenceSource, RecordValue } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { normText } from '../tasks/coerce';
import { photoFields } from '../tasks/ai-block-service';
import { buildReviewFields, isReady, needsAttention, recordValues, type ReviewField } from './review';

export interface DocumentPage {
  id: string;
  image: AIImage;
  /** Pixel size of `image`, for drawing it at the right shape. */
  width?: number;
  height?: number;
  /** File name as shown to the person. */
  name: string;
  /** 1-based page within `name`, and how many pages that file has. A photo is page 1 of 1. */
  page: number;
  pages: number;
}

export type ItemStatus = 'waiting' | 'reading' | 'read' | 'failed';

export interface BatchItem {
  page: DocumentPage;
  status: ItemStatus;
  /** Why the page failed, as a code the screen turns into words. */
  error?: AIErrorCode | 'other';
  /** Where the reading ran, for the honest source label. */
  source?: InferenceSource;
  fields: ReviewField[];
  /** The person's choice. Undefined means the default: include unless it is a duplicate. */
  accepted?: boolean;
  duplicate?: 'batch' | 'existing';
}

export const newBatch = (pages: readonly DocumentPage[]): BatchItem[] => pages.map((page) => ({ page, status: 'waiting', fields: [] }));

export const isIncluded = (i: BatchItem): boolean => i.status === 'read' && (i.accepted ?? !i.duplicate);
/** Chosen and ready to save. */
export const isSavable = (i: BatchItem): boolean => isIncluded(i) && isReady(i.fields);

export interface BatchSummary {
  total: number;
  read: number;
  failed: number;
  waiting: number;
  /** Included records that still have something to check or fix. */
  toFix: number;
  savable: number;
  duplicates: number;
}

export function summarize(items: readonly BatchItem[]): BatchSummary {
  const read = items.filter((i) => i.status === 'read');
  return {
    total: items.length,
    read: read.length,
    failed: items.filter((i) => i.status === 'failed').length,
    waiting: items.filter((i) => i.status === 'waiting' || i.status === 'reading').length,
    toFix: read.filter((i) => isIncluded(i) && !isReady(i.fields)).length,
    savable: items.filter(isSavable).length,
    duplicates: read.filter((i) => i.duplicate).length,
  };
}

// ─── Duplicates ───────────────────────────────────────────────────────────────
const pairs = (values: Readonly<Record<string, RecordValue>>) =>
  Object.entries(values).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}=${normText(String(v))}`).sort();

/**
 * Marks a record that repeats an earlier one in this batch, or one already in the list. A match needs the
 * same value in every field that was read, and at least two fields, so one shared name is not a duplicate.
 * Called again after every edit, since edits change what matches.
 */
export function markDuplicates(items: readonly BatchItem[], existing: ReadonlyArray<Readonly<Record<string, RecordValue>>> = []): BatchItem[] {
  const seen = new Set<string>();
  const old = existing.map((r) => new Set(pairs(r)));
  return items.map((item) => {
    const rest = { ...item };
    delete rest.duplicate;
    if (item.status !== 'read') return rest;
    const mine = pairs(recordValues(item.fields));
    if (mine.length < 2) return rest;
    const key = mine.join('|');
    if (seen.has(key)) return { ...rest, duplicate: 'batch' };
    seen.add(key);
    return old.some((o) => mine.every((p) => o.has(p))) ? { ...rest, duplicate: 'existing' } : rest;
  });
}

// ─── Reading ──────────────────────────────────────────────────────────────────
export interface ReadContext {
  service: Pick<AIBlockService, 'run'>;
  spec: KalamSpec;
  /** An extractFromPhoto step. */
  blockId: string;
  appId: string;
  now: Date;
  /** Values of records already in the target list, for duplicate marking. */
  existing?: ReadonlyArray<Readonly<Record<string, RecordValue>>>;
  signal?: AbortSignal;
}

/** After these, every remaining page would fail the same way, so the batch stops and keeps them waiting. */
const STOPPING: ReadonlySet<AIErrorCode> = new Set(['offline', 'consent_denied', 'not_configured', 'app_check_failed', 'quota', 'model_unavailable']);

/** Applies a change to one page and re-marks duplicates. Used for reading results and for the person's edits alike. */
export function applyPatch(
  items: readonly BatchItem[], index: number, patch: Partial<BatchItem>, existing?: ReadContext['existing'],
): BatchItem[] {
  return markDuplicates(items.map((x, k) => (k === index ? { ...x, ...patch } : x)), existing);
}

/**
 * Reads every waiting or failed page, one at a time, reporting each step as a patch to apply to the latest
 * list. Patches (not whole lists) mean the person can keep editing page 1 while page 5 is being read.
 * Cancelling keeps what is read; the page in flight goes back to waiting. Run it again to retry what
 * failed or was left.
 */
export async function readPages(items: readonly BatchItem[], ctx: ReadContext, onPatch: (index: number, patch: Partial<BatchItem>) => void): Promise<void> {
  const block = ctx.spec.aiBlocks[ctx.blockId];
  const fields = block?.kind === 'extractFromPhoto' ? photoFields(ctx.spec, block) : undefined;
  for (let i = 0; i < items.length; i++) {
    if (items[i].status === 'read') continue;
    if (ctx.signal?.aborted) return;
    if (!block || block.kind !== 'extractFromPhoto' || !fields) { onPatch(i, { status: 'failed', error: 'other' }); continue; }
    onPatch(i, { status: 'reading' });
    let res;
    try {
      res = await ctx.service.run({ appId: ctx.appId, blockId: ctx.blockId, block, spec: ctx.spec, image: items[i].page.image, formValues: {}, signal: ctx.signal });
    } catch {
      onPatch(i, { status: 'failed', error: 'other' });
      continue;
    }
    if (ctx.signal?.aborted) { onPatch(i, { status: 'waiting' }); return; }
    if (!res.success || !res.output) {
      onPatch(i, { status: 'failed', error: res.errorCode ?? 'other' });
      if (res.errorCode && STOPPING.has(res.errorCode)) return;
      continue;
    }
    onPatch(i, { status: 'read', source: res.source, fields: buildReviewFields(fields.ids, fields.defs, res, ctx.now) });
  }
}

/** The records the person approved and that are ready, with where each came from. */
export function chosenRecords(items: readonly BatchItem[]): Array<{ values: Record<string, RecordValue>; source: { name: string; page: number } }> {
  return items.filter(isSavable).map((i) => ({ values: recordValues(i.fields), source: { name: i.page.name, page: i.page.page } }));
}

/** Pages that still need the person before the batch can be added. */
export const attentionCount = (items: readonly BatchItem[]): number =>
  items.filter((i) => isIncluded(i)).reduce((n, i) => n + i.fields.filter(needsAttention).length, 0);
