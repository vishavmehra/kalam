/** Says, before building, what Kalam cannot send this time (docs/06 §13.3). Renders nothing otherwise. */
import { Text } from '@/design';
import { useHandoffNotice } from './create-bridge';

export function HandoffNotice() {
  const notice = useHandoffNotice();
  return notice ? <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">{notice}</Text> : null;
}
