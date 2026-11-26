import { describe, expect, it, vi } from 'vitest';

import en from '@/i18n/locales/en.json';

import { createModerationApi, type CallFn } from './api';
import {
  ACTION_KEY, actionKeyFor, actionsFor, defaultReason, ERROR_KEY, errorKind, filterQueue, isModeratorClaims, noteProblem,
  PICKABLE_REASONS, REASON_KEY, reasonFor, REPORT_REASON_KEY, SAFETY_KEY, stampFor, statusKeyFor, tintFor, type QueueItem,
} from './model';
import { createListingEventRecorder, DEDUPE_MS } from './recorder';

const LISTING = `l${'a'.repeat(19)}`;
const item = (o: Partial<QueueItem> = {}): QueueItem => ({
  listingId: LISTING, title: 'Daily expenses', makerName: 'Asha', status: 'pending_review', price: 0, reviewed: false, featured: false,
  safetyVerdict: 'unavailable', safetyReasons: [], specVersion: 1, updatedAtMs: 1, why: 'pending',
  reports: { total: 0, byReason: {}, notes: [] }, ...o,
});

/** Looks a dotted key up in the English catalogue. */
const has = (key: string): boolean => {
  let v: unknown = en;
  for (const part of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  return typeof v === 'string' || (typeof v === 'object' && v !== null && 'other' in v);
};

describe('what a moderator may do', () => {
  it('offers decisions that fit the listing state', () => {
    expect(actionsFor(item())).toEqual(['approve', 'reject', 'suspend']);
    expect(actionsFor(item({ status: 'rejected' }))).toEqual(['approve', 'suspend']);
    expect(actionsFor(item({ status: 'published' }))).toEqual(['approve', 'feature', 'reject', 'suspend']);
    expect(actionsFor(item({ status: 'published', featured: true }))).toEqual(['approve', 'unfeature', 'reject', 'suspend']);
    expect(actionsFor(item({ status: 'suspended' }))).toEqual(['unsuspend']);
  });
  it('lets a moderator clear the reports on a published listing, and says so on the button', () => {
    expect(actionsFor(item({ status: 'published', why: 'reported' }))).toContain('approve');
    expect(actionKeyFor('approve', item({ status: 'published' }))).toBe('bazaar.mod.action.keep');
    expect(actionKeyFor('approve', item())).toBe('bazaar.mod.action.approve');
    expect(actionKeyFor('feature', item({ status: 'published' }))).toBe('bazaar.mod.action.feature');
  });
  it('never offers approve on a listing its maker unpublished', () => {
    expect(actionsFor(item({ status: 'unpublished' }))).not.toContain('approve');
  });
  it('rejecting needs a note for the maker; everything else does not', () => {
    expect(noteProblem('reject', '')).toBe('required');
    expect(noteProblem('reject', '  ab ')).toBe('required');
    expect(noteProblem('reject', 'Remove the card number field.')).toBeNull();
    expect(noteProblem('approve', '')).toBeNull();
    expect(noteProblem('suspend', 'x'.repeat(501))).toBe('tooLong');
  });
  it('every decision starts with a reason the server accepts', () => {
    for (const a of ['approve', 'reject', 'suspend', 'unsuspend', 'feature', 'unfeature'] as const) {
      expect(PICKABLE_REASONS).toContain(defaultReason(a));
    }
    for (const a of ['hide_review', 'show_review'] as const) expect(PICKABLE_REASONS).toContain(defaultReason(a));
  });
  it('saves the usual reason for the decision when no chip was touched, and the picked one otherwise', () => {
    expect(reasonFor(null, 'approve')).toBe('policy_ok');
    expect(reasonFor(null, 'unsuspend')).toBe('policy_ok');
    expect(reasonFor(null, 'suspend')).toBe('harmful');
    expect(reasonFor(null, 'reject')).toBe('quality');
    expect(reasonFor(null, 'show_review')).toBe('policy_ok');
    expect(reasonFor('spam', 'approve')).toBe('spam');
    expect(reasonFor('privacy', 'hide_review')).toBe('privacy');
  });
  it('filters the queue', () => {
    const rows = [item(), item({ why: 'reported', status: 'published', reports: { total: 2, byReason: { spam: 2 }, notes: [] } }), item({ why: 'both', reports: { total: 1, byReason: { spam: 1 }, notes: [] } })];
    expect(filterQueue(rows, 'all')).toHaveLength(3);
    expect(filterQueue(rows, 'pending')).toHaveLength(2);
    expect(filterQueue(rows, 'reported')).toHaveLength(2);
  });
  it('stamps a listing by its state and tints its slip by why it is in the queue', () => {
    expect(stampFor(item({ status: 'published' }))).toBe('checked');
    expect(stampFor(item({ status: 'pending_review' }))).toBe('needs');
    expect(stampFor(item({ status: 'suspended' }))).toBe('needs');
    expect(stampFor(item({ status: 'rejected' }))).toBe('needs');
    expect(stampFor(item({ status: 'unpublished' }))).toBe('plain');
    expect([tintFor(item({ why: 'pending' })), tintFor(item({ why: 'reported' })), tintFor(item({ why: 'both' }))]).toEqual(['haldi', 'kraft', 'violet']);
  });
  it('trusts only a boolean true claim', () => {
    expect(isModeratorClaims({ kalamModerator: true })).toBe(true);
    for (const v of ['true', 1, 'yes', null, undefined]) expect(isModeratorClaims({ kalamModerator: v })).toBe(false);
    expect(isModeratorClaims(undefined)).toBe(false);
  });
});

describe('words', () => {
  it('every key the screens use exists in the English catalogue', () => {
    const keys = [
      ...Object.values(ACTION_KEY), ...Object.values(REASON_KEY), ...Object.values(REPORT_REASON_KEY), ...Object.values(ERROR_KEY),
      statusKeyFor(item()), statusKeyFor(item({ status: 'published', reviewed: true })),
      actionKeyFor('approve', item({ status: 'published' })), 'bazaar.mod.reason.auto',
      SAFETY_KEY('pass'), SAFETY_KEY('flagged'), SAFETY_KEY('x'),
      'bazaar.mod.title', 'bazaar.mod.lede', 'bazaar.mod.notAllowed.title', 'bazaar.mod.notAllowed.body', 'bazaar.mod.filter.all',
      'bazaar.mod.filter.pending', 'bazaar.mod.filter.reported', 'bazaar.mod.empty', 'bazaar.mod.emptyBody', 'bazaar.mod.loading', 'bazaar.mod.reports',
      'bazaar.mod.reportNotes', 'bazaar.mod.note.label', 'bazaar.mod.note.helper', 'bazaar.mod.note.required', 'bazaar.mod.saved',
      'bazaar.mod.reviews.title', 'bazaar.mod.reviews.none', 'bazaar.mod.reviews.hide', 'bazaar.mod.reviews.show',
      'bazaar.mod.reviews.hidden', 'bazaar.mod.reviews.stars', 'bazaar.mod.counts.line', 'bazaar.mod.counts.note',
      'bazaar.mod.share.label', 'bazaar.mod.share.hint', 'bazaar.report.reason.label', 'bazaar.by', 'bazaar.featured', 'common.refresh',
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });
  it('maps server codes to messages', () => {
    expect(errorKind('functions/permission-denied')).toBe('denied');
    expect(errorKind('functions/unauthenticated')).toBe('signIn');
    expect(errorKind('functions/not-found')).toBe('notDeployed');
    expect(errorKind('functions/unavailable')).toBe('offline');
    expect(errorKind('not_found')).toBe('gone');
    expect(errorKind('bad_request')).toBe('failed');
    expect(errorKind(undefined)).toBe('failed');
  });
});

describe('moderation api', () => {
  const fake = (reply: unknown): { call: CallFn; spy: ReturnType<typeof vi.fn> } => {
    const spy = vi.fn(async () => reply);
    return { call: spy as unknown as CallFn, spy };
  };

  it('returns the queue when the response fits the schema', async () => {
    const { call, spy } = fake({ ok: true, data: { items: [item()] } });
    const r = await createModerationApi(call).queue();
    expect(r).toEqual({ ok: true, data: [item()] });
    expect(spy).toHaveBeenCalledWith('kalamBazaarModerationList', { kind: 'queue' });
  });
  it('treats a response that does not fit as a failure, not as data', async () => {
    for (const data of [{ items: [{ ...item(), status: 'weird' }] }, { items: 'x' }, null, { items: [{ ...item(), listingId: 'bad' }] }]) {
      expect(await createModerationApi(fake({ ok: true, data }).call).queue()).toEqual({ ok: false, kind: 'failed' });
    }
  });
  it('carries the server error as one of our messages', async () => {
    const r = await createModerationApi(fake({ ok: false, message: 'x', code: 'functions/permission-denied' }).call).queue();
    expect(r).toEqual({ ok: false, kind: 'denied' });
  });
  it('sends a decision with its reason and a trimmed note', async () => {
    const { call, spy } = fake({ ok: true, data: { ok: true } });
    expect(await createModerationApi(call).decide(LISTING, 'reject', 'misleading', '  Remove the claim.  ')).toEqual({ ok: true, data: true });
    expect(spy).toHaveBeenCalledWith('kalamBazaarModerate', { action: 'reject', listingId: LISTING, reasonCode: 'misleading', note: 'Remove the claim.' });
  });
  it('hides and shows a review through the same audited action', async () => {
    const { call, spy } = fake({ ok: true, data: { ok: true } });
    const api = createModerationApi(call);
    await api.setReviewHidden(LISTING, 'u1', true, 'spam');
    await api.setReviewHidden(LISTING, 'u1', false, 'policy_ok');
    expect(spy.mock.calls.map((c) => (c[1] as { action: string }).action)).toEqual(['hide_review', 'show_review']);
  });
  it('parses a maker\'s numbers and refuses odd ones', async () => {
    const good = { views: 3, previews: 1, installs: 2, likes: 0, ratings: 0 };
    expect(await createModerationApi(fake({ ok: true, data: good }).call).stats(LISTING)).toEqual({ ok: true, data: good });
    expect(await createModerationApi(fake({ ok: true, data: { ...good, views: -1 } }).call).stats(LISTING)).toEqual({ ok: false, kind: 'failed' });
  });
});

describe('anonymous listing counts (client)', () => {
  const make = (enabled: boolean, send = vi.fn(async () => true)) => {
    let t = 1_000;
    const record = createListingEventRecorder({ enabled: async () => enabled, send, now: () => t });
    return { record, send, advance: (ms: number) => { t += ms; } };
  };

  it('sends nothing until the person shared view counts', async () => {
    const { record, send } = make(false);
    await record(LISTING, 'view');
    expect(send).not.toHaveBeenCalled();
  });
  it('counts one listing once per ten minutes, per kind', async () => {
    const { record, send, advance } = make(true);
    await Promise.all([record(LISTING, 'view'), record(LISTING, 'view')]);
    await record(LISTING, 'preview');
    expect(send).toHaveBeenCalledTimes(2);
    advance(DEDUPE_MS - 1);
    await record(LISTING, 'view');
    expect(send).toHaveBeenCalledTimes(2);
    advance(2);
    await record(LISTING, 'view');
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('turning the switch on later still counts the next visit', async () => {
    let on = false;
    const send = vi.fn(async () => true);
    const record = createListingEventRecorder({ enabled: async () => on, send, now: () => 5 });
    await record(LISTING, 'view');
    on = true;
    await record(LISTING, 'view');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('never throws, even when the send fails', async () => {
    const { record } = make(true, vi.fn(async () => { throw new Error('offline'); }));
    await expect(record(LISTING, 'view')).resolves.toBeUndefined();
  });
  it('sends only the listing id and the kind', async () => {
    const { record, send } = make(true);
    await record(LISTING, 'preview');
    expect(send).toHaveBeenCalledWith(LISTING, 'preview');
  });
});
