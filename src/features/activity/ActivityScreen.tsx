import { router, useFocusEffect } from 'expo-router';
import { CircleCheck, CircleX, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { clockTime, formatLatency } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import type { InferenceEvent, InferenceSource } from '@/core/contracts';
import {
  Button, chartColors, ConfirmSheet, EmptyState, readableOn, Screen, SourceBadge, Text, useBreakpoint, useKalamTheme, useToast,
} from '@/design';
import { getServices } from '@/services';

import { humanizeTask, percent, summarize } from './stats';

const SOURCE_NAME: Record<InferenceSource, string> = { on_device: 'On-device', cloud: 'Cloud', deterministic: 'Deterministic' };
const SOURCE_NOTE: Record<InferenceSource, string> = {
  on_device: 'Gemini Nano on this device',
  cloud: 'Gemini through Firebase AI Logic',
  deterministic: 'Templates and rules, no model',
};
const ROUTE_NAME: Record<InferenceEvent['route'], string> = {
  deterministic: 'Rules', template: 'Template', on_device: 'On-device model', cloud: 'Cloud model', specialist: 'Specialist',
};
const PROVIDER_NAME: Record<InferenceEvent['provider'], string> = {
  firebase: 'Firebase AI Logic', claude: 'Claude', nebius: 'Nebius', deterministic: 'Kalam', none: 'None',
};
const PAGE = 40;

/** Hybrid inference dashboard: where each AI decision ran, how fast, and why it escalated. */
export function ActivityScreen() {
  const theme = useKalamTheme();
  const toast = useToast();
  const { isPhone } = useBreakpoint();
  const [events, setEvents] = useState<InferenceEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await getServices().db.events.list(200));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activity could not be read from this device.');
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const summary = useMemo(() => (events ? summarize(events) : null), [events]);
  const colors = chartColors[theme.scheme];

  return (
    <AppShell active="activity">
      <Screen maxWidth={1120}>
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'flex-end', marginBottom: 28 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="h1">Activity</Text>
            <Text tone="secondary" style={{ maxWidth: 640 }}>
              Each AI step Kalam took on this device: where it ran, how long it took, and why it went online.
              This log stays on this device and is never uploaded.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Refresh" icon={RefreshCw} variant="outline" size="sm" onPress={() => void load()} />
            {events?.length ? <Button label="Clear history" icon={Trash2} variant="ghost" size="sm" onPress={() => setConfirmClear(true)} /> : null}
          </View>
        </View>

        {error ? (
          <EmptyState title="Activity is unavailable" description={error} action={<Button label="Try again" variant="outline" onPress={() => void load()} />} />
        ) : !events || !summary ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text tone="secondary">Reading activity…</Text>
          </View>
        ) : summary.total === 0 ? (
          <EmptyState
            title="No AI activity yet"
            description="Create an app to see its steps here. Each one shows if it used a template, Gemini Nano on this device, or Gemini in the cloud, and how long it took."
            action={<Button label="Create an app" icon={Plus} onPress={() => router.push(routes.create)} />}
          />
        ) : (
          <View style={{ gap: 40 }}>
            <Overview summary={summary} colors={colors} />
            {summary.escalations.length ? <Escalations items={summary.escalations} color={colors.cloud} /> : null}
            <View style={{ gap: 12 }}>
              <Text variant="h3">Recent decisions</Text>
              <View role="list" style={{ borderTopWidth: 1, borderColor: theme.colors.border }}>
                {events.slice(0, shown).map((e) => <EventRow key={e.id} event={e} />)}
              </View>
              {events.length > shown ? (
                <Button label={`Show ${Math.min(PAGE, events.length - shown)} more`} variant="outline" onPress={() => setShown((n) => n + PAGE)} />
              ) : null}
            </View>
          </View>
        )}
      </Screen>
      <ConfirmSheet
        visible={confirmClear}
        title="Clear AI activity?"
        message="This deletes the activity log on this device. Your apps, their data and the on-device AI counter are not affected."
        confirmLabel="Clear history"
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await getServices().db.events.clear();
            setEvents([]);
            toast.show({ message: 'Activity cleared', tone: 'success' });
          } catch {
            toast.show({ message: 'Could not clear activity.', tone: 'danger' });
          }
          setConfirmClear(false);
        }}
      />
    </AppShell>
  );
}

type Colors = Record<InferenceSource, string>;

function Overview({ summary, colors }: { summary: ReturnType<typeof summarize>; colors: Colors }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const { isPhone, isDesktop } = useBreakpoint();
  const local = summary.bySource.filter((s) => s.source !== 'cloud').reduce((a, s) => a + s.count, 0);
  const parts = summary.bySource.filter((s) => s.count > 0);
  const cells = [
    ...summary.bySource.map((s) => ({
      key: s.source,
      swatch: colors[s.source],
      label: SOURCE_NAME[s.source],
      value: s.count.toLocaleString(),
      lines: [
        s.medianLatencyMs == null ? 'No runs yet' : `Median ${formatLatency(s.medianLatencyMs)}, slowest 5% ${formatLatency(s.p95LatencyMs)}`,
        SOURCE_NOTE[s.source],
      ],
    })),
    { key: 'fallbacks', swatch: undefined, label: 'Fallbacks', value: summary.fallbacks.toLocaleString(), lines: ['A provider failed or was unavailable, so the next one ran'] },
    { key: 'failures', swatch: undefined, label: 'Failed', value: summary.failures.toLocaleString(), lines: ['No valid result; nothing was saved'] },
    ...(summary.tokensIn + summary.tokensOut + summary.retries + summary.cacheHits > 0 ? [{
      key: 'ledger', swatch: undefined, label: 'Cloud usage', value: (summary.tokensIn + summary.tokensOut).toLocaleString(),
      lines: [`Tokens: ${summary.tokensIn.toLocaleString()} in, ${summary.tokensOut.toLocaleString()} out`, `${summary.retries} retries, ${summary.cacheHits} answered from cache`],
    }] : []),
  ];
  const perRow = isDesktop ? 5 : isPhone ? 2 : 3;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text weight="semibold" numeric={false} style={{ fontSize: 56 * theme.fontScale, lineHeight: 60 * theme.fontScale, letterSpacing: -1.5, color: c.text }}>
          {percent(local, summary.total)}
        </Text>
        <Text variant="bodyLarge" tone="secondary">
          of {summary.total.toLocaleString()} recorded {summary.total === 1 ? 'step' : 'steps'} never left this device (on-device AI or plain app logic).
        </Text>
      </View>

      <View
        accessible
        role="img"
        accessibilityLabel={`Where AI work ran: ${parts.map((p) => `${SOURCE_NAME[p.source]} ${p.count} (${percent(p.count, summary.total)})`).join(', ')}`}
        style={{ flexDirection: 'row', height: 28, gap: 2 }}
      >
        {parts.map((p) => {
          const share = p.count / summary.total;
          const fg = readableOn(colors[p.source], '#10170F', '#FFFFFF');
          return (
            <View key={p.source} style={{ flex: p.count, backgroundColor: colors[p.source], borderRadius: 4, justifyContent: 'center', paddingHorizontal: 8, overflow: 'hidden' }}>
              {share >= 0.08 ? <Text variant="caption" weight="semibold" style={{ color: fg }} numberOfLines={1}>{percent(p.count, summary.total)}</Text> : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 6 }} aria-hidden>
        {parts.map((p) => (
          <View key={p.source} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors[p.source] }} />
            <Text variant="bodySmall" tone="secondary">{SOURCE_NAME[p.source]}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderColor: c.border }}>
        {cells.map((cell, i) => (
          <View
            key={cell.key}
            style={{
              width: `${100 / perRow}%`, paddingVertical: 18, paddingRight: 16, paddingLeft: i % perRow ? 16 : 0, gap: 6,
              borderLeftWidth: i % perRow ? 1 : 0, borderBottomWidth: 1, borderColor: c.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {cell.swatch ? <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: cell.swatch }} /> : null}
              <Text variant="bodySmall" weight="medium" tone="secondary">{cell.label}</Text>
            </View>
            <Text weight="semibold" style={{ fontSize: 30 * theme.fontScale, lineHeight: 36 * theme.fontScale, color: c.text }}>{cell.value}</Text>
            {cell.lines.map((l) => <Text key={l} variant="bodySmall" tone="muted">{l}</Text>)}
          </View>
        ))}
      </View>
    </View>
  );
}

function Escalations({ items, color }: { items: Array<{ reason: string; count: number }>; color: string }) {
  const theme = useKalamTheme();
  const { isPhone } = useBreakpoint();
  const max = Math.max(...items.map((i) => i.count));
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h3">Why work went to the cloud</Text>
        <Text tone="secondary">The reasons Kalam gave for not doing the work on this device.</Text>
      </View>
      <View role="list" style={{ gap: 10 }}>
        {items.slice(0, 8).map((it) => (
          <View
            key={it.reason}
            role="listitem"
            accessibilityLabel={`${it.reason}: ${it.count}`}
            style={{ flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 4 : 16 }}
          >
            <Text style={{ width: isPhone ? undefined : 280 }} numberOfLines={2}>{it.reason}</Text>
            <View style={{ flex: isPhone ? undefined : 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, height: 12, justifyContent: 'center' }}>
                <View style={{ width: `${(it.count / max) * 100}%`, height: 12, minWidth: 4, backgroundColor: color, borderRadius: 4 }} />
              </View>
              <Text weight="semibold" numeric style={{ minWidth: 32, textAlign: 'right', color: theme.colors.text }}>{it.count}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function EventRow({ event: e }: { event: InferenceEvent }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const { isPhone } = useBreakpoint();
  const ResultIcon = e.success ? CircleCheck : CircleX;
  const result = e.success ? 'Succeeded' : `Failed${e.errorCode ? ` (${e.errorCode.replace(/_/g, ' ')})` : ''}`;
  return (
    <View
      role="listitem"
      style={{
        flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 6 : 16,
        paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border,
      }}
    >
      <View style={{ width: isPhone ? undefined : 260, gap: 2 }}>
        <Text weight="medium" numberOfLines={1}>{humanizeTask(e.taskType)}</Text>
        <Text variant="bodySmall" tone="muted" numeric>
          {clockTime(e.at)}{e.complexity ? `, ${e.complexity}` : ''}
        </Text>
      </View>
      <View style={{ width: isPhone ? undefined : 150, flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <SourceBadge source={e.source} />
        {e.fallbackUsed ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Undo2 size={13} color={c.textSecondary} />
            <Text variant="caption" tone="secondary">Fallback</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text variant="bodySmall" numberOfLines={1}>{ROUTE_NAME[e.route]}, {PROVIDER_NAME[e.provider]}</Text>
        {e.model || e.escalationReason ? (
          <Text variant="bodySmall" tone="muted" numberOfLines={2}>{[e.model, e.escalationReason].filter(Boolean).join(' · ')}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: isPhone ? 'flex-start' : 'flex-end', minWidth: isPhone ? undefined : 200 }}>
        <Text variant="bodySmall" numeric tone="secondary" style={{ minWidth: 64, textAlign: isPhone ? 'left' : 'right' }}>{formatLatency(e.latencyMs)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <ResultIcon size={15} color={e.success ? c.success : c.danger} />
          <Text variant="bodySmall" weight="medium" tone={e.success ? 'success' : 'danger'}>{result}</Text>
        </View>
      </View>
    </View>
  );
}
