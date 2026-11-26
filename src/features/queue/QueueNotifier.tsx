import { useEffect, useRef } from 'react';

import { useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';

import { useQueueOps } from './use-queue';

/**
 * Says so when a queued task finishes or stops while the person is in the app. Renders nothing. Rows that
 * were already finished when the app opened stay quiet: they show in the queue and the pill.
 */
export function QueueNotifier() {
  const t = useT(useKalamTheme().uiLanguage);
  const toast = useToast();
  const ops = useQueueOps();
  const before = useRef<Map<string, string> | undefined>(undefined);
  useEffect(() => {
    const previous = before.current;
    before.current = new Map(ops.map((o) => [o.id, o.status]));
    if (!previous) return;
    const was = (id: string) => previous.get(id);
    const finished = ops.some((o) => was(o.id) && was(o.id) !== o.status && o.status === 'completed');
    const stopped = ops.some((o) => was(o.id) && was(o.id) !== o.status && o.status === 'failed');
    if (finished) toast.show({ message: t('queue.toast.done'), tone: 'success' });
    if (stopped) toast.show({ message: t('queue.toast.failed'), tone: 'danger' });
  }, [ops, t, toast]);
  return null;
}
