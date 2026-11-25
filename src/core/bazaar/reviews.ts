/**
 * Ratings and reviews (docs/12 §14, §16.6). One review per person per listing (doc id = uid), only
 * after an install or purchase, plain text only. Aggregates move in the same batch as the review
 * and firestore.rules checks the arithmetic, so clients cannot set arbitrary totals (§17.5, §20.2).
 */
import { z } from 'zod';

export const REVIEW_LIMITS = { comment: 500, response: 500 } as const;

/** No markup in review text: rules reject `<` and `>` too (§14.3). */
export const plainText = (max: number) =>
  z.string().max(max).refine((s) => !/[<>]/.test(s), 'Reviews cannot contain < or >.');

export const reviewSchema = z.object({
  uid: z.string().min(1).max(128),
  rating: z.number().int().min(1).max(5),
  comment: plainText(REVIEW_LIMITS.comment),
  authorName: z.string().max(40),
  appVersion: z.number().int().min(1),
  status: z.enum(['visible', 'hidden']),
  /** The maker's reply, kept apart from the reviewer's text (§14.4). */
  response: plainText(REVIEW_LIMITS.response).nullable(),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
});
export type BazaarReview = z.infer<typeof reviewSchema>;

export interface RatingAggregate { ratingSum: number; ratingCount: number; ratingAvg: number }

/** Average rounded to one decimal place, exactly as firestore.rules computes it. */
export const ratingAverage = (sum: number, count: number): number => (count === 0 ? 0 : Math.round((sum * 10) / count) / 10);

/**
 * New aggregate after a review is created (`before` null), changed, or deleted (`after` null).
 * Hidden reviews still count until a moderator recount (the trusted function owns that path).
 */
export function applyReviewChange(agg: Pick<RatingAggregate, 'ratingSum' | 'ratingCount'>, before: number | null, after: number | null): RatingAggregate {
  const ratingSum = agg.ratingSum - (before ?? 0) + (after ?? 0);
  const ratingCount = agg.ratingCount - (before === null ? 0 : 1) + (after === null ? 0 : 1);
  if (ratingSum < 0 || ratingCount < 0) throw new Error('Rating totals would go below zero');
  return { ratingSum, ratingCount, ratingAvg: ratingAverage(ratingSum, ratingCount) };
}

/** Plain-language form errors before sending. */
export function validateReviewInput(rating: number, comment: string): string | undefined {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose from 1 to 5 stars.';
  if (comment.trim().length > REVIEW_LIMITS.comment) return `Keep your review under ${REVIEW_LIMITS.comment} characters.`;
  if (/[<>]/.test(comment)) return 'Reviews cannot contain < or >.';
  return undefined;
}
