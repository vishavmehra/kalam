import { MessageSquareReply, Star, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { relativeTime } from '@/components/format';
import type { BazaarListing, BazaarReview } from '@/core/bazaar';
import type { BazaarReviewsView, KalamUser } from '@/core/contracts';
import { Button, Surface, Text, TextField, useKalamTheme, useToast } from '@/design';
import { getServices } from '@/services';

import { ratingLabel } from './ListingCard';

/** Ratings and reviews (docs/12 §14): one per person, only after installing, plain text, maker replies apart. */
export function ReviewsSection({ listing, user, online, onTotals }: {
  listing: BazaarListing;
  user: KalamUser | null;
  online: boolean;
  /** New totals after the person's own review changes, so the header stays in step. */
  onTotals?: (t: Pick<BazaarListing, 'ratingAvg' | 'ratingCount'>) => void;
}) {
  const bazaar = getServices().bazaar;
  const toast = useToast();
  const [view, setView] = useState<BazaarReviewsView | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const isMaker = !!user && user.uid === listing.makerUid;

  const load = useCallback(async () => {
    if (!online) return;
    const v = await bazaar.reviews(listing.id);
    setView(v);
    if (v.mine) { setRating(v.mine.rating); setComment(v.mine.comment); }
  }, [bazaar, listing.id, online]);
  useEffect(() => { void load(); }, [load, user?.uid]);

  const save = async () => {
    setBusy(true);
    const r = await bazaar.saveReview(listing, rating, comment);
    setBusy(false);
    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
    if (r.ok) {
      const fresh = await bazaar.getListing(listing.id);
      if (fresh) onTotals?.(fresh.listing);
      await load();
    }
  };
  const remove = async () => {
    setBusy(true);
    const r = await bazaar.deleteReview(listing);
    setBusy(false);
    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
    if (r.ok) {
      setRating(0);
      setComment('');
      const fresh = await bazaar.getListing(listing.id);
      if (fresh) onTotals?.(fresh.listing);
      await load();
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="h4">Ratings and reviews</Text>
        <Text tone="secondary">{ratingLabel(listing)}</Text>
      </View>

      {!online ? <Text tone="secondary">Reviews need a connection.</Text> : null}

      {online && view?.canReview && !isMaker ? (
        <Surface tone="alt" padded={16} style={{ gap: 12 }}>
          <Text weight="semibold">{view.mine ? 'Your review' : 'Write a review'}</Text>
          <Stars value={rating} onChange={setRating} />
          <TextField
            label="What did you think? (optional)"
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            maxLength={500}
            helper="Plain text only. Your name from your account is shown with it."
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button label={view.mine ? 'Update review' : 'Post review'} onPress={save} loading={busy} disabled={busy || rating === 0} />
            {view.mine ? <Button label="Remove" variant="ghost" icon={Trash2} onPress={remove} disabled={busy} /> : null}
          </View>
        </Surface>
      ) : null}
      {online && view && !view.canReview && !isMaker ? (
        <Text variant="bodySmall" tone="muted">
          {user ? 'Install this app to review it.' : 'Sign in and install this app to review it.'}
        </Text>
      ) : null}

      {view?.reviews.length ? (
        <View style={{ gap: 10 }} role="list">
          {view.reviews.map((r) => (
            <ReviewRow key={r.uid} review={r} listingId={listing.id} canReply={isMaker && !r.response} onReplied={load} />
          ))}
        </View>
      ) : online && view ? (
        <Text tone="secondary">No reviews yet.</Text>
      ) : null}
    </View>
  );
}

function ReviewRow({ review, listingId, canReply, onReplied }: { review: BazaarReview; listingId: string; canReply: boolean; onReplied: () => void }) {
  const theme = useKalamTheme();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Surface padded={16} style={{ gap: 8 }} role="listitem">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text weight="semibold">{review.authorName || 'Kalam user'}</Text>
        <Stars value={review.rating} small />
        <Text variant="caption" tone="muted">{relativeTime(review.updatedAt)}</Text>
      </View>
      {review.comment ? <Text>{review.comment}</Text> : null}
      {review.response ? (
        <View style={{ borderLeftWidth: 3, borderColor: theme.colors.border, paddingLeft: 12, gap: 2 }}>
          <Text variant="caption" weight="semibold" tone="secondary">Reply from the maker</Text>
          <Text tone="secondary">{review.response}</Text>
        </View>
      ) : null}
      {canReply ? (
        open ? (
          <View style={{ gap: 8 }}>
            <TextField label="Your reply" value={reply} onChangeText={setReply} multiline maxLength={500} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                label="Post reply"
                size="sm"
                disabled={!reply.trim()}
                onPress={async () => {
                  const r = await getServices().bazaar.respondToReview(listingId, review.uid, reply);
                  toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
                  if (r.ok) { setOpen(false); onReplied(); }
                }}
              />
              <Button label="Cancel" size="sm" variant="ghost" onPress={() => setOpen(false)} />
            </View>
          </View>
        ) : (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button label="Reply" size="sm" variant="ghost" icon={MessageSquareReply} onPress={() => setOpen(true)} />
          </View>
        )
      ) : null}
    </Surface>
  );
}

/** 1-5 stars. Interactive stars are a radio group with 48px targets; read-only stars are one label. */
export function Stars({ value, onChange, small }: { value: number; onChange?: (v: number) => void; small?: boolean }) {
  const theme = useKalamTheme();
  const size = small ? 14 : 28;
  const star = (n: number) => (
    <Star key={n} size={size} color={theme.colors.accent} fill={n <= value ? theme.colors.accent : 'transparent'} />
  );
  if (!onChange) {
    return (
      <View accessibilityLabel={`${value} out of 5 stars`} role="img" style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(star)}
      </View>
    );
  }
  return (
    <View role="radiogroup" accessibilityLabel="Rating" style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          role="radio"
          aria-checked={value === n}
          accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`}
          onPress={() => onChange(n)}
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          {star(n)}
        </Pressable>
      ))}
    </View>
  );
}
