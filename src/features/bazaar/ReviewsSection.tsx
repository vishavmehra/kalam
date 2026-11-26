import { MessageSquareReply, Star, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { BazaarListing, BazaarReview } from '@/core/bazaar';
import type { BazaarReviewsView, KalamUser } from '@/core/contracts';
import { Button, Slip, Text, TextField, useKalamTheme, useToast } from '@/design';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';

import { ratingText } from './parts';

/**
 * Ratings and reviews (docs/12 §14): one per person, only after installing, plain text, maker replies apart.
 * Each review is an order-book slip (DIRECTION §6).
 */
export function ReviewsSection({ listing, user, online, onTotals }: {
  listing: BazaarListing;
  user: KalamUser | null;
  online: boolean;
  /** New totals after the person's own review changes, so the header stays in step. */
  onTotals?: (t: Pick<BazaarListing, 'ratingAvg' | 'ratingCount'>) => void;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
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

  const refreshTotals = async () => {
    const fresh = await bazaar.getListing(listing.id);
    if (fresh) onTotals?.(fresh.listing);
    await load();
  };
  const save = async () => {
    setBusy(true);
    const r = await bazaar.saveReview(listing, rating, comment);
    setBusy(false);
    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
    if (r.ok) await refreshTotals();
  };
  const remove = async () => {
    setBusy(true);
    const r = await bazaar.deleteReview(listing);
    setBusy(false);
    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
    if (r.ok) {
      setRating(0);
      setComment('');
      await refreshTotals();
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="h4">{t('bazaar.reviews.title')}</Text>
        <Text tone="secondary">{ratingText(t, listing)}</Text>
      </View>

      {!online ? <Text tone="secondary">{t('bazaar.reviews.offline')}</Text> : null}

      {online && view?.canReview && !isMaker ? (
        <Slip tint="carbon">
          <Text weight="semibold">{t(view.mine ? 'bazaar.reviews.yours' : 'bazaar.reviews.write')}</Text>
          <Stars value={rating} onChange={setRating} />
          <TextField
            label={t('bazaar.reviews.comment')}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            maxLength={500}
            helper={t('bazaar.reviews.commentHint')}
          />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button label={t(view.mine ? 'bazaar.reviews.update' : 'bazaar.reviews.post')} onPress={save} loading={busy} disabled={busy || rating === 0} />
            {view.mine ? <Button label={t('common.remove')} variant="ghost" icon={Trash2} onPress={remove} disabled={busy} /> : null}
          </View>
        </Slip>
      ) : null}
      {online && view && !view.canReview && !isMaker ? (
        <Text variant="bodySmall" tone="muted">{t(user ? 'bazaar.reviews.installFirst' : 'bazaar.reviews.signInFirst')}</Text>
      ) : null}

      {view?.reviews.length ? (
        <View style={{ gap: 12 }} role="list">
          {view.reviews.map((r) => (
            <ReviewRow key={r.uid} review={r} listingId={listing.id} canReply={isMaker && !r.response} onReplied={load} />
          ))}
        </View>
      ) : online && view ? (
        <Text tone="secondary">{t('bazaar.rating.none')}</Text>
      ) : null}
    </View>
  );
}

function ReviewRow({ review, listingId, canReply, onReplied }: { review: BazaarReview; listingId: string; canReply: boolean; onReplied: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <View role="listitem">
      <Slip tint="kraft">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text weight="semibold">{review.authorName || t('bazaar.reviews.someone')}</Text>
          <Stars value={review.rating} small />
          <Text variant="caption" tone="muted" mono>{relativeTime(review.updatedAt)}</Text>
        </View>
        {review.comment ? <Text>{review.comment}</Text> : null}
        {review.response ? (
          <View style={{ borderStartWidth: 3, borderColor: theme.colors.mark, paddingStart: 12, gap: 2 }}>
            <Text variant="caption" weight="semibold" tone="secondary">{t('bazaar.reviews.makerReply')}</Text>
            <Text tone="secondary">{review.response}</Text>
          </View>
        ) : null}
        {canReply ? (
          open ? (
            <View style={{ gap: 8 }}>
              <TextField label={t('bazaar.reviews.yourReply')} value={reply} onChangeText={setReply} multiline maxLength={500} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  label={t('bazaar.reviews.postReply')}
                  size="sm"
                  disabled={!reply.trim()}
                  onPress={async () => {
                    const r = await getServices().bazaar.respondToReview(listingId, review.uid, reply);
                    toast.show({ message: r.message, tone: r.ok ? 'success' : 'danger' });
                    if (r.ok) { setOpen(false); onReplied(); }
                  }}
                />
                <Button label={t('common.cancel')} size="sm" variant="ghost" onPress={() => setOpen(false)} />
              </View>
            </View>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label={t('bazaar.reviews.reply')} size="sm" variant="ghost" icon={MessageSquareReply} onPress={() => setOpen(true)} />
            </View>
          )
        ) : null}
      </Slip>
    </View>
  );
}

/** 1-5 stars. Interactive stars are a radio group with 48px targets; read-only stars are one label. */
export function Stars({ value, onChange, small }: { value: number; onChange?: (v: number) => void; small?: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const size = small ? 14 : 28;
  // Haldi is a fill colour; the outline uses haldi ink so an empty star still reads on paper.
  const star = (n: number) => (
    <Star key={n} size={size} color={theme.colors.accentInk} fill={n <= value ? theme.colors.accent : 'transparent'} />
  );
  if (!onChange) {
    return (
      <View accessibilityLabel={t('bazaar.reviews.starsOf', { count: value })} role="img" style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(star)}
      </View>
    );
  }
  return (
    <View role="radiogroup" accessibilityLabel={t('bazaar.listing.rating')} style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          role="radio"
          aria-checked={value === n}
          accessibilityLabel={t('bazaar.reviews.stars', { count: n })}
          onPress={() => onChange(n)}
          style={{ width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.press }}
        >
          {star(n)}
        </Pressable>
      ))}
    </View>
  );
}
