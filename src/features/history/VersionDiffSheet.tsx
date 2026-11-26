import { RotateCcw, TriangleAlert } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import type { AppVersion } from '@/core/contracts';
import type { ChangeEntry } from '@/core/history';
import { Button, Sheet, Surface, Text, useKalamTheme } from '@/design';

import { ChangeList } from './ChangeList';
import { copy } from './copy';
import { formatWhen } from './format';
import { versionDiff } from './model';

export interface VersionDiffSheetProps {
  visible: boolean;
  /** Version to explain. */
  version: number | null;
  versions: readonly AppVersion[];
  /** Version number of the app right now. */
  current: number;
  lang: string;
  onClose: () => void;
  /** Asks to restore. The screen that owns the app confirms and saves; this sheet writes nothing. */
  onRestore: (version: number) => void;
  /** True while a restore of THIS version is running: shows the spinner on its button. */
  restoring?: boolean;
  /** True while any restore is running. Restoring is then off, so two restores can never overlap. */
  busy?: boolean;
  /** True while a proposed change is waiting: restoring would silently drop it. */
  blocked?: boolean;
}

function Section({ title, result, showDetails, emptyText }: {
  title: string;
  result: ChangeEntry[] | 'earliest' | 'unavailable';
  showDetails: boolean;
  emptyText: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="h4">{title}</Text>
      {result === 'earliest' ? (
        <Text tone="muted">{copy.diff.earliest}</Text>
      ) : result === 'unavailable' ? (
        <Text tone="muted">{copy.diff.unavailable}</Text>
      ) : (
        <ChangeList changes={result} title={null} showDetails={showDetails} emptyText={emptyText} />
      )}
    </View>
  );
}

/**
 * Time Machine detail for one version (docs/14 §11.4): what it changed, and what restoring it would change in the
 * current design, in plain words with Before and After. Restore is a callback only.
 */
export function VersionDiffSheet({ visible, version, versions, current, lang, onClose, onRestore, restoring, busy, blocked }: VersionDiffSheetProps) {
  const theme = useKalamTheme();
  const diff = useMemo(() => (version === null ? undefined : versionDiff(versions, version, current)), [versions, version, current]);
  const stored = versions.find((v) => v.version === version);
  const canRestore = !!diff && !diff.isCurrent && diff.restore !== 'unavailable';

  return (
    <Sheet
      visible={visible && version !== null}
      onClose={onClose}
      title={copy.diff.title(version ?? 0)}
      description={stored ? `${formatWhen(stored.createdAt, lang)}. ${stored.summary}` : undefined}
      maxWidth={600}
      footer={
        <>
          <Button label={copy.diff.close} variant="ghost" size="md" onPress={onClose} />
          {canRestore && version !== null ? (
            <Button
              label={copy.diff.restoreButton}
              icon={RotateCcw}
              size="md"
              loading={restoring}
              disabled={blocked || busy || restoring}
              accessibilityHint={copy.diff.restoreButtonHint(version)}
              onPress={() => onRestore(version)}
            />
          ) : null}
        </>
      }
    >
      {diff ? (
        <View style={{ gap: 20, paddingBottom: 8 }}>
          <Section title={copy.diff.changedHere} result={diff.made} showDetails emptyText={copy.changeList.empty} />

          {diff.isCurrent ? (
            <Text tone="secondary">{copy.diff.currentNote}</Text>
          ) : diff.restore ? (
            <View style={{ gap: 10 }}>
              <Section title={copy.diff.ifRestored} result={diff.restore} showDetails={false} emptyText={copy.diff.same} />
              {diff.touchesEntries ? (
                <Surface tone="accentSoft" padded={12} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} accessibilityRole="alert">
                  <TriangleAlert size={18} color={theme.colors.warning} style={{ marginTop: 2 }} aria-hidden />
                  <Text variant="bodySmall" style={{ flex: 1 }}>{copy.diff.dataNote}</Text>
                </Surface>
              ) : null}
              <Text variant="bodySmall" tone="muted">{copy.diff.restoreNote}</Text>
              {blocked ? <Text variant="bodySmall" tone="warning">{copy.timeline.blocked}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}
