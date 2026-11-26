import type { ReactNode } from 'react';
import { View } from 'react-native';

import { LedgerRule, Surface, Text, useKalamTheme } from '@/design';

/** A settings group heading (DIRECTION §6): a Tiro title over the ledger total rule and an optional sentence. */
export function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="h3" level={2}>{title}</Text>
      <LedgerRule width={56} />
      {description ? <Text tone="secondary" style={{ marginTop: 8, maxWidth: 680 }}>{description}</Text> : null}
    </View>
  );
}

/** A settings group (DIRECTION §6): the heading, then one sheet. */
export function Section({ title, description, children, testID }: { title: string; description?: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: 14 }} testID={testID}>
      <SectionHeading title={title} description={description} />
      <Surface padded={20} style={{ gap: 4 }}>{children}</Surface>
    </View>
  );
}

/** Label and value row for read-only status (value is text plus an optional icon, never colour alone). */
export function StatusRow({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.colors.border, flexWrap: 'wrap' }}>
      <Text tone="secondary" style={{ width: 180 }}>{label}</Text>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon}
          <Text weight="semibold">{value}</Text>
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
