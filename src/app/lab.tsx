/**
 * `/lab`: developer-only evaluation page (docs/13 §9.4). Runs one golden case through the real classifier and
 * template pipeline, and through the real AI only when you switch that on, then shows the route, provider, model,
 * latency and validation. It renders nothing in a production build, and the golden data is not bundled there.
 *
 * Every run here is either deterministic (no model) or real. Nothing in this page is mocked: mocked runs live in the
 * unit tests, so a result here can be trusted as what a person would get.
 */
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

import { useAIStatus } from '@/components/status/useHybridStatus';
import { classifyRequest } from '@/core/classifier';
import { createApplicationPipeline } from '@/core/pipeline/create-application';
import { describeSpec } from '@/core/spec/describe';
import { validateSpec } from '@/core/spec/validate';
import { Button, Chip, Screen, SourceBadge, Surface, Text, useKalamTheme, type ExecutionSource } from '@/design';
import { summarizeDrawing } from '@/features/drawing/model/summarize';
import { getServices } from '@/services';
import type {
  CaseResult,
  Dataset,
  EvalDeps,
  GoldenExpected,
  GoldenModalityCase,
  GoldenSketchCase,
  GoldenTextCase,
} from '../../tests/evaluation/runner';

type Runner = typeof import('../../tests/evaluation/runner');
type Smoke = typeof import('../../tests/evaluation/runner/runtime-smoke');

interface LabData {
  runner: Runner;
  smoke: Smoke;
  version: string;
  text: GoldenTextCase[];
  sketches: GoldenSketchCase[];
  modalities: GoldenModalityCase[];
}

// The branch is removed from production bundles because `__DEV__` is a literal false there.
const LAB: LabData | null = __DEV__
  ? {
      /* eslint-disable @typescript-eslint/no-require-imports */
      runner: require('../../tests/evaluation/runner'),
      smoke: require('../../tests/evaluation/runner/runtime-smoke'),
      version: require('../../tests/evaluation/golden/dataset.json').datasetVersion,
      text: require('../../tests/evaluation/golden/text-requests.json').cases,
      sketches: require('../../tests/evaluation/golden/sketches.json').cases,
      modalities: require('../../tests/evaluation/golden/modalities.json').cases,
      /* eslint-enable @typescript-eslint/no-require-imports */
    }
  : null;

export default function LabRoute() {
  if (!__DEV__ || !LAB) return null;
  return <LabScreen lab={LAB} />;
}

// ─── Cases ─────────────────────────────────────────────────────────────────────────────────
interface LabCase {
  id: string;
  dataset: Dataset;
  summary: string;
  lines: string[];
  expected: GoldenExpected;
  ambiguous: boolean;
  needsAssets?: string;
  run: (deps: EvalDeps, opts: Parameters<Runner['evaluateTextCase']>[2]) => Promise<CaseResult>;
}

function buildCases(lab: LabData): LabCase[] {
  const { runner } = lab;
  const text = lab.text.map<LabCase>((c) => ({
    id: c.id,
    dataset: 'text',
    summary: c.text,
    lines: [`Language: ${c.language}`, ...(c.notes ? [c.notes] : [])],
    expected: c.expected,
    ambiguous: !!c.ambiguous,
    run: (d, o) => runner.evaluateTextCase(c, d, o),
  }));
  const sketches = lab.sketches.map<LabCase>((c) => ({
    id: c.id,
    dataset: 'sketch',
    summary: `${c.title} (${c.pages.length} page${c.pages.length === 1 ? '' : 's'})`,
    lines: [
      ...c.pages.map(
        (p) =>
          `${p.title}: ${p.items.map((i) => ('stamp' in i ? (i.label ?? i.stamp) : 'text' in i ? i.text : (i.label ?? i.box))).join(', ')}`,
      ),
      ...(c.notes ? [c.notes] : []),
    ],
    expected: c.expected,
    ambiguous: !!c.ambiguous,
    run: (d, o) => runner.evaluateSketchCase(c, d, o),
  }));
  const modalities = lab.modalities.map<LabCase>((c) => ({
    id: c.id,
    dataset: c.modality,
    summary: c.text ?? c.audioTranscript ?? c.video?.summary ?? (c.sketch ? `Sketch ${c.sketch}` : c.id),
    lines: [
      ...(c.images ? [`${c.images.count} placeholder ${c.images.source}(s)`] : []),
      ...(c.video ? [`${c.video.frames} placeholder frame(s), ${c.video.durationSec} s`] : []),
      ...(c.audioTranscript ? [`Voice note transcript: ${c.audioTranscript}`] : []),
      ...(c.sketch ? [`Includes sketch ${c.sketch}`] : []),
      ...(c.notes ? [c.notes] : []),
    ],
    expected: c.expected,
    ambiguous: !!c.ambiguous,
    needsAssets: c.needsAssets,
    run: (d, o) => runner.evaluateModalityCase(c, lab.sketches, d, o),
  }));
  return [...text, ...sketches, ...modalities];
}

const DATASETS: Dataset[] = ['text', 'sketch', 'image', 'audio', 'video', 'mixed'];

/** Where the answer really came from, read from the result and never from the preference. */
function sourceOf(r: CaseResult): ExecutionSource {
  const route = r.build.route ?? '';
  if (!r.build.ok && r.build.provider === 'none') return 'offline';
  if (route.includes('on_device')) return 'on_device';
  if (route.startsWith('cloud')) return 'cloud';
  return 'deterministic';
}

const INFERENCE: Record<ExecutionSource, string> = {
  on_device: 'Real device inference (Gemini Nano)',
  cloud: 'Real cloud inference (Firebase AI Logic)',
  deterministic: 'Deterministic: no model was used',
  offline: 'No model reachable: the request failed as it should',
};

interface HistoryItem {
  at: number;
  id: string;
  real: boolean;
  passed: boolean;
  ms: number;
  source: ExecutionSource;
}

// ─── Screen ────────────────────────────────────────────────────────────────────────────────
function LabScreen({ lab }: { lab: LabData }) {
  const theme = useKalamTheme();
  const { status, error: statusError, refresh } = useAIStatus();
  const cases = useMemo(() => buildCases(lab), [lab]);
  const [filter, setFilter] = useState<Dataset>('text');
  const [selectedId, setSelectedId] = useState<string>(cases[0]?.id ?? '');
  const [allowCloud, setAllowCloud] = useState(false);
  const [running, setRunning] = useState<'offline' | 'real' | null>(null);
  const [result, setResult] = useState<{ r: CaseResult; real: boolean } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const shown = cases.filter((c) => c.dataset === filter);
  const selected = cases.find((c) => c.id === selectedId);

  const run = useCallback(
    async (real: boolean) => {
      if (!selected) return;
      setRunning(real ? 'real' : 'offline');
      try {
        const { runner, smoke } = lab;
        const services = real ? getServices() : undefined;
        const deps: EvalDeps = {
          classify: classifyRequest,
          createApplication: services
            ? services.createApplication
            : createApplicationPipeline({ ai: runner.createOfflineAI(), specialistConsent: () => false }),
          validate: validateSpec,
          describe: describeSpec,
          summarizeDrawing,
          runtimeSmoke: smoke.runtimeSmoke,
          now: () => performance.now(),
        };
        const r = await selected.run(deps, {
          mode: real ? 'live' : 'deterministic',
          beforeCloud: () =>
            allowCloud
              ? undefined
              : 'Cloud requests are switched off. Turn on "Allow one cloud request" to run this case.',
        });
        setResult({ r, real });
        setHistory((h) =>
          [
            {
              at: Date.now(),
              id: r.id,
              real,
              passed: r.failures.length === 0,
              ms: r.latencyMs.total,
              source: sourceOf(r),
            },
            ...h,
          ].slice(0, 30),
        );
        if (real) void refresh();
      } finally {
        setRunning(null);
      }
    },
    [allowCloud, lab, refresh, selected],
  );

  const ms = history.map((h) => h.ms);
  const passRate = history.length ? Math.round((100 * history.filter((h) => h.passed).length) / history.length) : null;
  const onDevice = status?.onDevice;

  return (
    <Screen maxWidth={980}>
      <View style={{ gap: theme.space[5] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="h2">Evaluation lab</Text>
          <Chip label="Development build only" tone="warning" />
          <Text tone="secondary">
            Runs one golden case ({cases.length} cases, dataset {lab.version}). Every run is deterministic or real.
            Nothing here is mocked.
          </Text>
        </View>

        <Surface padded tone="alt" accessibilityLabel="Inference capabilities">
          <Text variant="h4">What this device can do</Text>
          <Row label="Platform" value={`${Platform.OS}${onDevice ? ` (${onDevice.platform})` : ''}`} />
          <Row
            label="On-device model"
            value={
              statusError ??
              (onDevice
                ? `${onDevice.availability}${onDevice.warm ? ', loaded' : ''}${onDevice.apiExposed ? '' : ', no API here'}`
                : 'checking')
            }
          />
          <Row
            label="Cloud (Firebase AI Logic)"
            value={status ? (status.cloudConfigured ? 'configured' : 'not configured') : 'checking'}
          />
          <Row label="Network" value={status ? (status.online ? 'online' : 'offline') : 'checking'} />
          <Button label="Refresh status" variant="outline" size="sm" onPress={() => void refresh()} />
        </Surface>

        <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup" aria-label="Dataset">
          <Text variant="h4">Test list</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {DATASETS.map((d) => (
              <Chip
                key={d}
                role="radio"
                label={`${d} (${cases.filter((c) => c.dataset === d).length})`}
                selected={filter === d}
                onPress={() => {
                  setFilter(d);
                  const first = cases.find((c) => c.dataset === d);
                  if (first) setSelectedId(first.id);
                }}
              />
            ))}
          </View>
          <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
            {shown.map((c) => {
              const last = history.find((h) => h.id === c.id);
              return (
                <Pressable
                  key={c.id}
                  role="radio"
                  aria-checked={selectedId === c.id}
                  aria-label={`${c.id}. ${c.summary}`}
                  onPress={() => setSelectedId(c.id)}
                  style={{
                    minHeight: theme.touchTarget,
                    justifyContent: 'center',
                    paddingVertical: theme.space[2],
                    paddingHorizontal: theme.space[3],
                    borderRadius: theme.radius.md,
                    backgroundColor: selectedId === c.id ? theme.colors.primarySoft : 'transparent',
                  }}
                >
                  <Text weight="semibold">
                    {c.id}
                    {last ? (last.passed ? '  (passed)' : '  (failed)') : ''}
                  </Text>
                  <Text variant="bodySmall" tone="secondary" numberOfLines={2}>
                    {c.summary}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {selected ? (
          <Surface padded>
            <Text variant="h4">{selected.id}</Text>
            <Text>{selected.summary}</Text>
            {selected.lines.map((l) => (
              <Text key={l} variant="bodySmall" tone="secondary">
                {l}
              </Text>
            ))}
            <Row
              label="Expected"
              value={`${selected.expected.complexity}, ${selected.expected.route === 'template' ? `template ${selected.expected.template}` : 'cloud'}, at least ${selected.expected.minScreens} screen(s) and ${selected.expected.minCollections} collection(s)`}
            />
            <Row label="Labels reviewed by a person" value="not yet (machine-authored)" />
            {selected.ambiguous ? (
              <Row label="Ambiguous" value="reasonable reviewers could label this differently" />
            ) : null}
            {selected.needsAssets ? <Row label="Needs a real asset" value={selected.needsAssets} /> : null}

            <View style={{ gap: theme.space[3], marginTop: theme.space[3] }}>
              <Button
                label="Run offline (no model)"
                loading={running === 'offline'}
                disabled={!!running}
                onPress={() => void run(false)}
              />
              <Chip
                role="checkbox"
                label="Allow one cloud request (costs money)"
                selected={allowCloud}
                onPress={() => setAllowCloud((v) => !v)}
              />
              <Button
                label="Run with the real AI"
                variant="secondary"
                loading={running === 'real'}
                disabled={!!running || !!selected.needsAssets}
                accessibilityHint={
                  selected.needsAssets
                    ? 'This case needs a real photo or recording first.'
                    : 'Uses on-device or cloud AI where the case needs it.'
                }
                onPress={() => void run(true)}
              />
            </View>
          </Surface>
        ) : null}

        {result ? <ResultCard r={result.r} real={result.real} /> : null}

        <Surface padded tone="alt">
          <Text variant="h4">This session</Text>
          <Row label="Runs" value={String(history.length)} />
          <Row label="Pass rate" value={passRate === null ? 'no runs yet' : `${passRate}%`} />
          <Row label="Median latency" value={ms.length ? `${lab.runner.median(ms)} ms` : 'no runs yet'} />
          {history.slice(0, 8).map((h) => (
            <Text key={h.at} variant="bodySmall" tone="secondary">
              {new Date(h.at).toLocaleTimeString()} {h.id} {h.real ? 'real' : 'offline'}{' '}
              {h.passed ? 'passed' : 'failed'} {h.ms} ms {h.source}
            </Text>
          ))}
          <Text variant="bodySmall" tone="muted">
            History is kept in memory and cleared on reload. Reports from scripts/eval.mjs are in
            tests/evaluation/reports.
          </Text>
        </Surface>
      </View>
    </Screen>
  );
}

function ResultCard({ r, real }: { r: CaseResult; real: boolean }) {
  const theme = useKalamTheme();
  const source = sourceOf(r);
  const passed = r.failures.length === 0;
  return (
    <Surface padded tone={passed ? 'primarySoft' : 'accentSoft'} accessibilityLabel="Result">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text variant="h4">{passed ? 'Passed' : `${r.failures.length} check(s) failed`}</Text>
        <SourceBadge source={source} size="md" />
      </View>
      <Text variant="bodySmall" tone="secondary">
        {real ? 'Real run' : 'Offline run'}. {INFERENCE[source]}.
      </Text>
      <Row
        label="Route"
        value={`${r.classification.route}${r.classification.template ? ` (${r.classification.template})` : ''}, ${r.classification.complexity}, confidence ${r.classification.confidence}`}
      />
      <Row
        label="Build"
        value={
          r.build.stage === 'skipped'
            ? `not run: ${r.build.skippedReason}`
            : `${r.build.stage}, ${r.build.ok ? 'built' : 'failed'}${r.build.route ? `, route ${r.build.route}` : ''}`
        }
      />
      <Row label="Provider" value={`${r.build.provider ?? 'none'}${r.build.model ? `, model ${r.build.model}` : ''}`} />
      <Row
        label="Latency"
        value={`${r.latencyMs.total} ms (classify ${r.latencyMs.classify} ms, build ${r.latencyMs.build} ms)`}
      />
      <Row
        label="Validation"
        value={
          r.build.stage === 'skipped'
            ? 'nothing to validate'
            : `${r.build.valid ? 'valid' : 'not valid'} spec, ${r.build.describeOk ? 'summary ok' : 'no summary'}, ${r.build.warnings} warning(s)`
        }
      />
      {r.runtime ? (
        <Row
          label="Runtime smoke"
          value={r.runtime.ok ? `${r.runtime.evaluated} formulas and lists ran` : r.runtime.failed.join('; ')}
        />
      ) : null}
      {r.offline ? (
        <Row
          label="Offline behaviour"
          value={
            r.offline.graceful
              ? 'failed gracefully with no model'
              : `not graceful: ${r.offline.message ?? 'no message'}`
          }
        />
      ) : null}
      {r.build.errors.map((e) => (
        <Text key={e} variant="bodySmall" tone="danger">
          {e}
        </Text>
      ))}
      {r.failures.map((f) => (
        <Text key={f} variant="bodySmall" tone="danger">
          {f}
        </Text>
      ))}
    </Surface>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingVertical: 4 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="bodySmall">{value}</Text>
    </View>
  );
}
