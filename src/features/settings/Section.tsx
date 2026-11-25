import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Surface, Text, useKalamTheme } from '@/design';

/** A settings group: heading + optional explanation + one bordered surface. */
export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h3">{title}</Text>
        {description ? <Text tone="secondary">{description}</Text> : null}
      </View>
      <Surface padded={20} style={{ gap: 4 }}>{children}</Surface>
    </View>
  );
}

/** Label/value row for read-only status (value is text + optional icon, never colour alone). */
export function StatusRow({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.border, flexWrap: 'wrap' }}>
      <Text tone="secondary" style={{ width: 180 }}>{label}</Text>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon}
          <Text weight="medium">{value}</Text>
        </View>
        {detail ? <Text variant="bodySmall" tone="muted">{detail}</Text> : null}
      </View>
    </View>
  );
}

export function Divider() {
  const theme = useKalamTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 8 }} />;
}
