import { Bell, BellOff, Info } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';

import { Button, Surface, Text, useKalamTheme } from '@/design';
import type { NotificationCapability } from '@/infrastructure/platform/notifications';

interface Props {
  capability: NotificationCapability | undefined;
  /** Shows the system permission prompt. Only called from the button below. */
  onRequest(): Promise<unknown>;
  onOpenSettings?: () => unknown;
}

/**
 * Explains notification permission before asking, and says plainly what each state means.
 * Nothing prompts until the person presses "Allow notifications".
 */
export function PermissionNotice({ capability, onRequest, onOpenSettings }: Props) {
  const theme = useKalamTheme();
  const [asking, setAsking] = useState(false);
  if (!capability) return null;

  const ask = async () => {
    setAsking(true);
    try {
      await onRequest();
    } finally {
      setAsking(false);
    }
  };

  let icon = Info;
  let body: string;
  let action: ReactNode = null;

  if (!capability.supported) {
    body = 'This browser cannot show notifications here. The Due today list above still works.';
  } else if (capability.permission === 'granted') {
    icon = Bell;
    body = capability.delivery === 'system'
      ? 'Notifications are on. Kalam can remind you even when it is closed.'
      : 'Notifications are on. Reminders appear while Kalam is open in this browser. For reminders when it is closed, use Kalam on Android.';
  } else if (capability.permission === 'denied') {
    icon = BellOff;
    body = onOpenSettings
      ? 'Notifications are turned off for Kalam. Turn them on in your phone settings to get reminders. The Due today list still works.'
      : 'Notifications are blocked for this site. Allow them in your browser settings to get reminders. The Due today list still works.';
    action = onOpenSettings ? <Button label="Open settings" variant="outline" onPress={() => void onOpenSettings()} /> : null;
  } else {
    body = 'To remind you, Kalam needs permission to show notifications. It only shows reminders you set up here. Nothing is sent anywhere.';
    action = <Button label="Allow notifications" icon={Bell} loading={asking} onPress={() => void ask()} />;
  }

  const Icon = icon;
  return (
    <Surface tone="alt" padded={theme.space[4]} style={{ gap: theme.space[3] }} testID="reminders-permission">
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
        <Icon size={20} color={theme.colors.textSecondary} strokeWidth={2} />
        <Text style={{ flex: 1 }}>{body}</Text>
      </View>
      {action}
    </Surface>
  );
}
