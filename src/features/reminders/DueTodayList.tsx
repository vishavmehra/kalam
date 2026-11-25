import { CalendarClock } from 'lucide-react-native';
import { View } from 'react-native';

import { Chip, Text, useKalamTheme } from '@/design';

import { dueLabel } from './format';
import { useDueToday } from './hooks';
import type { DueItem, DueResult, SpecView } from './types';

function Group({ title, items, tone }: { title: string; items: DueItem[]; tone: 'primary' | 'info' | 'danger' }) {
  const theme = useKalamTheme();
  if (!items.length) return null;
  return (
    <View style={{ gap: theme.space[2] }} role="list" aria-label={title}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">{title}</Text>
      {items.map((item) => (
        <View
          key={`${item.collection}.${item.id}`}
          role="listitem"
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3],
            minHeight: theme.touchTarget, paddingVertical: theme.space[2],
            borderBottomWidth: 1, borderBottomColor: theme.colors.border,
          }}
        >
          <Text weight="medium" numberOfLines={2} style={{ flex: 1 }}>{item.title}</Text>
          <Chip label={dueLabel(item.daysFromToday)} tone={tone} />
        </View>
      ))}
    </View>
  );
}

/** The list itself, for screens that already have the data. */
export function DueTodayView({ due, loaded = true }: { due: DueResult; loaded?: boolean }) {
  const theme = useKalamTheme();
  const empty = !due.today.length && !due.soon.length && !due.overdue.length;
  return (
    <View style={{ gap: theme.space[4] }} testID="due-today">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <CalendarClock size={20} color={theme.colors.primary} strokeWidth={2} />
        <Text variant="h4">Due today</Text>
      </View>
      {!loaded ? null : empty ? (
        <Text tone="secondary">Nothing is due today.</Text>
      ) : (
        <>
          <Group title="Today" items={due.today} tone="primary" />
          <Group title="Coming up soon" items={due.soon} tone="info" />
          <Group title="Overdue" items={due.overdue} tone="danger" />
        </>
      )}
    </View>
  );
}

/**
 * Self-contained "Due today" list. It reads the app's records and reminder settings from this
 * device, so it works offline and without notification permission. Mount it anywhere inside the
 * Kalam shell theme.
 */
export function DueTodayList({ spec, appId }: { spec: SpecView; appId: string }) {
  const { today, soon, overdue, loaded } = useDueToday(spec, appId);
  return <DueTodayView due={{ today, soon, overdue }} loaded={loaded} />;
}
