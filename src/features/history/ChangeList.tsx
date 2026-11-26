import {
  ArrowUpDown, Database, LayoutDashboard, Minus, Palette, Pencil, Plus, Settings, Sparkles, TriangleAlert, Type, Workflow,
  type LucideIcon,
} from 'lucide-react-native';
import { View } from 'react-native';

import {
  CATEGORY_LABELS, groupByCategory, topImpact,
  type ChangeCategory, type ChangeDetail, type ChangeEntry, type ChangeKind,
} from '@/core/history';
import { Chip, Surface, Text, useKalamTheme } from '@/design';

import { copy } from './copy';

export const CATEGORY_ICON: Record<ChangeCategory, LucideIcon> = {
  structure: LayoutDashboard,
  data: Database,
  look: Palette,
  logic: Workflow,
  ai: Sparkles,
  text: Type,
  settings: Settings,
};

const KIND_ICON: Record<ChangeKind, LucideIcon> = {
  added: Plus, removed: Minus, changed: Pencil, renamed: Pencil, moved: ArrowUpDown,
};

export interface ChangeListProps {
  changes: readonly ChangeEntry[];
  /** Heading above the list. Default "Here is what will change". Pass null for no heading. */
  title?: string | null;
  /** Show Before and After rows under each change (the Time Machine diff view). */
  showDetails?: boolean;
  /** Shown when there are no changes. */
  emptyText?: string;
  testID?: string;
}

function Details({ rows }: { rows: readonly ChangeDetail[] }) {
  return (
    <Surface tone="alt" bordered={false} padded={10} radius="md" style={{ gap: 8, marginTop: 6 }}>
      {rows.map((r, i) => (
        <View key={`${r.name}-${i}`} style={{ gap: 2 }}>
          <Text variant="caption" tone="muted">{r.name}</Text>
          {r.before !== undefined ? (
            <Text variant="bodySmall" tone="secondary">{`${copy.changeList.before}: ${r.before}`}</Text>
          ) : null}
          {r.after !== undefined ? (
            <Text variant="bodySmall" weight="medium">{`${copy.changeList.after}: ${r.after}`}</Text>
          ) : null}
        </View>
      ))}
    </Surface>
  );
}

/**
 * Plain-English list of what differs between two designs, grouped by what part of the app it touches.
 * Used in the edit preview ("Here is what will change") and in the Time Machine diff. Reads from props only.
 */
export function ChangeList({ changes, title, showDetails = false, emptyText, testID }: ChangeListProps) {
  const theme = useKalamTheme();
  const heading = title === undefined ? copy.changeList.title : title;
  if (!changes.length) {
    return (
      <View style={{ gap: 8 }} testID={testID}>
        {heading ? <Text variant="h4">{heading}</Text> : null}
        <Text tone="muted">{emptyText ?? copy.changeList.empty}</Text>
      </View>
    );
  }
  const groups = groupByCategory(changes);
  const impact = topImpact(changes);
  return (
    <View style={{ gap: 14 }} testID={testID}>
      <View style={{ gap: 2 }}>
        {heading ? <Text variant="h4">{heading}</Text> : null}
        <Text variant="caption" tone="muted">{copy.changeList.count(changes.length)}</Text>
      </View>

      {impact === 'cosmetic' ? (
        <Text variant="bodySmall" tone="secondary">{copy.changeList.onlyLook}</Text>
      ) : null}
      {impact === 'data' ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }} accessibilityRole="alert">
          <TriangleAlert size={18} color={theme.colors.warning} style={{ marginTop: 2 }} aria-hidden />
          <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>{copy.changeList.entriesNote}</Text>
        </View>
      ) : null}

      {groups.map((g) => {
        const Icon = CATEGORY_ICON[g.category];
        return (
          <View key={g.category} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon size={16} color={theme.colors.textSecondary} aria-hidden />
              <Text variant="bodySmall" weight="semibold" tone="secondary" role="heading" aria-level={5}>
                {CATEGORY_LABELS[g.category]}
              </Text>
            </View>
            <View role="list" style={{ gap: 10 }}>
              {g.entries.map((e) => {
                const KindIcon = KIND_ICON[e.kind];
                return (
                  <View key={e.key} role="listitem" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <KindIcon size={14} color={theme.colors.textMuted} style={{ marginTop: 4 }} aria-hidden />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text>{e.text}</Text>
                      {e.note ? <Text variant="bodySmall" tone="secondary">{e.note}</Text> : null}
                      {e.impact === 'data' ? (
                        <View style={{ flexDirection: 'row' }}>
                          <Chip label={copy.changeList.affectsEntries} tone="warning" icon={TriangleAlert} />
                        </View>
                      ) : null}
                      {showDetails && e.details?.length ? <Details rows={e.details} /> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
