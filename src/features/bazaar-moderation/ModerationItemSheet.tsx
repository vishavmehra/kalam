import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, Sheet, Stamp, Surface, Text, TextField, useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';

import { moderationApi } from './client';
import {
  actionKeyFor, actionsFor, ERROR_KEY, NOTE_MAX, noteProblem, PICKABLE_REASONS, REASON_KEY, reasonFor, REPORT_REASON_KEY,
  SAFETY_KEY, stampFor, statusKeyFor, type ModAction, type ModReview, type QueueItem, type ReasonCode,
} from './model';

/**
 * One listing in the queue: why it is here, then the decision with its reason and note, then its reviews.
 * Every decision goes through the trusted function, which writes the audit entry (docs/12 §18.4).
 */
export function ModerationItemSheet({ item, onClose, onChanged }: {
  item: QueueItem | null;
  onClose: () => void;
  /** Called after a decision is saved, so the queue reloads. */
  onChanged: () => void;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  /** What the moderator picked; `null` until a chip is touched, then each decision saves its usual reason. */
  const [picked, setPicked] = useState<ReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ModReview[] | null>(null);
  const id = item?.listingId;

  const loadReviews = useCallback(async () => {
    if (!id) return;
    const r = await moderationApi.reviews(id);
    setReviews(r.ok ? r.data : []);
  }, [id]);

  useEffect(() => {
    setNote(''); setPicked(null); setReviews(null);
    if (id) void loadReviews();
  }, [id, loadReviews]);

  if (!item) return <Sheet visible={false} onClose={onClose} title="" />;

  const problem = (a: ModAction) => noteProblem(a, note);
  const done = (r: { ok: true } | { ok: false; kind: keyof typeof ERROR_KEY }) =>
    toast.show(r.ok ? { message: t('bazaar.mod.saved'), tone: 'success' } : { message: t(ERROR_KEY[r.kind]), tone: 'danger' });

  const decide = async (a: ModAction) => {
    if (problem(a)) return;
    setBusy(a);
    const r = await moderationApi.decide(item.listingId, a, reasonFor(picked, a), note);
    setBusy(null);
    done(r);
    if (r.ok) { onChanged(); onClose(); }
  };
  const toggleReview = async (rv: ModReview) => {
    setBusy(rv.uid);
    const hiding = rv.status === 'visible';
    const r = await moderationApi.setReviewHidden(item.listingId, rv.uid, hiding, reasonFor(picked, hiding ? 'hide_review' : 'show_review'), note);
    setBusy(null);
    done(r);
    if (r.ok) await loadReviews();
  };

  return (
    <Sheet visible onClose={onClose} title={item.title} description={t('bazaar.by', { name: item.makerName })} maxWidth={640} dismissible={busy === null}>
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Stamp kind={stampFor(item)} label={t(statusKeyFor(item))} />
          {item.featured ? <Stamp kind="plain" icon={null} label={t('bazaar.featured')} /> : null}
        </View>

        <Surface tone="alt" padded style={{ gap: 6 }}>
          <Text weight="semibold">{t(SAFETY_KEY(item.safetyVerdict))}</Text>
          {item.safetyReasons.map((r, i) => <Text key={i} variant="bodySmall" tone="secondary">{r}</Text>)}
        </Surface>

        {item.reports.total > 0 ? (
          <View style={{ gap: 8 }}>
            <Text weight="semibold">{t('bazaar.mod.reports', { count: item.reports.total })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(item.reports.byReason).map(([why, n]) => (
                <Chip key={why} label={`${REPORT_REASON_KEY[why] ? t(REPORT_REASON_KEY[why]) : why} ${n}`} tone="warning" />
              ))}
            </View>
            {item.reports.notes.length ? <Text variant="caption" tone="muted">{t('bazaar.mod.reportNotes')}</Text> : null}
            {item.reports.notes.map((n, i) => <Text key={i} variant="bodySmall" tone="secondary">{n}</Text>)}
          </View>
        ) : null}

        <View role="radiogroup" aria-label={t('bazaar.report.reason.label')} style={{ gap: 8 }}>
          <Text weight="semibold">{t('bazaar.report.reason.label')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PICKABLE_REASONS.map((r) => (
              <Chip key={r} label={t(REASON_KEY[r])} role="radio" selected={picked === r} onPress={() => setPicked(r)} />
            ))}
          </View>
          {picked === null ? <Text variant="caption" tone="muted">{t('bazaar.mod.reason.auto')}</Text> : null}
        </View>

        <TextField
          label={t('bazaar.mod.note.label')}
          helper={t('bazaar.mod.note.helper')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={NOTE_MAX}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {actionsFor(item).map((a) => (
            <Button
              key={a}
              label={t(actionKeyFor(a, item))}
              variant={a === 'approve' || a === 'unsuspend' ? 'primary' : a === 'reject' || a === 'suspend' ? 'destructive' : 'outline'}
              loading={busy === a}
              disabled={busy !== null || problem(a) !== null}
              onPress={() => void decide(a)}
            />
          ))}
        </View>
        {actionsFor(item).includes('reject') && problem('reject') === 'required' && note.length > 0 ? (
          <Text variant="caption" tone="muted">{t('bazaar.mod.note.required')}</Text>
        ) : null}

        <View style={{ gap: 10 }}>
          <Text variant="h3">{t('bazaar.mod.reviews.title')}</Text>
          {reviews === null ? <Text tone="secondary">{t('bazaar.mod.loading')}</Text> : null}
          {reviews?.length === 0 ? <Text tone="secondary">{t('bazaar.mod.reviews.none')}</Text> : null}
          {reviews?.map((rv) => (
            <Surface key={rv.uid} tone="alt" padded style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Text weight="semibold">{rv.authorName || '-'}</Text>
                <Text variant="caption" tone="muted">{t('bazaar.mod.reviews.stars', { count: rv.rating })}</Text>
                {rv.status === 'hidden' ? <Stamp kind="needs" size="sm" label={t('bazaar.mod.reviews.hidden')} /> : null}
              </View>
              {rv.comment ? <Text variant="bodySmall">{rv.comment}</Text> : null}
              <View style={{ alignSelf: 'flex-start' }}>
                <Button
                  label={t(rv.status === 'visible' ? 'bazaar.mod.reviews.hide' : 'bazaar.mod.reviews.show')}
                  variant="outline"
                  size="sm"
                  loading={busy === rv.uid}
                  disabled={busy !== null}
                  onPress={() => void toggleReview(rv)}
                />
              </View>
            </Surface>
          ))}
        </View>
      </View>
    </Sheet>
  );
}
