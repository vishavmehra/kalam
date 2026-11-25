import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, EmptyState, Text, useKalamTheme } from '@/design';

import { DueTodayView } from './DueTodayList';
import { describeWhen } from './format';
import { useNotificationCapability, useNow, useReminderData } from './hooks';
import { PermissionNotice } from './PermissionNotice';
import { RuleEditor } from './RuleEditor';
import { listDateFields, nextRuleId, ruleProblem, suggestRule } from './rules';
import { syncReminders } from './runtime';
import { computeDue, computePlan } from './scheduler';
import { REMINDER_LIMITS, type ReminderConfig, type ReminderRule, type SpecView } from './types';
import { localZone } from './zone';

const UPCOMING_SHOWN = 5;

/**
 * Smart Reminders for one app (docs/14 §10): the "Due today" list, notification permission, the
 * reminder rules, and the next five reminders. It is self-contained: it reads and saves settings
 * on this device and works offline. Mount it inside a scrolling container (a Sheet or a screen).
 *
 *   <RemindersPanel spec={app.spec} appId={app.id} />
 */
export function RemindersPanel({ spec, appId }: { spec: SpecView; appId: string }) {
  const theme = useKalamTheme();
  const { config, records, loaded, save } = useReminderData(appId);
  const { capability, request, openSettings } = useNotificationCapability();
  const now = useNow();
  const [error, setError] = useState<string | undefined>();

  const rules = config?.rules ?? [];
  const hasDates = useMemo(() => listDateFields(spec).length > 0, [spec]);
  const due = useMemo(() => computeDue({ spec, records, config, now }), [spec, records, config, now]);
  const upcoming = useMemo(
    () => computePlan({ appId, spec, records, config, now }).upcoming.slice(0, UPCOMING_SHOWN),
    [appId, spec, records, config, now],
  );

  const persist = async (next: ReminderRule[]) => {
    setError(undefined);
    try {
      await save({ version: 1, rules: next } satisfies ReminderConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your reminder settings could not be saved.');
    }
  };

  const addRule = () => {
    const base = suggestRule(spec);
    if (!base) return;
    void persist([...rules, { ...base, id: nextRuleId(rules) }]);
  };

  const allow = async () => {
    const next = await request();
    // Anything already set up gets scheduled as soon as permission is given.
    if (next.permission === 'granted') void syncReminders(appId);
    return next;
  };

  return (
    <View style={{ gap: theme.space[6] }} testID="reminders-panel">
      <DueTodayView due={due} loaded={loaded} />

      <View style={{ gap: theme.space[4] }}>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="h4">Reminders</Text>
          <Text tone="secondary">Get a notification before something is due. This works without internet.</Text>
        </View>

        <PermissionNotice capability={capability} onRequest={allow} onOpenSettings={openSettings} />

        {!hasDates ? (
          <EmptyState
            title="Nothing to remind you about"
            description="This app has no date field. Add one, like a due date, and reminders can use it."
          />
        ) : (
          <>
            {rules.map((rule) => (
              <RuleEditor
                key={rule.id}
                spec={spec}
                rule={rule}
                problem={ruleProblem(rule, spec)}
                onChange={(next) => void persist(rules.map((r) => (r.id === rule.id ? next : r)))}
                onRemove={() => void persist(rules.filter((r) => r.id !== rule.id))}
              />
            ))}
            {error ? <Text tone="danger">{error}</Text> : null}
            {rules.length < REMINDER_LIMITS.rulesPerApp ? (
              <Button
                label={rules.length ? 'Add another reminder' : 'Add a reminder'}
                icon={Plus}
                variant={rules.length ? 'outline' : 'primary'}
                onPress={addRule}
              />
            ) : null}
          </>
        )}
      </View>

      <View style={{ gap: theme.space[3] }} testID="reminders-upcoming">
        <Text variant="h4">Coming up</Text>
        {upcoming.length ? (
          upcoming.map((n) => (
            <View
              key={n.id}
              style={{
                gap: 2, minHeight: theme.touchTarget, paddingVertical: theme.space[2],
                borderBottomWidth: 1, borderBottomColor: theme.colors.border,
              }}
            >
              <Text weight="medium">{n.body}</Text>
              <Text variant="bodySmall" tone="secondary">{describeWhen(n.fireAt, now, localZone)}</Text>
            </View>
          ))
        ) : (
          <Text tone="secondary">No reminders are waiting. Add an item with a future date and it will show up here.</Text>
        )}
      </View>
    </View>
  );
}
