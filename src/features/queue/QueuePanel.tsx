import { CircleX, ExternalLink, RefreshCw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { languageLabel } from '@/core/i18n-labels';
import { QueueError, type PendingOperation } from '@/core/queue';
import { Button, EmptyState, OfflineIcon, PageIllustration, Stamp, Surface, Text, useKalamTheme, useToast, type StampKind } from '@/design';
import { useFormat, useT } from '@/i18n/react';

import { describeOperation } from './describe';
import { getOperationQueue, openQueuedBuild } from './queue-service';
import { useAppNames, useQueueOnline, useQueueOps } from './use-queue';

/** The stamp for a task's state: done is Checked, a stopped task Needs check, everything else plain. */
const STAMP: Record<ReturnType<typeof describeOperation>['tone'], StampKind> = {
  neutral: 'plain', info: 'plain', success: 'checked', warning: 'needs', danger: 'needs',
};

export interface QueuePanelProps {
  /** Called after a finished build is handed to the review screen. */
  onOpenReview: () => void;
  onOpenApp: (appId: string) => void;
}

/**
 * Every queued task, with where it stands and what each can do: cancel while it waits or runs, try again
 * after it stopped, open a finished result, remove a finished row. Works offline: it only reads this device.
 */
export function QueuePanel({ onOpenReview, onOpenApp }: QueuePanelProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const ops = useQueueOps();
  const online = useQueueOnline();
  const names = useAppNames(ops);
  if (!ops.length) {
    return <EmptyState title={t('queue.empty.title')} description={t('queue.empty.body')} illustration={<PageIllustration width={104} />} />;
  }
  return (
    <View style={{ gap: theme.space[4] }} testID="queue-panel">
      <Text tone="secondary">{t('queue.intro')}</Text>
      <View accessibilityRole="list" style={{ gap: theme.space[3] }}>
        {ops.map((op) => (
          <QueueRow key={op.id} op={op} online={online} appName={op.appId ? names[op.appId] : undefined} onOpenReview={onOpenReview} onOpenApp={onOpenApp} />
        ))}
      </View>
    </View>
  );
}

function QueueRow({ op, online, appName, onOpenReview, onOpenApp }: { op: PendingOperation; online: boolean; appName?: string } & QueuePanelProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const format = useFormat(theme.uiLanguage);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const view = describeOperation(op, online);
  const queue = getOperationQueue();
  const title = t(view.title, {
    app: appName ?? t('queue.unknownApp'),
    language: languageLabel(typeof op.params.lang === 'string' ? op.params.lang : undefined),
  });
  const status = t(view.status);

  /** Runs one action, then says plainly if the row had already moved on. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!(error instanceof QueueError) || error.code !== 'not_found') toast.show({ message: t('queue.action.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const open = () =>
    run(async () => {
      if (view.open === 'app' && op.appId) return onOpenApp(op.appId);
      const outcome = await openQueuedBuild(op);
      if (outcome === 'opened') onOpenReview();
      else toast.show({ message: t(outcome === 'busy' ? 'queue.open.busy' : 'queue.open.unavailable'), tone: 'danger' });
    });

  return (
    <Surface bordered radius="paper" padded style={{ gap: theme.space[3] }} accessibilityRole="summary" accessibilityLabel={`${title}, ${status}`} testID={`queue-row-${op.kind}`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
        <Text variant="h4" level={3} style={{ flexShrink: 1 }}>{title}</Text>
        {/* Words and an icon for where it stands. Waiting for a signal is normal, so it is graphite with the no-signal mark, not a warning. */}
        <Stamp kind={STAMP[view.tone]} label={status} size="sm" {...(view.tone === 'neutral' && !online ? { icon: OfflineIcon } : {})} />
      </View>
      <View accessibilityLiveRegion="polite" style={{ gap: theme.space[1] }}>
        <Text variant="bodySmall">{t(view.detail.key, view.detail.params)}</Text>
        {view.problem ? <Text variant="bodySmall" tone="danger">{t(view.problem)}</Text> : null}
        {view.sends.length ? (
          <Text variant="bodySmall" tone="secondary">{t('queue.sendsLine', { items: format.list(view.sends.map((k) => t(k))) })}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {view.open ? <Button label={t(view.open === 'review' ? 'queue.action.openReview' : 'queue.action.openApp')} icon={ExternalLink} size="sm" onPress={open} loading={busy} /> : null}
        {view.canRetry ? <Button label={t('queue.action.retry')} icon={RefreshCw} size="sm" variant="secondary" onPress={() => run(() => queue.retry(op.id))} loading={busy} /> : null}
        {view.canCancel ? <Button label={t('queue.action.cancel')} icon={CircleX} size="sm" variant="outline" onPress={() => run(() => queue.cancel(op.id))} loading={busy} /> : null}
        {view.canRemove ? <Button label={t('queue.action.dismiss')} icon={Trash2} size="sm" variant="ghost" onPress={() => run(() => queue.dismiss(op.id))} loading={busy} /> : null}
      </View>
    </Surface>
  );
}
