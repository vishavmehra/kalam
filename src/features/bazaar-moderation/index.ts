/**
 * Bazaar moderation and listing counts (docs/12 §14.5, §18.2-18.4, §21).
 *
 * Mount points:
 *   route      src/app/bazaar/moderation.tsx  ->  <ModerationScreen />
 *   link       Bazaar home header actions      ->  <ModeratorLink />   (renders nothing for non-moderators)
 *   maker      Creator Studio listing row      ->  <ListingCountsLine listingId={l.id} />
 *   settings   Settings, privacy section       ->  <ShareViewsRow />    (and `clearShareViews()` in "delete all data")
 *   listing    ListingScreen, with the other hooks ABOVE the `state.kind !== 'ready'` early return, using the `id` prop
 *              (`listing` does not exist yet there):
 *                useEffect(() => { void recordListingEvent(id, 'view'); }, [id]);
 *              The server counts only published listings, so an id that is missing or unpublished is ignored.
 *   preview    Preview component, which receives `listing` as a prop:
 *                useEffect(() => { void recordListingEvent(listing.id, 'preview'); }, [listing.id]);
 */
export { ListingCountsLine } from './ListingCountsLine';
export { ModerationScreen } from './ModerationScreen';
export { ModeratorLink } from './ModeratorLink';
export { ShareViewsRow } from './ShareViewsRow';
export { clearShareViews, getShareViews, setShareViews, useShareViews } from './consent';
export { recordListingEvent } from './listing-events';
export { moderationRoute } from './routes';
