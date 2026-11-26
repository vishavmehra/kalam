/**
 * One computed report in the Kalam shell: explicit date range, the totals, the chart or a plain
 * state, and the optional explanation. The numbers always come from the report engine; the
 * explanation sits below them and never replaces them (docs/14 §7.7).
 */
import { Cloud, MessageSquare, Share2 } from 'lucide-react-native';
import { View } from 'react-native';

import { formatValue, type ReportResult, reportToText } from '@/core/reports';
import { Button, SourceBadge, Surface, Text, useToast } from '@/design';
import { shareText } from '@/features/diagnostics/share';

import { useShellChartStyle } from './chart-style';
import { ChartView } from './ChartView';
import { COPY, STATUS_TITLE } from './copy';
import { useExplanation } from './use-reports';

const BADGE = { deterministic: COPY.explainedPlain, on_device: COPY.explainedDevice, cloud: COPY.explainedCloud } as const;

export function ReportCard({ result, appId }: { result: ReportResult; appId: string }) {
  const style = useShellChartStyle();
  const toast = useToast();
  const { explanation, busy, explain, canAskOnline } = useExplanation(result, appId);
  const chart = result.status === 'ok' && result.view !== 'number';

  const share = async () => {
    const outcome = await shareText(reportToText(result), result.title);
    if (outcome === 'copied') toast.show({ message: COPY.copied, tone: 'success' });
    else if (outcome === 'failed') toast.show({ message: COPY.shareFailed, tone: 'danger' });
  };

  return (
    <Surface padded={16} style={{ gap: 14 }} role="article" accessibilityLabel={result.title}>
      <View style={{ gap: 2 }}>
        <Text variant="h4" role="heading">{result.title}</Text>
        <Text variant="bodySmall" tone="secondary">{result.range.label}</Text>
      </View>

      {result.status === 'empty' || result.status === 'none_in_range' || result.status === 'filtered_out' ? (
        <View style={{ gap: 4 }}>
          <Text weight="semibold">{STATUS_TITLE[result.status]}</Text>
          <Text tone="secondary">{result.summary}</Text>
          {result.details.map((d) => <Text key={d} tone="secondary">{d}</Text>)}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
            {result.metrics.map((m, i) => (
              <View key={m.label} style={{ gap: 2, minWidth: 120 }}>
                <Text variant="caption" tone="muted">{m.label}</Text>
                <Text variant="h3" numeric>{formatValue(result.totals[i], m, result.lang)}</Text>
              </View>
            ))}
          </View>
          {result.status === 'not_enough' ? <Text weight="semibold">{COPY.notEnough}</Text> : null}
          {chart ? (
            <ChartView result={result} kind={result.view === 'number' ? 'bar' : result.view} style={style} />
          ) : (
            <Text>{result.summary}</Text>
          )}
          {result.details.map((d) => <Text key={d} tone="secondary">{d}</Text>)}
          <Text variant="caption" tone="muted">{COPY.entriesCounted(formatValue(result.entries, undefined, result.lang))}</Text>
        </>
      )}

      {explanation ? (
        <Surface tone="alt" bordered={false} padded={12} radius="md" style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <Text variant="caption" tone="muted">{COPY.explanationTitle}</Text>
          <Text>{explanation.text}</Text>
          <SourceBadge source={explanation.source} label={BADGE[explanation.source]} size="sm" />
          {canAskOnline ? (
            <View style={{ gap: 8 }}>
              <Text variant="bodySmall" tone="secondary">{COPY.askOnlineNote}</Text>
              <Button
                label={busy ? COPY.explaining : COPY.askOnline} variant="secondary" size="sm" icon={Cloud} loading={busy}
                onPress={() => void explain(true)} style={{ alignSelf: 'flex-start' }}
              />
            </View>
          ) : null}
        </Surface>
      ) : null}

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {result.status === 'ok' && !explanation ? (
            <Button label={busy ? COPY.explaining : COPY.explain} variant="secondary" size="sm" icon={MessageSquare} loading={busy} onPress={() => void explain()} />
          ) : null}
          <Button label={COPY.share} variant="ghost" size="sm" icon={Share2} onPress={() => void share()} />
        </View>
        {result.status === 'ok' && !explanation ? <Text variant="caption" tone="muted">{COPY.explainNote}</Text> : null}
      </View>
    </Surface>
  );
}
