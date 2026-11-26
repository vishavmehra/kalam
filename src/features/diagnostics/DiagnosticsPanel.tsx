import { Copy, Eye, EyeOff, RotateCcw, Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { TimingSummary } from '@/core/observability';
import { TELEMETRY_EVENTS, type TelemetryEvent } from '@/core/telemetry';
import { Button, ConfirmSheet, fontFamilies, Surface, SwitchRow, Text, useKalamTheme, useToast } from '@/design';

import { SectionHeading } from '@/features/settings/Section';

import { diagnosticsCopy } from './copy';
import { errorLabel } from './labels';
import { ReportProblemButton } from './ReportProblemSheet';
import { copyText, shareText } from './share';
import { exportInferenceEvidence, useTelemetry, useTimingSummaries } from './use-diagnostics';

const copy = diagnosticsCopy;

function Rule() {
  const theme = useKalamTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.border }} />;
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 6 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Text weight="semibold" numeric>{value}</Text>
    </View>
  );
}

function valueLabel(event: TelemetryEvent, dimension: string): string {
  if (event === 'error') return errorLabel(dimension);
  return copy.usage.values[event]?.[dimension] ?? dimension;
}

function TimingRow({ row }: { row: TimingSummary }) {
  const label = copy.timings.names[row.name];
  const detail = copy.timings.row(row.runs, row.medianMs, row.p95Ms, row.failed);
  return (
    <View accessible accessibilityLabel={`${label}. ${detail}`} style={{ gap: 2, paddingVertical: 6 }}>
      <Text weight="medium">{label}</Text>
      <Text variant="bodySmall" tone="secondary" numeric>{detail}</Text>
    </View>
  );
}

function sinceText(since: string | null): string | null {
  if (!since) return null;
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) return null;
  return copy.usage.since(date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
}

/**
 * Settings block for usage counts, timings and the problem report. Self-contained: it renders its own
 * heading and surface, so mount it as a sibling of the other settings groups.
 *
 * Counting is off until the person turns the switch on. Counts stay on this device. The person can see
 * them, copy or share them as JSON, and reset them. Nothing is sent anywhere by this panel.
 */
export function DiagnosticsPanel() {
  const toast = useToast();
  const { telemetry, snapshot, json } = useTelemetry();
  const timingRows = useTimingSummaries();
  const [showJson, setShowJson] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [evidence, setEvidence] = useState<{ json: string; runs: number } | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  const groups = TELEMETRY_EVENTS.map((event) => ({
    event,
    rows: Object.entries(snapshot.counts[event]).map(([dimension, count]) => ({ dimension, count })),
  })).filter((g) => g.rows.length > 0);
  const since = sinceText(snapshot.since);

  const toggle = async (on: boolean) => {
    // Resolves false when the choice could not be saved: it works until Kalam closes, so say so.
    const saved = await telemetry.setEnabled(on);
    if (saved) toast.show({ message: on ? copy.usage.toasts.on : copy.usage.toasts.off, tone: 'info' });
    else toast.show({ message: copy.usage.toasts.saveFailed, tone: 'danger' });
  };

  // The JSON is built when the person acts, so its export time is the time they copied or shared it.
  const copyJson = async () => {
    const outcome = await copyText(telemetry.exportJson());
    toast.show(outcome === 'copied' ? { message: copy.usage.toasts.copied, tone: 'success' } : { message: copy.usage.toasts.failed, tone: 'danger' });
  };

  const shareJson = async () => {
    const outcome = await shareText(telemetry.exportJson(), copy.usage.shareTitle);
    if (outcome === 'shared') toast.show({ message: copy.usage.toasts.shared, tone: 'success' });
    else if (outcome === 'copied') toast.show({ message: copy.usage.toasts.copied, tone: 'success' });
    else if (outcome === 'failed') toast.show({ message: copy.usage.toasts.failed, tone: 'danger' });
  };

  // Built when the person acts, from the activity log, so the export holds every run up to that moment (D17-029).
  const withEvidence = async (then: (e: { json: string; runs: number }) => Promise<void> | void) => {
    try {
      const built = await exportInferenceEvidence();
      setEvidence(built);
      await then(built);
    } catch {
      toast.show({ message: copy.evidence.toasts.unreadable, tone: 'danger' });
    }
  };
  const copyEvidence = () => withEvidence(async (e) => {
    const outcome = await copyText(e.json);
    toast.show(outcome === 'copied' ? { message: copy.evidence.toasts.copied, tone: 'success' } : { message: copy.evidence.toasts.failed, tone: 'danger' });
  });
  const shareEvidence = () => withEvidence(async (e) => {
    const outcome = await shareText(e.json, copy.evidence.shareTitle);
    if (outcome === 'shared') toast.show({ message: copy.evidence.toasts.shared, tone: 'success' });
    else if (outcome === 'copied') toast.show({ message: copy.evidence.toasts.copied, tone: 'success' });
    else if (outcome === 'failed') toast.show({ message: copy.evidence.toasts.failed, tone: 'danger' });
  });
  const toggleEvidence = async () => {
    if (showEvidence) return setShowEvidence(false);
    await withEvidence(() => setShowEvidence(true));
  };

  return (
    <View style={{ gap: 12 }}>
      <SectionHeading title={copy.section.title} description={copy.section.description} />

      <Surface padded={20} style={{ gap: 16 }}>
        <SwitchRow
          label={copy.usage.switchLabel}
          description={copy.usage.switchHint}
          value={snapshot.enabled}
          onValueChange={(on) => void toggle(on)}
          disabled={!snapshot.loaded}
        />

        <View style={{ gap: 6 }}>
          <Text variant="h4">{copy.usage.heading}</Text>
          {!snapshot.loaded ? (
            <Text tone="secondary">{copy.usage.loading}</Text>
          ) : groups.length === 0 ? (
            <Text tone="secondary">{snapshot.enabled ? copy.usage.emptyOn : copy.usage.emptyOff}</Text>
          ) : (
            <>
              {since ? <Text variant="bodySmall" tone="muted">{since}</Text> : null}
              {groups.map((g) => (
                <View key={g.event} style={{ gap: 2, marginTop: 8 }}>
                  <Text variant="bodySmall" weight="semibold" tone="secondary">{copy.usage.groups[g.event]}</Text>
                  {g.rows.map((r) => <Row key={r.dimension} label={valueLabel(g.event, r.dimension)} value={r.count} />)}
                </View>
              ))}
            </>
          )}
        </View>

        {snapshot.loaded ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button label={copy.usage.copyJson} icon={Copy} variant="outline" onPress={() => void copyJson()} />
              <Button label={copy.usage.shareJson} icon={Share2} variant="outline" onPress={() => void shareJson()} />
              <Button
                label={showJson ? copy.usage.hideJson : copy.usage.showJson}
                icon={showJson ? EyeOff : Eye}
                variant="ghost"
                onPress={() => setShowJson((v) => !v)}
              />
              <Button label={copy.usage.reset} icon={RotateCcw} variant="ghost" onPress={() => setConfirmReset(true)} disabled={snapshot.total === 0} />
            </View>
            {showJson ? (
              <Surface tone="alt" padded={14} accessibilityLabel={copy.usage.jsonLabel} role="group">
                <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                  <Text variant="bodySmall" selectable style={{ fontFamily: fontFamilies.mono }}>{json}</Text>
                </ScrollView>
              </Surface>
            ) : null}
          </View>
        ) : null}

        <Rule />

        <View style={{ gap: 4 }}>
          <Text variant="h4">{copy.timings.heading}</Text>
          <Text variant="bodySmall" tone="secondary">{copy.timings.description}</Text>
          {timingRows.length === 0 ? (
            <Text tone="secondary" style={{ marginTop: 6 }}>{copy.timings.empty}</Text>
          ) : (
            <View style={{ marginTop: 6 }}>{timingRows.map((row) => <TimingRow key={row.name} row={row} />)}</View>
          )}
        </View>

        <Rule />

        <View style={{ gap: 8 }}>
          <Text variant="h4">{copy.evidence.heading}</Text>
          <Text variant="bodySmall" tone="secondary">{copy.evidence.description}</Text>
          {evidence ? (
            <Text variant="bodySmall" tone="muted" accessibilityLiveRegion="polite">
              {evidence.runs === 0 ? copy.evidence.empty : copy.evidence.count(evidence.runs)}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label={copy.evidence.copy} icon={Copy} variant="outline" onPress={() => void copyEvidence()} />
            <Button label={copy.evidence.share} icon={Share2} variant="outline" onPress={() => void shareEvidence()} />
            <Button
              label={showEvidence ? copy.evidence.hide : copy.evidence.show}
              icon={showEvidence ? EyeOff : Eye}
              variant="ghost"
              onPress={() => void toggleEvidence()}
            />
          </View>
          {showEvidence && evidence ? (
            <Surface tone="alt" padded={14} accessibilityLabel={copy.evidence.jsonLabel} role="group">
              <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                <Text variant="bodySmall" selectable style={{ fontFamily: fontFamilies.mono }}>{evidence.json}</Text>
              </ScrollView>
            </Surface>
          ) : null}
        </View>

        <Rule />

        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <ReportProblemButton />
          <Text variant="bodySmall" tone="muted">{copy.problem.openHint}</Text>
        </View>
      </Surface>

      <ConfirmSheet
        visible={confirmReset}
        title={copy.usage.resetTitle}
        message={copy.usage.resetMessage}
        confirmLabel={copy.usage.resetConfirm}
        destructive
        onConfirm={async () => {
          await telemetry.reset();
          setConfirmReset(false);
          toast.show({ message: copy.usage.toasts.reset, tone: 'success' });
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </View>
  );
}
