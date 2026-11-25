/**
 * One-time notice before the first build that may send content online (docs/03 §23,
 * docs/11 §8.3). Says exactly what leaves the device and what never does, then lets the person
 * send or stop. Accepting sets settings.cloudNoticeSeen.
 */
import { Cloud, HardDrive } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Button, Sheet, Text, useBreakpoint, useKalamTheme } from '@/design';

function Row({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const { space } = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[3] }}>
      <View style={{ paddingTop: 2 }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold">{title}</Text>
        <Text variant="bodySmall" tone="secondary">{children}</Text>
      </View>
    </View>
  );
}

export function CloudNoticeSheet({ visible, onSend, onCancel }: { visible: boolean; onSend: () => void; onCancel: () => void }) {
  const { colors, space } = useKalamTheme();
  const { isPhone } = useBreakpoint();
  const send = <Button key="send" label="Send and build" icon={Cloud} onPress={onSend} fullWidth={isPhone} testID="cloud-notice-send" />;
  const cancel = <Button key="cancel" label="Not now" variant="ghost" onPress={onCancel} fullWidth={isPhone} />;
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      title="This app needs Gemini in the cloud"
      description="It is too detailed to build on this device. Kalam asks before sending anything online for the first time."
      // Phones stack the actions with the main one first, under the thumb.
      footer={isPhone ? [send, cancel] : [cancel, send]}
    >
      <View style={{ gap: space[4] }}>
        <Row icon={<Cloud size={20} color={colors.sourceCloud} />} title="Sent to Gemini through Firebase">
          Your description, the words from your voice note, and your photos, video frames and drawing as pictures.
          Photos are made smaller and their location is removed first.
        </Row>
        <Row icon={<HardDrive size={20} color={colors.sourceOnDevice} />} title="Never leaves this device">
          Your voice recording, your saved apps and every record you keep in them.
        </Row>
        <Text variant="bodySmall" tone="muted">
          Using the app you build never needs the internet. You can turn off cloud AI in Settings at any time.
        </Text>
      </View>
    </Sheet>
  );
}
