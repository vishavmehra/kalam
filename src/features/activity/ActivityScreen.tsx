import { router, useFocusEffect } from 'expo-router';
import { CircleCheck, CircleX, PenLine, RefreshCw, Trash2, Undo2 } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { formatLatency } from '@/components/format';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { AI_COPY, noticeDeclined } from '@/core/ai/copy';
import { describeAIError } from '@/core/ai/errors';
import { hybridMetrics, weeklyCounts, type HybridMetrics } from '@/core/ai/metrics';
import type { InferenceEvent, InferenceSource } from '@/core/contracts';
import {
  Button, chartColors, ConfirmSheet, EmptyState, LedgerRule, Screen, SourceBadge, Surface, Text, useBreakpoint, useKalamTheme, useToast,
} from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';

import { COMPLEXITY_KEY, describeReason, percent, platformName, summarize, taskName } from './stats';

const SOURCE_NAME: Record<InferenceSource, TranslationKey> = { on_device: 'stamp.device', cloud: 'stamp.cloud', deterministic: 'stamp.template' };
// I1: the on-device model is Apple Intelligence on iPhone and iPad, Gemini Nano elsewhere.
const SOURCE_NOTE: Record<InferenceSource, TranslationKey> = {
  on_device: Platform.OS === 'ios' ? 'activity.note.onDeviceIos' : 'activity.note.onDevice',
  cloud: 'activity.note.cloud',
  deterministic: 'activity.note.deterministic',
};
const ROUTE_NAME: Record<InferenceEvent['route'], TranslationKey> = {
  deterministic: 'activity.route.rules', template: 'activity.route.template', on_device: 'activity.route.onDevice',
  cloud: 'activity.route.cloud', specialist: 'activity.route.specialist',
};
const PROVIDER_NAME: Record<InferenceEvent['provider'], string> = {
  firebase: 'Firebase AI Logic', claude: 'Claude', nebius: 'Nebius', deterministic: 'Kalam', none: '',
};
const PAGE = 40;
/** How many events this screen reads; `weeklyCounts` needs it to say "at least". */
const LIMIT = 200;

/** Hybrid inference dashboard: where each AI decision ran, how fast, and why it went online. Never uploaded. */
export function ActivityScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const { isPhone } = useBreakpoint();
  const [events, setEvents] = useState<InferenceEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await getServices().db.events.list(LIMIT));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const summary = useMemo(() => (events ? summarize(events) : null), [events]);
  const metrics = useMemo(() => (events ? hybridMetrics(events) : null), [events]);
  const week = useMemo(() => (events ? weeklyCounts(events, Date.now(), LIMIT) : null), [events]);
  const colors = chartColors[theme.scheme];

  return (
    <AppShell active="activity">
      <Screen maxWidth={1120}>
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'flex-end', marginBottom: 32 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="h1">{t('activity.title')}</Text>
            <LedgerRule />
            <Text tone="secondary" style={{ maxWidth: 640, marginTop: 10 }}>{t('activity.intro')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={t('common.refresh')} icon={RefreshCw} variant="outline" size="sm" onPress={() => void load()} />
            {events?.length ? <Button label={t('activity.clear')} icon={Trash2} variant="ghost" size="sm" onPress={() => setConfirmClear(true)} /> : null}
          </View>
        </View>

        {failed ? (
          <EmptyState title={t('activity.unavailable')} description={t('activity.loadError')} action={<Button label={t('common.tryAgain')} variant="outline" onPress={() => void load()} />} />
        ) : !events || !summary || !metrics ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text tone="secondary">{t('activity.loading')}</Text>
          </View>
        ) : summary.total === 0 ? (
          <EmptyState
            title={t('activity.empty.title')}
            description={t('activity.empty.descriptionAny')}
            action={<Button label={t('activity.empty.cta')} icon={PenLine} onPress={() => router.push(routes.create)} />}
          />
        ) : (
          <View style={{ gap: 48 }}>
            <Overview summary={summary} colors={colors} />
            <MetricsPanel metrics={metrics} week={week} />
            {summary.escalations.length ? <Escalations items={summary.escalations} color={colors.cloud} /> : null}
            <View style={{ gap: 14 }}>
              <View style={{ gap: 4 }}>
                <Text variant="h3" level={2}>{t('activity.recent')}</Text>
                <LedgerRule width={56} />
              </View>
              <View role="list" style={{ borderTopWidth: 1, borderColor: theme.colors.border }}>
                {events.slice(0, shown).map((e) => <EventRow key={e.id} event={e} />)}
              </View>
              {events.length > shown ? (
                <Button label={t('activity.showMore', { count: Math.min(PAGE, events.length - shown) })} variant="outline" onPress={() => setShown((n) => n + PAGE)} />
              ) : null}
            </View>
          </View>
        )}
      </Screen>
      <ConfirmSheet
        visible={confirmClear}
        title={t('activity.clearTitle')}
        message={t('activity.clearMessage')}
        confirmLabel={t('activity.clear')}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await getServices().db.events.clear();
            setEvents([]);
            toast.show({ message: t('activity.cleared'), tone: 'success' });
          } catch {
            toast.show({ message: t('activity.clearFailed'), tone: 'danger' });
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
  const t = useT(theme.uiLanguage);
  const f = useFormat(theme.uiLanguage);
  const c = theme.colors;
  const { isPhone, isDesktop } = useBreakpoint();
  const local = summary.bySource.filter((s) => s.source !== 'cloud').reduce((a, s) => a + s.count, 0);
  const parts = summary.bySource.filter((s) => s.count > 0);
  const cells = [
    ...summary.bySource.map((s) => ({
      key: s.source,
      swatch: colors[s.source],
      label: t(SOURCE_NAME[s.source]),
      value: f.integer(s.count),
      lines: [
        s.medianLatencyMs == null ? t('activity.noRuns') : t('activity.latency', { median: formatLatency(s.medianLatencyMs), slow: formatLatency(s.p95LatencyMs) }),
        t(SOURCE_NOTE[s.source]),
      ],
    })),
    { key: 'fallbacks', swatch: undefined, label: t('activity.fallbacks'), value: f.integer(summary.fallbacks), lines: [t('activity.fallbacksHint')] },
    { key: 'failures', swatch: undefined, label: t('activity.failed'), value: f.integer(summary.failures), lines: [t('activity.failedHint')] },
  ];
  const perRow = isDesktop ? 5 : isPhone ? 2 : 3;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text money style={{ fontSize: Math.round(64 * theme.fontScale), lineHeight: Math.round(68 * theme.fontScale), color: c.text }}>
          {percent(local, summary.total)}
        </Text>
        <Text variant="bodyLarge" tone="secondary">{t('activity.stayed', { count: summary.total })}</Text>
      </View>

      <View
        accessible
        role="img"
        accessibilityLabel={t('activity.barLabel', { parts: f.list(parts.map((p) => `${t(SOURCE_NAME[p.source])} ${p.count} (${percent(p.count, summary.total)})`)) })}
        style={{ flexDirection: 'row', height: 28, gap: 2 }}
      >
        {parts.map((p) => (
          <View key={p.source} style={{ flex: p.count, backgroundColor: colors[p.source], borderRadius: 4 }} />
        ))}
      </View>
      {/* Shares sit beside the swatches in text colour: fill colours cannot carry a 4.5:1 label in every theme. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 6 }} aria-hidden>
        {parts.map((p) => (
          <View key={p.source} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors[p.source] }} />
            <Text variant="bodySmall" tone="secondary">{t(SOURCE_NAME[p.source])}</Text>
            <Text variant="bodySmall" weight="semibold" numeric>{percent(p.count, summary.total)}</Text>
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
              <Text variant="bodySmall" weight="semibold" tone="secondary">{cell.label}</Text>
            </View>
            <Text money style={{ fontSize: Math.round(30 * theme.fontScale), lineHeight: Math.round(36 * theme.fontScale), color: c.text }}>{cell.value}</Text>
            {cell.lines.map((l) => <Text key={l} variant="bodySmall" tone="muted">{l}</Text>)}
          </View>
        ))}
      </View>
    </View>
  );
}

/** C1: model runs per source, the one cloud fallback, reused answers, retries, stops and failure rate per platform. */
function MetricsPanel({ metrics: m, week }: { metrics: HybridMetrics; week: ReturnType<typeof weeklyCounts> | null }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const f = useFormat(theme.uiLanguage);
  const c = theme.colors;
  const { isPhone } = useBreakpoint();
  const runLine = (s: HybridMetrics['onDevice']) =>
    s.runs === 0 ? t('activity.noRuns') : t('activity.metrics.runs', { ok: f.integer(s.succeeded), runs: f.integer(s.runs), p50: formatLatency(s.p50Ms), p95: formatLatency(s.p95Ms) });
  const rows: Array<[string, string]> = [
    [t('stamp.device'), runLine(m.onDevice)],
    [t('stamp.cloud'), runLine(m.cloud)],
    [t('activity.metrics.fallback'), m.cloudFallbacks.runs === 0 ? t('activity.metrics.none') : t('activity.metrics.fallbackLine', { ok: f.integer(m.cloudFallbacks.succeeded), runs: f.integer(m.cloudFallbacks.runs) })],
    [t('activity.metrics.saved'), f.integer(m.cacheHits)],
    [t('activity.metrics.retries'), f.integer(m.retries)],
    [t('activity.metrics.cancelled'), f.integer(m.cancelled)],
    [t('activity.metrics.stopped'), f.integer(m.clientStops)],
    [t('activity.metrics.tokens'), t('activity.metrics.tokensLine', { input: f.integer(m.tokens.input), output: f.integer(m.tokens.output) })],
    ...m.byPlatform.map(({ platform, requests, failed }): [string, string] => [
      t('activity.metrics.platform', { platform: platformName(platform, t) }),
      t('activity.metrics.platformLine', { failed: f.integer(failed), requests: f.integer(requests), rate: percent(failed, requests) }),
    ]),
  ];
  return (
    <View style={{ gap: 14 }} testID="activity-metrics">
      <View style={{ gap: 4 }}>
        <Text variant="h3" level={2}>{t('activity.metrics.title')}</Text>
        <LedgerRule width={56} />
        <Text tone="secondary" style={{ marginTop: 8, maxWidth: 680 }}>{t('activity.metrics.intro')}</Text>
      </View>
      {week ? (
        <Surface tone="alt" padded={16} style={{ gap: 4 }}>
          <Text weight="semibold">
            {t(week.truncated ? 'activity.week.atLeast' : 'activity.week.line', { device: f.integer(week.onDevice), cloud: f.integer(week.cloud) })}
          </Text>
          <Text variant="bodySmall" tone="muted">{t('activity.week.hint')}</Text>
        </Surface>
      ) : null}
      <Surface padded={isPhone ? 16 : 20}>
        {rows.map(([label, value], i) => (
          <View
            key={label}
            style={{
              flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 2 : 16, paddingVertical: 11,
              borderTopWidth: i ? 1 : 0, borderColor: c.border,
            }}
          >
            <Text tone="secondary" style={{ width: isPhone ? undefined : 240 }}>{label}</Text>
            <Text weight="semibold" numeric style={{ flex: isPhone ? undefined : 1 }}>{value}</Text>
          </View>
        ))}
      </Surface>
    </View>
  );
}

function Escalations({ items, color }: { items: Array<{ reason: string; count: number }>; color: string }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { isPhone } = useBreakpoint();
  const max = Math.max(...items.map((i) => i.count));
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h3" level={2}>{t('activity.why.title')}</Text>
        <LedgerRule width={56} />
        <Text tone="secondary" style={{ marginTop: 8 }}>{t('activity.why.intro')}</Text>
      </View>
      <View role="list" style={{ gap: 10 }}>
        {items.slice(0, 8).map((it) => (
          <View
            key={it.reason}
            role="listitem"
            accessibilityLabel={`${describeReason(it.reason, t)}: ${it.count}`}
            style={{ flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 4 : 16 }}
          >
            <Text style={{ width: isPhone ? undefined : 280 }} numberOfLines={2}>{describeReason(it.reason, t)}</Text>
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

/** C1 event details: model, reused answer, retries, tokens, prompt version, platform and why it went online. */
function eventDetail(e: InferenceEvent, t: ReturnType<typeof useT>): string {
  const tokens = (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0);
  return [
    e.model,
    e.cacheHit ? t('activity.detail.saved') : undefined,
    e.retries ? t('activity.detail.retries', { count: e.retries }) : undefined,
    tokens ? t('activity.detail.tokens', { count: tokens }) : undefined,
    e.promptVersion ? t('activity.prompt', { version: e.promptVersion }) : undefined,
    e.platform ? platformName(e.platform, t) : undefined,
    e.escalationReason ? describeReason(e.escalationReason, t) : undefined,
  ].filter(Boolean).join(' · ');
}

function EventRow({ event: e }: { event: InferenceEvent }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const f = useFormat(theme.uiLanguage);
  const c = theme.colors;
  const { isPhone } = useBreakpoint();
  const ResultIcon = e.success ? CircleCheck : CircleX;
  const result = e.success ? t('activity.succeeded') : t('activity.failedRow');
  const detail = eventDetail(e, t);
  const provider = PROVIDER_NAME[e.provider];
  return (
    <View
      role="listitem"
      style={{
        flexDirection: isPhone ? 'column' : 'row', alignItems: isPhone ? 'stretch' : 'center', gap: isPhone ? 6 : 16,
        paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border,
      }}
    >
      <View style={{ width: isPhone ? undefined : 250, gap: 2 }}>
        <Text weight="semibold" numberOfLines={1}>{taskName(e.taskType, t)}</Text>
        <Text variant="bodySmall" tone="muted" numeric>
          {[f.dateTime(e.at, 'short', 'short'), e.complexity && COMPLEXITY_KEY[e.complexity] ? t(COMPLEXITY_KEY[e.complexity]) : ''].filter(Boolean).join(', ')}
        </Text>
      </View>
      <View style={{ width: isPhone ? undefined : 170, flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <SourceBadge source={e.source} />
        {e.fallbackUsed ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Undo2 size={13} color={c.textSecondary} />
            <Text variant="caption" tone="secondary">{t('activity.fallback')}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text variant="bodySmall" numberOfLines={1}>{provider ? `${t(ROUTE_NAME[e.route])}, ${provider}` : t(ROUTE_NAME[e.route])}</Text>
        {detail ? <Text variant="bodySmall" tone="muted" numberOfLines={2}>{detail}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: isPhone ? 'flex-start' : 'flex-end', minWidth: isPhone ? undefined : 190 }}>
        <Text variant="bodySmall" numeric tone="secondary" style={{ minWidth: 64, textAlign: isPhone ? 'left' : 'right' }}>{formatLatency(e.latencyMs)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <ResultIcon size={15} color={e.success ? c.success : c.danger} />
          <Text
            variant="bodySmall"
            weight="semibold"
            tone={e.success ? 'success' : 'danger'}
            accessibilityHint={e.errorCode ? (noticeDeclined(e) ? AI_COPY.needsCloudOk : describeAIError(e.errorCode, '', e.source).userMessage) : undefined}
          >
            {result}
          </Text>
        </View>
      </View>
    </View>
  );
}
