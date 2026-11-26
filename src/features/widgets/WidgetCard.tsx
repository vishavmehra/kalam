import { Pencil, Plus, Trash2 } from 'lucide-react-native';
import { View } from 'react-native';

import type { WidgetView } from '@/core/widgets';
import { Button, Chip, Surface, Text, useKalamTheme } from '@/design';
import { WIDGET_UI } from './copy';

export interface WidgetCardProps {
  view: WidgetView;
  /** The system can be asked to add it (Android with a supporting launcher). */
  canPin: boolean;
  /** Show the app name, for the list that spans every app. */
  showApp?: boolean;
  busy?: boolean;
  onAdd: () => void;
  /** Leave out where editing is not offered (the device-wide list). */
  onEdit?: () => void;
  onRemove: () => void;
}

/** One saved widget: its name, what it shows and does in plain sentences, whether it is on the home screen, and what can be done with it. */
export function WidgetCard({ view, canPin, showApp, busy, onAdd, onEdit, onRemove }: WidgetCardProps) {
  const theme = useKalamTheme();
  const { widget, health, lines, placed } = view;
  return (
    <Surface bordered padded style={{ gap: theme.space[2] }} accessibilityRole="summary">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text weight="semibold" style={{ flexShrink: 1 }}>{widget.title}</Text>
        {placed === undefined ? null : (
          <Chip label={placed > 0 ? WIDGET_UI.card.onHomeScreen(placed) : WIDGET_UI.card.notOnHomeScreen} tone={placed > 0 ? 'success' : 'neutral'} />
        )}
      </View>
      {showApp ? <Text variant="bodySmall" tone="muted">{view.appName || WIDGET_UI.settings.appGone}</Text> : null}
      {health.ok ? (
        lines.map((l, i) => (
          <Text key={i} variant="bodySmall" tone="secondary">{l}</Text>
        ))
      ) : (
        <Text variant="bodySmall" tone="danger" role="alert">{health.message}{onEdit ? ` ${WIDGET_UI.card.brokenFix}.` : ''}</Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], marginTop: theme.space[1] }}>
        {canPin && health.ok ? <Button label={WIDGET_UI.card.add} icon={Plus} size="sm" disabled={busy} onPress={onAdd} /> : null}
        {onEdit ? <Button label={WIDGET_UI.card.edit} icon={Pencil} variant="secondary" size="sm" disabled={busy} onPress={onEdit} /> : null}
        <Button label={WIDGET_UI.card.remove} icon={Trash2} variant="ghost" size="sm" disabled={busy} onPress={onRemove} accessibilityHint={`Removes ${widget.title}`} />
      </View>
    </Surface>
  );
}
