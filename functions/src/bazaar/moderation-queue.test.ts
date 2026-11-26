import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildQueue, countRequestSchema, listRequestSchema, reviewsView, statsRequestSchema, statsView, type ListingRow,
} from './moderation-queue.js';

const id = (n: number) => `l${String(n).padStart(19, 'a')}`;
const row = (n: number, o: Partial<ListingRow> = {}): ListingRow => ({
  id: id(n), title: `App ${n}`, makerName: 'Maker', status: 'published', price: 0, reviewed: false, featured: false,
  safetyVerdict: 'pass', safetyReasons: [], specVersion: 1, updatedAtMs: 1000 * n, ...o,
});
const report = (n: number, at: number, reason = 'spam', note = '') => ({ listingId: id(n), reason, note, createdAtMs: at });

test('queue: pending listings and reported listings, nothing else', () => {
  const q = buildQueue({
    listings: [row(1, { status: 'pending_review' }), row(2), row(3), row(4, { status: 'rejected' })],
    reports: [report(2, 10), report(2, 20, 'broken'), report(4, 5)],
    log: [],
  });
  assert.deepEqual(q.map((i) => [i.listingId, i.why]), [[id(2), 'reported'], [id(4), 'reported'], [id(1), 'pending']]);
  assert.equal(q[0]?.reports.total, 2);
  assert.deepEqual(q[0]?.reports.byReason, { spam: 1, broken: 1 });
});

test('queue: a decision closes the reports before it, a later report reopens', () => {
  const log = [{ listingId: id(2), action: 'approve', createdAtMs: 100 }];
  const closed = buildQueue({ listings: [row(2)], reports: [report(2, 50)], log });
  assert.equal(closed.length, 0);
  const reopened = buildQueue({ listings: [row(2)], reports: [report(2, 50), report(2, 150)], log });
  assert.equal(reopened[0]?.reports.total, 1);
  // Featuring or hiding a review is not a decision about the reports.
  const notClosing = buildQueue({ listings: [row(2)], reports: [report(2, 50)], log: [{ listingId: id(2), action: 'feature', createdAtMs: 100 }] });
  assert.equal(notClosing.length, 1);
});

test('queue: pending and reported is marked both; most reported first, then longest waiting', () => {
  const q = buildQueue({
    listings: [row(1, { status: 'pending_review', updatedAtMs: 5 }), row(2, { status: 'pending_review', updatedAtMs: 1 }), row(3)],
    reports: [report(1, 9), report(3, 9), report(3, 10)],
    log: [],
  });
  assert.deepEqual(q.map((i) => [i.listingId, i.why]), [[id(3), 'reported'], [id(1), 'both'], [id(2), 'pending']]);
});

test('queue: carries no reporter identity and clips text', () => {
  const q = buildQueue({
    listings: [row(1, { title: 'x'.repeat(500) })],
    reports: [{ ...report(1, 1, 'privacy', `  ${'n'.repeat(400)}  `), reporterUid: 'secret-uid' } as never],
    log: [],
  });
  const text = JSON.stringify(q);
  assert.equal(text.includes('secret-uid'), false);
  assert.equal(q[0]?.title.length, 120);
  assert.equal(q[0]?.reports.notes[0]?.length, 200);
});

test('queue: at most 50 items, at most 3 notes each', () => {
  const listings = Array.from({ length: 80 }, (_, n) => row(n + 1, { status: 'pending_review' }));
  assert.equal(buildQueue({ listings, reports: [], log: [] }).length, 50);
  const q = buildQueue({ listings: [row(1)], reports: [1, 2, 3, 4, 5].map((t) => report(1, t, 'spam', `note ${t}`)), log: [] });
  assert.equal(q[0]?.reports.notes.length, 3);
  assert.equal(q[0]?.reports.notes[0], 'note 5');
});

test('requests: strict and shaped', () => {
  assert.equal(listRequestSchema.safeParse({ kind: 'queue' }).success, true);
  assert.equal(listRequestSchema.safeParse({ kind: 'queue', extra: 1 }).success, false);
  assert.equal(listRequestSchema.safeParse({ kind: 'reviews' }).success, false);
  assert.equal(listRequestSchema.safeParse({ kind: 'reviews', listingId: 'nope' }).success, false);
  assert.equal(listRequestSchema.safeParse({ kind: 'reviews', listingId: id(1) }).success, true);
  assert.equal(countRequestSchema.safeParse({ listingId: id(1), kind: 'view' }).success, true);
  assert.equal(countRequestSchema.safeParse({ listingId: id(1), kind: 'install' }).success, false);
  assert.equal(countRequestSchema.safeParse({ listingId: id(1), kind: 'view', uid: 'x' }).success, false);
  assert.equal(statsRequestSchema.safeParse({ listingId: id(1) }).success, true);
});

test('reviews and stats views are clamped', () => {
  const r = reviewsView([{ uid: 'u', rating: 9, comment: 'a\n\nb', authorName: 'A', status: 'weird' }]);
  assert.deepEqual(r, [{ uid: 'u', rating: 5, comment: 'a b', authorName: 'A', status: 'visible' }]);
  assert.deepEqual(statsView(undefined, { installs: -3, likes: '4', ratingCount: 'x' }), { views: 0, previews: 0, installs: 0, likes: 4, ratings: 0 });
  assert.deepEqual(statsView({ views: 7.9, previews: 2 }, { installs: 1 }), { views: 7, previews: 2, installs: 1, likes: 0, ratings: 0 });
});
