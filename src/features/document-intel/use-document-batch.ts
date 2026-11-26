/**
 * State of one Document Intelligence batch (docs/14 §9.6): pick pages, read them one at a time with
 * progress and a stop button, let the person fix and approve records, then hand the approved ones to the
 * caller. All the rules live in core/document-intel; this only holds the list and the abort handle.
 * Pages are dropped from memory on `reset`, which the sheet calls on close and after adding.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyPatch, chosenRecords, confirmField, editField, markDuplicates, MAX_DOC_PAGES, newBatch, readPages, summarize, takeSuggestion, type BatchItem, type ReviewField,
} from '@/core/document-intel';
import type { AIBlockService, RecordValue } from '@/core/contracts';
import type { KalamField, KalamSpec } from '@/core/spec/schema';
import { toMediaError } from '@/core/media/errors';
import { photoFields } from '@/core/tasks/ai-block-service';

import { pickPages, type PickNote } from './pick-pages';

export interface DocumentBatchOptions {
  spec: KalamSpec;
  appId: string;
  /** An extractFromPhoto step. */
  blockId: string;
  /** `services.runAIBlock`: goes through the AI orchestrator, so routing, consent and App Check all apply. */
  runAIBlock: AIBlockService['run'];
  /** Values of records already in the target list, to spot repeats. */
  existing?: ReadonlyArray<Readonly<Record<string, RecordValue>>>;
}

export function useDocumentBatch({ spec, appId, blockId, runAIBlock, existing }: DocumentBatchOptions) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [notes, setNotes] = useState<PickNote[]>([]);
  const [busy, setBusy] = useState<'picking' | 'reading' | undefined>();
  const abort = useRef<AbortController | undefined>(undefined);
  const existingRef = useRef(existing);
  useEffect(() => { existingRef.current = existing; }, [existing]);
  // The list grew (records were just added): pages still on screen that repeat them are marked again.
  // State adjusted while rendering, the way React asks for a change that follows a prop.
  const [seenExisting, setSeenExisting] = useState(existing);
  if (seenExisting !== existing) {
    setSeenExisting(existing);
    setItems((cur) => (cur.length ? markDuplicates(cur, existing) : cur));
  }

  const block = spec.aiBlocks[blockId];
  const defs = useMemo<Record<string, KalamField>>(
    () => (block?.kind === 'extractFromPhoto' ? photoFields(spec, block)?.defs ?? {} : {}),
    [spec, block],
  );

  /** Reads everything still waiting or failed. Edits made meanwhile are kept: each result is a patch on the latest list. */
  const read = useCallback(async (list: BatchItem[]) => {
    const ac = new AbortController();
    abort.current = ac;
    setBusy('reading');
    try {
      await readPages(
        list,
        { service: { run: runAIBlock }, spec, blockId, appId, now: new Date(), existing: existingRef.current, signal: ac.signal },
        (i, patch) => setItems((cur) => applyPatch(cur, i, patch, existingRef.current)),
      );
    } finally {
      if (abort.current === ac) abort.current = undefined;
      setBusy(undefined);
    }
  }, [runAIBlock, spec, blockId, appId]);

  const add = useCallback(async (from: 'files' | 'camera') => {
    setBusy('picking');
    let next = items;
    try {
      const picked = await pickPages(from, MAX_DOC_PAGES - items.length);
      setNotes(picked.notes);
      next = [...items, ...newBatch(picked.pages)];
      setItems(next);
    } catch (e) {
      setNotes([{ kind: 'file', name: '', reason: toMediaError(e, 'FILE_CORRUPTED').message }]);
    }
    setBusy(undefined);
    if (next.length > items.length) void read(next);
  }, [items, read]);

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    setItems([]);
    setNotes([]);
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const change = (index: number, patch: (i: BatchItem) => Partial<BatchItem>) =>
    setItems((cur) => applyPatch(cur, index, patch(cur[index]), existingRef.current));
  const fieldsOf = (index: number, fn: (f: ReviewField[]) => ReviewField[]) => change(index, (i) => ({ fields: fn(i.fields) }));

  return {
    items,
    notes,
    busy,
    summary: summarize(items),
    room: MAX_DOC_PAGES - items.length,
    add,
    /** Read what is left: waiting pages and the ones that failed. */
    retry: () => void read(items),
    stop,
    reset,
    include: (index: number, on: boolean) => change(index, () => ({ accepted: on })),
    type: (index: number, id: string, text: string) => fieldsOf(index, (f) => editField(f, id, text, defs, new Date())),
    confirm: (index: number, id: string) => fieldsOf(index, (f) => confirmField(f, id)),
    takeDate: (index: number, id: string) => fieldsOf(index, (f) => takeSuggestion(f, id, defs, new Date())),
    clear: (index: number, id: string) => fieldsOf(index, (f) => editField(f, id, '', defs, new Date())),
    /** The approved, ready records. Nothing is saved until the caller does it. */
    chosen: () => chosenRecords(items),
    /** Lets go of the pages that were just added; every other page, and the person's edits on it, stays. */
    drop: (ids: ReadonlySet<string>) => setItems((cur) => markDuplicates(cur.filter((i) => !ids.has(i.page.id)), existingRef.current)),
  };
}
