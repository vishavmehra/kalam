import { Eye, List, RotateCcw, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { AppVersion } from '@/core/contracts';
import {
  buildTimeline, CATEGORY_LABELS, CHANGE_CATEGORIES, filterTimeline,
  type ChangeCategory, type TimelineEntry,
} from '@/core/history';
import { Button, Chip, Slip, Text } from '@/design';

import { CATEGORY_ICON } from './ChangeList';
import { copy } from './copy';
import { formatClock, formatDayHeading } from './format';
import { entryLines } from './model';
import { VersionDiffSheet } from './VersionDiffSheet';

export interface VersionTimelineProps {
  /** Null while loading. */
  versions: AppVersion[] | null;
  /** Version number of the app right now. */
  current: number;
  lang: string;
  /** Version being restored right now. */
  restoring?: number | null;
  /** True while a proposed change is waiting: restoring would silently drop it. */
  blocked?: boolean;
  /** Version shown in the preview right now, if any. */
  previewing?: number | null;
  /** True while a preview is loading. Every Preview button is off until it is done, so two previews cannot race. */
  previewPending?: boolean;
  onPreview?: (version: number) => void;
  /** Asks to restore. The screen confirms and saves; this component writes nothing. */
  onRestore: (version: number) => void;
  /** Clock for the Today and Yesterday headings. Tests pass a fixed value. */
  now?: number;
  /** Colour behind the slips, for their perforated tops. Default the page canvas. */
  behind?: string;
}

function Entry({ e, lang, behind, restoring, blocked, previewing, previewPending, onOpen, onPreview, onRestore }: {
  e: TimelineEntry;
  lang: string;
  behind?: string;
  restoring: number | null;
  blocked: boolean;
  previewing: number | null;
  previewPending: boolean;
  onOpen: () => void;
  onPreview?: () => void;
  onRestore: () => void;
}) {
  const lines = entryLines(e);
  // Each version is an order-book slip with its number in sindoor ink ("No. 07"), DIRECTION §6 and §7.
  return (
    <View role="listitem">
      <Slip number={e.version} tint={e.current ? 'leaf' : 'kraft'} behind={behind} style={{ paddingTop: 22, paddingBottom: 16, gap: 10 }}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Chip label={e.current ? copy.timeline.current : copy.timeline.events[e.event]} tone={e.current ? 'primary' : 'neutral'} />
            {e.origin && !(e.origin === 'import' && e.event === 'imported') ? <Chip label={copy.timeline.origins[e.origin]} /> : null}
            <Text variant="caption" tone="muted" numeric>{formatClock(e.createdAt, lang)}</Text>
          </View>
          {lines.primary ? <Text>{lines.primary}</Text> : null}
          {lines.secondary ? <Text variant="bodySmall" tone="secondary">{lines.secondary}</Text> : null}
          {e.categories.length || e.impact === 'data' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {e.categories.map((c) => <Chip key={c} label={CATEGORY_LABELS[c]} icon={CATEGORY_ICON[c]} />)}
              {e.impact === 'data' ? <Chip label={copy.timeline.dataTouched} tone="warning" icon={TriangleAlert} /> : null}
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button
            label={copy.timeline.seeChanges}
            variant="ghost"
            size="md"
            icon={List}
            accessibilityHint={copy.timeline.seeChangesHint(e.version)}
            onPress={onOpen}
          />
          {e.current ? null : (
            <>
              {onPreview ? (
                <Button
                  label={previewing === e.version ? copy.timeline.showing : copy.timeline.preview}
                  variant="ghost"
                  size="md"
                  icon={Eye}
                  disabled={previewing === e.version || previewPending}
                  accessibilityHint={copy.timeline.previewHint(e.version)}
                  onPress={onPreview}
                />
              ) : null}
              <Button
                label={copy.timeline.restore}
                variant="outline"
                size="md"
                icon={RotateCcw}
                loading={restoring === e.version}
                disabled={blocked || restoring !== null}
                accessibilityHint={copy.timeline.restoreHint(e.version)}
                onPress={onRestore}
              />
            </>
          )}
        </View>
      </Slip>
    </View>
  );
}

/**
 * Time Machine (docs/14 §11.3): every saved version by day, with what kind of change it was, who made it when that
 * is recorded, a plain-English summary, and restore. Reads the versions it is given and writes nothing.
 */
export function VersionTimeline({
  versions, current, lang, restoring = null, blocked = false, previewing = null, previewPending = false, onPreview, onRestore, now, behind,
}: VersionTimelineProps) {
  const [filter, setFilter] = useState<ChangeCategory[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const days = useMemo(() => (versions ? buildTimeline(versions, { current }) : []), [versions, current]);
  const present = useMemo(
    () => CHANGE_CATEGORIES.filter((c) => days.some((d) => d.entries.some((e) => e.categories.includes(c)))),
    [days],
  );
  const shown = useMemo(() => filterTimeline(days, filter), [days, filter]);

  if (!versions) return <Text tone="muted" accessibilityLiveRegion="polite">{copy.timeline.loading}</Text>;
  if (!versions.length) return <Text tone="muted">{copy.timeline.empty}</Text>;

  const toggle = (c: ChangeCategory) => setFilter((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]));
  const clock = now ?? mountedAt;

  return (
    <View style={{ gap: 16 }}>
      {blocked ? <Text variant="bodySmall" tone="muted">{copy.timeline.blocked}</Text> : null}

      {present.length > 1 ? (
        <View role="group" aria-label={copy.timeline.filterLabel} style={{ gap: 6 }}>
          <Text variant="caption" tone="muted">{copy.timeline.filterLabel}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={copy.timeline.filterAll} selected={!filter.length} onPress={() => setFilter([])} />
            {present.map((c) => (
              <Chip key={c} label={CATEGORY_LABELS[c]} icon={CATEGORY_ICON[c]} selected={filter.includes(c)} onPress={() => toggle(c)} />
            ))}
          </View>
        </View>
      ) : null}

      {shown.length === 0 ? <Text tone="muted">{copy.timeline.noMatches}</Text> : null}

      {shown.map((d) => (
        <View key={d.key} style={{ gap: 8 }}>
          <Text variant="h4">{formatDayHeading(d.start, clock, lang)}</Text>
          <View role="list" style={{ gap: 12 }}>
            {d.entries.map((e) => (
              <Entry
                key={e.version}
                e={e}
                lang={lang}
                behind={behind}
                restoring={restoring}
                blocked={blocked}
                previewing={previewing}
                previewPending={previewPending}
                onOpen={() => setOpen(e.version)}
                onPreview={onPreview ? () => onPreview(e.version) : undefined}
                onRestore={() => onRestore(e.version)}
              />
            ))}
          </View>
        </View>
      ))}

      <VersionDiffSheet
        visible={open !== null}
        version={open}
        versions={versions}
        current={current}
        lang={lang}
        onClose={() => setOpen(null)}
        onRestore={(v) => { setOpen(null); onRestore(v); }}
        restoring={restoring !== null && restoring === open}
        busy={restoring !== null}
        blocked={blocked}
      />
    </View>
  );
}
