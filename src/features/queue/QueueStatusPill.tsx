import { Check, CloudOff, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Chip, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { pillMessage, summarize } from './describe';
import { useQueueOnline, useQueueOps } from './use-queue';

export interface QueueStatusPillProps {
  /** Opens the queued tasks page. Without it the pill is plain text. */
  onPress?: () => void;
}

/**
 * A small status chip: how many tasks are queued, stopped or finished. Renders nothing when the queue is
 * empty. The icon and the words carry the state, never colour alone.
 */
export function QueueStatusPill({ onPress }: QueueStatusPillProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const ops = useQueueOps();
  const online = useQueueOnline();
  const pill = pillMessage(summarize(ops));
  if (!pill) return null;
  const icon: LucideIcon = pill.tone === 'warning' ? TriangleAlert : pill.tone === 'success' ? Check : online ? RefreshCw : CloudOff;
  const label = t(pill.key, { count: pill.count });
  const chip = <Chip label={label} tone={pill.tone} icon={icon} accessibilityLabel={onPress ? undefined : label} />;
  if (!onPress) return <View accessibilityLiveRegion="polite">{chip}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('queue.pill.hint')}
      accessibilityLiveRegion="polite"
      hitSlop={8}
      style={({ pressed }) => ({ minHeight: theme.touchTarget, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
      testID="queue-status-pill"
    >
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">{chip}</View>
    </Pressable>
  );
}
