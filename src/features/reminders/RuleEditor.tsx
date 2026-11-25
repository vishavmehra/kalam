import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, SegmentedControl, Surface, SwitchRow, Text, TextField, useKalamTheme } from '@/design';

import { describeRule, formatTimeOfDay, LEAD_PRESETS, leadLabel, TIME_PRESETS } from './format';
import {
  collectionOf, listBooleanFields, listDateFields, pickFinishedField, retargetRule, withSkipFinished,
} from './rules';
import { REMINDER_LIMITS, type ReminderRule, type SpecView } from './types';
import { parseTimeOfDay } from './zone';

interface Props {
  spec: SpecView;
  rule: ReminderRule;
  /** Why the rule cannot run (a field was removed), if so. */
  problem?: string;
  onChange(next: ReminderRule): void;
  onRemove(): void;
}

/** Accepts '7:30' or '07:30' and returns '07:30', or undefined. */
function normalizeTime(text: string): string | undefined {
  const t = text.trim();
  const padded = /^\d:\d{2}$/.test(t) ? `0${t}` : t;
  return parseTimeOfDay(padded) ? padded : undefined;
}

function withExtra(values: readonly string[], current: string): string[] {
  return values.includes(current) ? [...values] : [...values, current].sort();
}

/** One reminder: an on/off row with a summary, and details that open below it. */
export function RuleEditor({ spec, rule, problem, onChange, onRemove }: Props) {
  const theme = useKalamTheme();
  const [open, setOpen] = useState(false);
  const [timeText, setTimeText] = useState(rule.timeOfDay);
  const [messageText, setMessageText] = useState(rule.message ?? '');
  useEffect(() => setTimeText(rule.timeOfDay), [rule.timeOfDay]);
  useEffect(() => setMessageText(rule.message ?? ''), [rule.message]);

  const dates = useMemo(() => listDateFields(spec), [spec]);
  const collection = collectionOf(spec, rule.collection);
  const booleans = collection ? listBooleanFields(collection) : [];
  const severalLists = new Set(dates.map((d) => d.collection)).size > 1;
  const skipField = rule.condition?.op === 'is_false' ? rule.condition.field : undefined;
  const { title, detail } = describeRule(spec, rule);
  const timeError = normalizeTime(timeText) ? undefined : 'Use 24 hour time, like 07:30.';

  const leadValues = withExtra(LEAD_PRESETS.map(String), String(rule.leadDays)).sort((a, b) => Number(a) - Number(b));
  const timeValues = withExtra(TIME_PRESETS, rule.timeOfDay);

  return (
    <Surface padded={theme.space[4]} style={{ gap: theme.space[3] }} testID={`reminder-rule-${rule.id}`}>
      <SwitchRow
        label={title}
        description={detail}
        value={rule.enabled}
        onValueChange={(enabled) => onChange({ ...rule, enabled })}
      />
      {problem ? <Text tone="danger">{problem}</Text> : null}
      <Button
        label={open ? 'Hide details' : 'Change details'}
        variant="ghost"
        size="sm"
        icon={open ? ChevronUp : ChevronDown}
        onPress={() => setOpen((o) => !o)}
      />
      {open ? (
        <View style={{ gap: theme.space[4] }}>
          {dates.length > 1 ? (
            <SegmentedControl
              label="Date to watch"
              wrap
              value={`${rule.collection}.${rule.dateField}`}
              options={dates.map((d) => ({
                value: `${d.collection}.${d.field}`,
                label: severalLists ? `${d.collectionLabel}: ${d.fieldLabel}` : d.fieldLabel,
              }))}
              onChange={(v) => {
                const [c, f] = v.split('.');
                onChange(retargetRule(rule, spec, c, f));
              }}
            />
          ) : null}
          <SegmentedControl
            label="Remind me"
            wrap
            value={String(rule.leadDays)}
            options={leadValues.map((v) => ({ value: v, label: leadLabel(Number(v)) }))}
            onChange={(v) => onChange({ ...rule, leadDays: Number(v) })}
          />
          <SegmentedControl
            label="At what time"
            wrap
            value={rule.timeOfDay}
            options={timeValues.map((v) => ({ value: v, label: formatTimeOfDay(v) }))}
            onChange={(v) => onChange({ ...rule, timeOfDay: v })}
          />
          <TextField
            label="Other time"
            value={timeText}
            onChangeText={setTimeText}
            onBlur={() => {
              const t = normalizeTime(timeText);
              if (t && t !== rule.timeOfDay) onChange({ ...rule, timeOfDay: t });
            }}
            error={timeError}
            helper="24 hour time, like 07:30."
            maxLength={5}
          />
          {booleans.length ? (
            <View style={{ gap: theme.space[2] }}>
              <SwitchRow
                label="Skip finished items"
                description={`Items marked "${booleans.find((b) => b.field === (skipField ?? pickFinishedField(collection!)))?.label ?? 'done'}" will not remind you.`}
                value={skipField !== undefined}
                onValueChange={(on) => onChange(withSkipFinished(rule, on && collection ? pickFinishedField(collection) : undefined))}
              />
              {skipField !== undefined && booleans.length > 1 ? (
                <SegmentedControl
                  label="Finished means"
                  wrap
                  value={skipField}
                  options={booleans.map((b) => ({ value: b.field, label: b.label }))}
                  onChange={(v) => onChange(withSkipFinished(rule, v))}
                />
              ) : null}
            </View>
          ) : null}
          <TextField
            label="Message (optional)"
            value={messageText}
            onChangeText={setMessageText}
            onBlur={() => {
              const next = messageText.trim();
              if (next === (rule.message ?? '')) return;
              onChange(next ? { ...rule, message: next } : { ...rule, message: undefined });
            }}
            maxLength={REMINDER_LIMITS.messageLength}
            helper="Leave empty for a standard message. Write {title} to include the item's name."
          />
          <Button label="Remove reminder" variant="outline" icon={Trash2} onPress={onRemove} />
        </View>
      ) : null}
    </Surface>
  );
}
