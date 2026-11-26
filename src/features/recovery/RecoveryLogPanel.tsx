import { Trash2 } from 'lucide-react-native';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { recoveryLog, type RecoveryEntry } from '@/core/observability';
import { Button, Surface, Text, useKalamTheme } from '@/design';
import { SectionHeading } from '@/features/settings/Section';
import { useFormat, useT } from '@/i18n/react';

import { actionKey, planRecovery } from './plan';

/** The recovery events of this session, newest first. Live: re-renders when one is added or the log is cleared. */
export function useRecoveryEntries(): readonly RecoveryEntry[] {
  const read = () => recoveryLog.recent();
  return useSyncExternalStore(recoveryLog.subscribe, read, read);
}

/**
 * Settings block: what failed, what was kept and how to try again, for each recovery event. The log is
 * in memory only, holds codes and action names only, and goes away when Kalam closes. Self-contained: it
 * draws its own heading, so mount it beside the other diagnostics groups.
 */
export function RecoveryLogPanel() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime, list } = useFormat(theme.uiLanguage);
  const entries = useRecoveryEntries();

  return (
    <View style={{ gap: 12 }}>
      <SectionHeading title={t('recovery.log.title')} description={t('recovery.log.description')} />

      <Surface padded={20} style={{ gap: 12 }}>
        {entries.length === 0 ? (
          <Text tone="secondary">{t('recovery.log.empty')}</Text>
        ) : (
          <>
            {entries.map((entry, i) => {
              const plan = planRecovery(entry.code);
              const outcome = t(`recovery.log.outcome.${entry.outcome}`);
              const how = plan.actions.length
                ? t('recovery.log.retryLine', { actions: list(plan.actions.map((a) => t(actionKey(a))), 'and') })
                : t('recovery.log.noAction');
              const when = relativeTime(entry.at);
              return (
                <View
                  key={`${entry.at}-${i}`}
                  accessible
                  accessibilityLabel={[when, t(plan.what), outcome, t(plan.kept), how].join('. ')}
                  style={{ gap: 2, paddingVertical: 4 }}
                >
                  <Text variant="caption" tone="muted">{`${when} · ${outcome}`}</Text>
                  <Text weight="medium">{t(plan.what)}</Text>
                  <Text variant="bodySmall" tone="secondary">{t(plan.kept)}</Text>
                  <Text variant="bodySmall" tone="secondary">{how}</Text>
                </View>
              );
            })}
            <Button label={t('recovery.log.clear')} variant="outline" icon={Trash2} onPress={() => recoveryLog.clear()} />
          </>
        )}
      </Surface>
    </View>
  );
}
