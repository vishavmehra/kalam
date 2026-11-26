import { ImagePlus } from 'lucide-react-native';
import { useState } from 'react';

import type { AIImage } from '@/core/contracts';
import type { PendingOperation } from '@/core/queue';
import { Button, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { aiOffer, type AiOfferStep } from './ai-offer';
import { QueueOffer } from './QueueOffer';

export interface QueueAiOfferProps extends AiOfferStep {
  /** Opens the picture picker (the runtime's `services.pickImage`). Needed for photo steps with no picture yet. */
  pickImage?: () => Promise<AIImage | undefined>;
  onQueued?: (op: PendingOperation) => void;
}

/**
 * Shown where an AI step reported that the device is offline. A text step offers to queue the typed text.
 * A photo step first asks the person to choose the picture, because offline the runtime never opened the
 * picker. Renders nothing when there is nothing to send. Nothing leaves the device until the person confirms
 * the offer and the queue runs it online, after it re-checks consent.
 */
export function QueueAiOffer({ pickImage, onQueued, ...step }: QueueAiOfferProps) {
  const t = useT(useKalamTheme().uiLanguage);
  const [picked, setPicked] = useState<AIImage | undefined>();
  const offer = aiOffer({ ...step, image: step.image ?? picked });
  if (offer.state === 'ready') return <QueueOffer request={offer.request} onQueued={onQueued} />;
  if (offer.state === 'needsPicture' && pickImage) {
    return (
      <Button
        label={t('queue.offer.pickPhoto')}
        icon={ImagePlus}
        variant="secondary"
        onPress={() => void pickImage().then((img) => img && setPicked(img), () => undefined)}
        testID="queue-offer-pick"
      />
    );
  }
  return null;
}
