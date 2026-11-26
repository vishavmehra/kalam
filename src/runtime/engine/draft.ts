/**
 * Unsent form draft (docs/09 §15.5 "persist critical data before the app is suspended"). Android may kill a
 * backgrounded app, and what was typed but not yet saved lives only in RuntimeState. This keeps the typed
 * values (and the screens being used) in the app's own key-value state, on this device, so the next open
 * can bring them back. It never holds a saved entry: those are written the moment they are saved.
 *
 * Kept small on purpose: the state table holds at most 5000 characters per value, so a draft over 4800
 * keeps only the current screen, and one still too big is not kept (the person keeps typing; nothing breaks).
 * The stored text is untrusted on the way back in (a backup or an old version may hold anything): it is parsed,
 * and only screens and fields that exist in the app, with plain values, are restored.
 * Pure TypeScript.
 */
import { z } from 'zod';
import { DRAFT_STATE_KEY } from '@/core/backup/schemas';
import type { KeyValueRepository, RecordValue } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { screenFieldDefs } from './fields';
import { findScreen } from './state';
import type { FormValues, RuntimeState } from './types';

/** Key in the app's key-value state. Reserved in the spec schema, so no counter can take it. */
export const DRAFT_KEY = DRAFT_STATE_KEY;
const MAX_CHARS = 4_800;
const MAX_TEXT = 500;

const stored = z.object({
  v: z.literal(1),
  stack: z.array(z.string().max(48)).max(32),
  forms: z.record(z.string().max(48), z.record(z.string().max(48), z.union([z.string().max(MAX_TEXT), z.number().finite(), z.boolean()]))),
});

const empty = (v: RecordValue | undefined) => v === undefined || v === null || v === '';

/** What to keep for this state, as text, or '' when nothing typed is waiting. */
export function draftOf(spec: KalamSpec, state: RuntimeState): string {
  const forms: Record<string, Record<string, string | number | boolean>> = {};
  for (const [screenId, form] of Object.entries(state.forms)) {
    const screen = findScreen(spec, screenId);
    if (!screen) continue;
    const defs = screenFieldDefs(spec, screen);
    const kept: Record<string, string | number | boolean> = {};
    for (const [field, value] of Object.entries(form)) {
      if (!defs[field] || empty(value)) continue;
      kept[field] = typeof value === 'string' ? value.slice(0, MAX_TEXT) : (value as number | boolean);
    }
    if (Object.keys(kept).length) forms[screenId] = kept;
  }
  if (!Object.keys(forms).length) return '';
  const current = state.stack[state.stack.length - 1];
  const text = JSON.stringify({ v: 1, stack: state.stack, forms });
  if (text.length <= MAX_CHARS) return text;
  const only = forms[current] ? JSON.stringify({ v: 1, stack: [current], forms: { [current]: forms[current] } }) : '';
  return only.length <= MAX_CHARS ? only : '';
}

/** The state to resume from, or undefined when there is no usable draft. */
export function restoreDraft(spec: KalamSpec, raw: unknown): Pick<RuntimeState, 'stack' | 'forms'> | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  let parsed: z.infer<typeof stored>;
  try {
    const r = stored.safeParse(JSON.parse(raw));
    if (!r.success) return undefined;
    parsed = r.data;
  } catch {
    return undefined;
  }
  const forms: Record<string, FormValues> = {};
  for (const [screenId, form] of Object.entries(parsed.forms)) {
    const screen = findScreen(spec, screenId);
    if (!screen) continue;
    const defs = screenFieldDefs(spec, screen);
    const kept: FormValues = {};
    for (const [field, value] of Object.entries(form)) if (Object.hasOwn(defs, field)) kept[field] = value;
    if (Object.keys(kept).length) forms[screenId] = kept;
  }
  if (!Object.keys(forms).length) return undefined;
  const stack = parsed.stack.length && parsed.stack.every((id) => findScreen(spec, id)) ? parsed.stack : [spec.initialScreen];
  return { stack, forms };
}

/**
 * Reads and writes the draft of one app. Call `load()` once when the app opens (it also learns what is already
 * stored), then `save(state)` when the app is suspended and after a save of an entry. A save that would write
 * the same text is skipped, so calling it often is cheap. A failed write is swallowed: a draft is a courtesy.
 */
export function createDraftKeeper(kv: Pick<KeyValueRepository, 'all' | 'set'>, appId: string, spec: () => KalamSpec) {
  let last = '';
  return {
    async load(): Promise<Pick<RuntimeState, 'stack' | 'forms'> | undefined> {
      try {
        const raw = (await kv.all(appId))[DRAFT_KEY];
        last = typeof raw === 'string' ? raw : '';
        return restoreDraft(spec(), raw);
      } catch {
        return undefined;
      }
    },
    async save(state: RuntimeState): Promise<void> {
      const next = draftOf(spec(), state);
      if (next === last) return;
      try {
        await kv.set(appId, DRAFT_KEY, next);
        last = next;
      } catch {
        // Storage full or closing: keep going.
      }
    },
  };
}
