import { View } from 'react-native';

import type { WidgetEntryBody } from '@/core/widgets';
import { Surface, Text, useKalamTheme } from '@/design';
import { widgetSaid } from './said';

export interface WidgetPreviewProps {
  appName: string;
  title: string;
  body: WidgetEntryBody;
  /** Leave the reading of the card to a parent that is itself the focus stop (a pressable card). */
  plain?: boolean;
}

/** What the home screen will draw, as plain text in a card. It is a description, not a picture of one launcher's widget. */
export function WidgetPreview({ appName, title, body, plain }: WidgetPreviewProps) {
  const theme = useKalamTheme();
  const said = widgetSaid(appName, title, body);
  return (
    <Surface bordered padded {...(plain ? {} : { accessible: true, accessibilityLabel: said })} style={{ gap: theme.space[1] }}>
      <Text variant="caption" tone="muted" numberOfLines={1}>{appName}</Text>
      <Text weight="semibold" numberOfLines={2}>{title}</Text>
      {body.headline ? <Text variant="h3" numeric numberOfLines={1}>{body.headline}</Text> : null}
      {body.rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          {r.done === undefined ? null : <Text variant="bodySmall">{r.done ? '✓' : '○'}</Text>}
          <Text variant="bodySmall" style={{ flex: 1 }} numberOfLines={1}>{r.text}</Text>
          {r.detail ? <Text variant="caption" tone="muted" numberOfLines={1}>{r.detail}</Text> : null}
        </View>
      ))}
      {body.note ? <Text variant="bodySmall" tone="secondary">{body.note}</Text> : null}
    </Surface>
  );
}
