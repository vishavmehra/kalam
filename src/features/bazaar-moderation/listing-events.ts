import { createListingEventRecorder } from './recorder';
import { moderationApi } from './client';
import { getShareViews } from './consent';

/**
 * `recordListingEvent(id, 'view')` when a listing page opens (use the `id` prop, above the early return),
 * `recordListingEvent(listing.id, 'preview')` when the sandbox preview starts.
 * Safe to call from an effect: it never throws, never waits for the screen, and does nothing unless the person
 * shared view counts.
 */
export const recordListingEvent = createListingEventRecorder({
  enabled: getShareViews,
  send: (id, kind) => moderationApi.count(id, kind),
});
