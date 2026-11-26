/**
 * Smart Reports for one app (docs/14 §7). Suggested reports come from the app's fields; the
 * report maker builds others. Every number is worked out on this device from this app's entries.
 */
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { collectionName } from '@/core/assistant/text';
import { type ReportDefinition, suggestReports } from '@/core/reports';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, Chip, EmptyState, Sheet, Text, useKalamTheme } from '@/design';

import { COPY } from './copy';
import { ReportBuilder } from './ReportBuilder';
import { ReportCard } from './ReportCard';
import { useReport } from './use-reports';

export interface ReportsSheetProps {
  spec: KalamSpec;
  /** Records are read for this app only. */
  appId: string;
  visible: boolean;
  onClose: () => void;
}

/** True when the app saves entries, so there is something to report on. */
export const hasReports = (spec: KalamSpec): boolean => Object.keys(spec.collections).length > 0;

export function ReportsSheet({ spec, appId, visible, onClose }: ReportsSheetProps) {
  const theme = useKalamTheme();
  const suggestions = useMemo(() => suggestReports(spec), [spec]);
  const [chosen, setChosen] = useState<ReportDefinition | undefined>(undefined);
  const [building, setBuilding] = useState(false);
  const def = chosen ?? suggestions[0];
  const { outcome, loading } = useReport(spec, appId, def, visible);

  const byCollection = Object.keys(spec.collections)
    .map((cid) => ({ cid, defs: suggestions.filter((d) => d.sourceCollection === cid) }))
    .filter((g) => g.defs.length);

  return (
    <Sheet visible={visible} onClose={onClose} title={COPY.sheetTitle(spec.name)} description={COPY.sheetDescription} maxWidth={640}>
      {!hasReports(spec) ? (
        <EmptyState title={COPY.noCollectionsTitle} description={COPY.noCollections} />
      ) : (
        <View style={{ gap: 20, paddingBottom: 24 }}>
          <View style={{ gap: 10 }}>
            <Text variant="caption" tone="muted" role="heading">{COPY.suggested}</Text>
            {byCollection.map((g) => (
              <View key={g.cid} style={{ gap: 6 }}>
                {byCollection.length > 1 ? <Text variant="bodySmall" weight="medium">{collectionName(spec, g.cid)}</Text> : null}
                <View role="radiogroup" accessibilityLabel={COPY.suggested} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {g.defs.map((d) => (
                    <Chip key={d.id} label={d.title} role="radio" selected={def?.id === d.id} onPress={() => { setChosen(d); setBuilding(false); }} />
                  ))}
                </View>
              </View>
            ))}
          </View>

          <View style={{ gap: 12 }}>
            <Button
              label={building ? COPY.hideBuilder : COPY.makeYourOwn}
              variant="ghost"
              size="sm"
              icon={building ? ChevronUp : ChevronDown}
              iconPosition="end"
              onPress={() => setBuilding((b) => !b)}
              style={{ alignSelf: 'flex-start' }}
            />
            {building ? <ReportBuilder spec={spec} onShow={(d) => setChosen(d)} /> : null}
          </View>

          <View accessibilityLiveRegion="polite">
            {!outcome || (loading && !outcome.ok) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="progressbar" accessibilityLabel={COPY.working}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text tone="secondary">{COPY.working}</Text>
              </View>
            ) : outcome.ok ? (
              <ReportCard result={outcome.result} appId={appId} />
            ) : (
              <View style={{ gap: 4 }}>
                <Text weight="semibold">{COPY.failed}</Text>
                {outcome.errors.map((e) => <Text key={e} tone="secondary">{e}</Text>)}
              </View>
            )}
          </View>
        </View>
      )}
    </Sheet>
  );
}
