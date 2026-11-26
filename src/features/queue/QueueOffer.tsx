import { Clock } from 'lucide-react-native';
import { useState } from 'react';

import { QueueError, type PendingOperation } from '@/core/queue';
import { Button, ConfirmSheet, useKalamTheme, useToast, type ButtonVariant } from '@/design';
import { useFormat, useT } from '@/i18n/react';

import { requestSends, type QueueRequest } from './actions';
import { getQueueActions } from './queue-service';
import { describeSendKeys } from './describe';

export interface QueueOfferProps {
  request: QueueRequest;
  /** Called once the task is stored on this device. */
  onQueued?: (op: PendingOperation) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}

/**
 * "Queue until online": shown where a cloud task failed because the device is offline. Pressing it opens a
 * short confirmation that says what will be sent when the task runs, then keeps the task on this device.
 * Nothing is sent now, and the task can be cancelled from the queue at any time.
 */
export function QueueOffer({ request, onQueued, variant = 'secondary', disabled }: QueueOfferProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const format = useFormat(theme.uiLanguage);
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const items = format.list(describeSendKeys(requestSends(request)).map((k) => t(k)));
  const confirm = async () => {
    try {
      const op = await getQueueActions().request(request);
      setOpen(false);
      toast.show({ message: t('queue.offer.done'), tone: 'success' });
      onQueued?.(op);
    } catch (error) {
      setOpen(false);
      toast.show({ message: t(error instanceof QueueError && error.code === 'queue_full' ? 'queue.offer.full' : 'queue.offer.failed'), tone: 'danger' });
    }
  };

  return (
    <>
      <Button label={t('queue.offer.button')} icon={Clock} variant={variant} disabled={disabled} onPress={() => setOpen(true)} testID="queue-offer" />
      <ConfirmSheet
        visible={open}
        title={t('queue.offer.title')}
        message={`${t('queue.offer.body')}\n\n${t('queue.sendsLine', { items })}`}
        confirmLabel={t('queue.offer.confirm')}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
