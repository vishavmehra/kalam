/** Version history (docs/09 §16): every saved design, newest first; restoring adds a new version. */
import { Eye, RotateCcw } from 'lucide-react-native';
import { View } from 'react-native';
import type { AppVersion } from '@/core/contracts';
import { Button, Chip, Text, useKalamTheme } from '@/design';

const SOURCE_LABEL: Record<AppVersion['source'], string> = {
  create: 'Created', edit: 'Edited', restore: 'Restored', import: 'Imported',
};

function when(ts: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function HistoryPanel({ versions, current, lang, restoring, blocked, previewing = null, onPreview, onRestore }: {
  versions: AppVersion[] | null;
  current: number;
  lang: string;
  restoring: number | null;
  /** Set when a proposed change is pending; restoring would silently drop it. */
  blocked: boolean;
  /** Version shown in the preview right now (docs/03 §18.2), if any. */
  previewing?: number | null;
  onPreview?(version: number): void;
  /** Asks to restore; the screen confirms first (docs/03 §18.3). */
  onRestore(version: number): void;
}) {
  const k = useKalamTheme();
  if (!versions) return <Text tone="muted">Loading history…</Text>;
  return (
    <View style={{ gap: 4 }}>
      {blocked ? (
        <Text variant="bodySmall" tone="muted" style={{ marginBottom: 8 }}>
          Keep or discard the proposed change before restoring an older version.
        </Text>
      ) : null}
      <View role="list" style={{ borderRadius: k.radius.lg, borderWidth: 1, borderColor: k.colors.border, backgroundColor: k.colors.surface }}>
        {versions.map((v, i) => {
          const isCurrent = v.version === current;
          return (
            <View
              key={v.version}
              role="listitem"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
                borderTopWidth: i ? 1 : 0, borderTopColor: k.colors.border,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text weight="semibold" numeric>Version {v.version}</Text>
                  <Chip label={isCurrent ? 'Current' : SOURCE_LABEL[v.source]} tone={isCurrent ? 'primary' : 'neutral'} />
                </View>
                <Text variant="bodySmall" tone="secondary">{v.summary}</Text>
                <Text variant="caption" tone="muted">{when(v.createdAt, lang)}</Text>
              </View>
              {isCurrent ? null : (
                <View style={{ gap: 6, alignItems: 'flex-end' }}>
                  {onPreview ? (
                    <Button
                      label={previewing === v.version ? 'Showing' : 'Preview'}
                      variant="ghost"
                      size="sm"
                      icon={Eye}
                      disabled={previewing === v.version}
                      accessibilityHint={`Shows version ${v.version} in the preview without changing anything.`}
                      onPress={() => onPreview(v.version)}
                    />
                  ) : null}
                  <Button
                    label="Restore"
                    variant="outline"
                    size="sm"
                    icon={RotateCcw}
                    loading={restoring === v.version}
                    disabled={blocked || restoring !== null}
                    accessibilityHint={`Makes version ${v.version} the current design. Your records are kept.`}
                    onPress={() => onRestore(v.version)}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>
      {versions.length === 0 ? <Text tone="muted">No saved versions yet.</Text> : null}
    </View>
  );
}
