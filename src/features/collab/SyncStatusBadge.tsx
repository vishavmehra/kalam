import { AlertTriangle, Check, CloudOff, Eye, LogIn, RefreshCw, Upload, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { LASTING_CODES, type SyncStatus } from '@/core/collab';
import { COLLAB_COPY, roleName } from './copy';
import { Chip, useKalamTheme, type ChipTone } from '@/design';
import { useSyncStatus } from './use-collab';

const S = COLLAB_COPY.status;

/** Words, icon and tone for a sync state. Never colour alone. */
export function describeStatus(s: SyncStatus): { label: string; tone: ChipTone; icon: LucideIcon } {
  if (s.phase === 'syncing') return { label: S.syncing, tone: 'info', icon: RefreshCw };
  if (s.conflicts > 0) return { label: S.conflicts(s.conflicts), tone: 'warning', icon: AlertTriangle };
  if (s.phase === 'signed_out') return { label: S.signedOut, tone: 'warning', icon: LogIn };
  if (s.phase === 'offline') return s.pending > 0 ? { label: S.waiting(s.pending), tone: 'neutral', icon: CloudOff } : { label: S.offline, tone: 'neutral', icon: CloudOff };
  if (s.phase === 'error') {
    // Trying again does not fix these, so the badge says what is wrong instead of "will try again".
    const lasting = s.error && LASTING_CODES.includes(s.error) ? S.problems[s.error] : undefined;
    return { label: lasting ?? S.error, tone: 'danger', icon: AlertTriangle };
  }
  if (s.skipped > 0) return { label: S.skipped(s.skipped), tone: 'warning', icon: AlertTriangle };
  if (s.role === 'viewer') return { label: S.viewOnly, tone: 'neutral', icon: Eye };
  if (s.pending > 0) return { label: S.waiting(s.pending), tone: 'info', icon: Upload };
  return { label: S.upToDate, tone: 'success', icon: Check };
}

export interface SyncStatusBadgeProps {
  appId: string;
  /** Opens the sharing sheet. Without it the badge is plain text. */
  onPress?: () => void;
}

/** Shows how a shared app stands with the cloud. Renders nothing for an app that is only on this device. */
export function SyncStatusBadge({ appId, onPress }: SyncStatusBadgeProps) {
  const theme = useKalamTheme();
  const status = useSyncStatus(appId);
  if (!status.shared) return null;
  const d = describeStatus(status);
  const a11y = S.a11y(d.label, status.role ? roleName(status.role) : '');
  const chip = <Chip label={d.label} tone={d.tone} icon={d.icon} accessibilityLabel={onPress ? undefined : a11y} />;
  if (!onPress) return <View accessibilityLiveRegion="polite">{chip}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityLiveRegion="polite"
      hitSlop={8}
      style={({ pressed }) => ({ minHeight: theme.touchTarget, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
      testID="collab-sync-badge"
    >
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">{chip}</View>
    </Pressable>
  );
}
