/**
 * One page of a document batch, laid out like a clerk checking a slip against the register: the page
 * picture on the left with a 3 x 3 pencil grid, the fields on the right. A cell with a red pen mark holds
 * a field that still needs a look; the cell of the field being edited is filled. Confidence is words and
 * an icon, never colour alone, and it is labelled as the reader's own estimate (docs/14 §9.4, docs/16 R-016).
 */
import { Check, CircleAlert, CircleCheck, CircleHelp } from 'lucide-react-native';
import { useState } from 'react';
import { Image, View } from 'react-native';

import { areaMarks, fieldText, needsAttention, PAGE_AREAS, type BatchItem, type PageArea, type ReviewField } from '@/core/document-intel';
import { Button, Chip, SourceBadge, Stamp, Surface, SwitchRow, Text, TextField, useKalamTheme, withAlpha } from '@/design';
import { useI18n } from '@/i18n/react';

import type { useDocumentBatch } from './use-document-batch';

type Batch = ReturnType<typeof useDocumentBatch>;

const PREVIEW_W = 120;

/** The page with its 3 x 3 grid. Marked cells held a field; red-pen cells still need a look; the filled one is selected. */
function PagePreview({ item, selected, label }: { item: BatchItem; selected?: PageArea; label: string }) {
  const { colors, radius } = useKalamTheme();
  const { width = 3, height = 4, image } = item.page;
  const marks = areaMarks(item.fields);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: PREVIEW_W, aspectRatio: width / height, borderRadius: radius.paper, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
    >
      <Image source={{ uri: `data:${image.mimeType};base64,${image.base64}` }} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} accessible={false} />
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }} pointerEvents="none">
        {PAGE_AREAS.map((area) => {
          const m = marks[area];
          const on = selected === area;
          return (
            <View
              key={area}
              style={{
                width: '33.333%', height: '33.333%',
                borderWidth: m?.attention ? 2 : m ? 1 : 0.5,
                borderColor: m?.attention ? colors.danger : m ? colors.borderStrong : withAlpha(colors.borderStrong, 0.4),
                backgroundColor: on ? withAlpha(colors.primary, 0.22) : m?.attention ? withAlpha(colors.danger, 0.1) : 'transparent',
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

/** Failure codes grouped by what the person can do about them. */
const ERROR_KEY: Partial<Record<NonNullable<BatchItem['error']>, string>> = {
  offline: 'offline', consent_denied: 'cloud', not_configured: 'cloud', app_check_failed: 'cloud', timeout: 'timeout', quota: 'quota',
  invalid_output: 'unreadable', model_unavailable: 'device', unsupported_modality: 'device',
};

const LEVEL = {
  high: { tone: 'success', icon: CircleCheck },
  medium: { tone: 'neutral', icon: CircleHelp },
  low: { tone: 'warning', icon: CircleAlert },
  unrated: { tone: 'neutral', icon: CircleHelp },
} as const;

function FieldRow({ f, onType, onConfirm, onDate, onClear, onFocus }: {
  f: ReviewField; onType(text: string): void; onConfirm(): void; onDate(): void; onClear(): void; onFocus(): void;
}) {
  const { space, uiLanguage } = useKalamTheme();
  const { t, td } = useI18n(uiLanguage);
  const level = f.confidence ?? (f.unsure ? 'low' : 'unrated');
  const read = f.read ?? '';
  const problem = f.issue === 'invalid' ? t('docIntel.issue.invalid', { text: read })
    : f.issue === 'ambiguous_date' ? t('docIntel.issue.date', { text: read })
      : f.issue === 'missing' ? t('docIntel.issue.missing') : undefined;
  const hasValue = f.value !== undefined;
  return (
    <View style={{ gap: space[2] }}>
      <TextField
        label={f.label}
        value={fieldText(f)}
        onChangeText={onType}
        onFocus={onFocus}
        error={problem}
        keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
        autoCorrect={false}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
        {hasValue ? <Chip label={td(`docIntel.confidence.${level}`)} tone={LEVEL[level].tone} icon={LEVEL[level].icon} /> : null}
        {f.checked && !f.issue ? <Chip label={t('docIntel.checked')} tone="success" icon={Check} /> : null}
        {hasValue && f.unsure && !f.checked && !f.issue ? <Button size="sm" variant="outline" label={t('docIntel.check')} onPress={onConfirm} /> : null}
        {f.suggestion ? <Button size="sm" variant="outline" label={t('docIntel.useDate', { date: f.suggestion })} onPress={onDate} /> : null}
        {f.issue ? <Button size="sm" variant="ghost" label={t('docIntel.leaveEmpty')} onPress={onClear} /> : null}
      </View>
      {f.area && (hasValue || f.read) ? <Text variant="caption" tone="muted">{t('docIntel.where', { area: td(`docIntel.area.${f.area}`) })}</Text> : null}
    </View>
  );
}

/** One page: its picture, where it came from, the fields to check, and the choice to add it. */
export function RecordReview({ item, index, batch }: { item: BatchItem; index: number; batch: Batch }) {
  const { space, colors, uiLanguage } = useKalamTheme();
  const { t, td } = useI18n(uiLanguage);
  const [focus, setFocus] = useState<string>();
  const { page } = item;
  const title = page.pages > 1 ? t('docIntel.pageOf', { name: page.name, page: page.page, pages: page.pages }) : page.name;
  const selected = item.fields.find((f) => f.id === focus)?.area;
  const todo = item.fields.filter(needsAttention).length;

  if (item.status !== 'read') {
    const failed = item.status === 'failed';
    return (
      <Surface tone="alt" radius="paper" padded={space[4]} style={{ gap: space[2] }}>
        <Text weight="semibold" numberOfLines={2}>{title}</Text>
        {failed ? <Stamp kind="needs" label={t('stamp.needs')} size="sm" /> : null}
        <Text tone={failed ? 'danger' : 'secondary'} accessibilityLiveRegion="polite" accessibilityRole={failed ? 'alert' : undefined}>
          {failed ? td(`docIntel.error.${ERROR_KEY[item.error ?? 'other'] ?? 'unknown'}`) : item.status === 'reading' ? t('docIntel.reading') : t('docIntel.waiting')}
        </Text>
      </Surface>
    );
  }

  return (
    <Surface bordered radius="paper" padded={space[4]} style={{ gap: space[3], borderColor: todo ? colors.danger : colors.border }}>
      <View style={{ gap: space[1] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
          <Text weight="semibold" style={{ flexShrink: 1 }} numberOfLines={2}>{title}</Text>
          {item.source ? <SourceBadge source={item.source} /> : null}
          {/* The page's verdict as a stamp: words and an icon, never colour alone. */}
          <Stamp kind={todo ? 'needs' : 'checked'} label={t(todo ? 'stamp.needs' : 'stamp.checked')} size="sm" />
        </View>
        {item.duplicate ? <Text variant="bodySmall" tone="warning">{td(`docIntel.duplicate.${item.duplicate}`)}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4], alignItems: 'flex-start' }}>
        <PagePreview item={item} selected={selected} label={t('docIntel.preview', { name: page.name, page: page.page })} />
        <View style={{ flex: 1, minWidth: 220, gap: space[3] }}>
          {item.fields.map((f) => (
            <FieldRow
              key={f.id}
              f={f}
              onFocus={() => setFocus(f.id)}
              onType={(text) => batch.type(index, f.id, text)}
              onConfirm={() => batch.confirm(index, f.id)}
              onDate={() => batch.takeDate(index, f.id)}
              onClear={() => batch.clear(index, f.id)}
            />
          ))}
        </View>
      </View>
      <SwitchRow
        label={t('docIntel.include')}
        value={item.accepted ?? !item.duplicate}
        onValueChange={(on) => batch.include(index, on)}
      />
    </Surface>
  );
}
