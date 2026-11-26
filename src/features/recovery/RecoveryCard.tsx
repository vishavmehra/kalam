import { LifeBuoy } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Surface, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { actionKey, planRecovery, type RecoveryOrigin } from './plan';
import { applyRecovery, availableActions, noteDismissed, noteShown, type RecoveryHandlers } from './recover';

export interface RecoveryCardProps {
  /** A stable error code, or an error that carries one. Anything else shows the plain fallback and never its text. */
  error: unknown;
  /** Where the failure came from, when the code alone cannot say (a design check fails for AI, import and Bazaar alike). */
  origin?: RecoveryOrigin;
  /**
   * What this screen can actually do for each action (retry the build, open Settings). Only actions the plan lists
   * for this failure AND that have a function here get a button, so a button never does nothing.
   */
  handlers?: RecoveryHandlers;
  /** Shows a close button. Called after the dismissal is noted. */
  onDismiss?: () => void;
}

/**
 * What failed, what was kept, and what the person can do (docs/14 §14.3). It records that it was shown,
 * and what the person did, in the recovery log. The press on an action is the confirmation: nothing
 * runs on its own. Uses only design-system parts and translated text.
 */
export function RecoveryCard({ error, origin, handlers = {}, onDismiss }: RecoveryCardProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const plan = useMemo(() => planRecovery(error, origin), [error, origin]);
  // The plan that last failed, so a new failure starts clean without resetting state in an effect.
  const [failedFor, setFailedFor] = useState<typeof plan | undefined>();
  const failed = failedFor === plan;
  const [busy, setBusy] = useState(false);
  const actions = availableActions(plan, handlers);

  useEffect(() => {
    noteShown(plan);
  }, [plan]);

  const run = async (action: (typeof actions)[number]) => {
    setBusy(true);
    setFailedFor(undefined);
    const result = await applyRecovery(plan, action, handlers);
    setBusy(false);
    setFailedFor(result === 'failed' ? plan : undefined);
  };

  return (
    <Surface tone="alt" padded={20} style={{ gap: 12 }} role="alert" accessibilityLabel={t(plan.what)}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <LifeBuoy size={22} color={theme.colors.text} />
        <Text variant="h4" style={{ flex: 1 }}>{t(plan.what)}</Text>
      </View>

      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="secondary">{t('recovery.card.keptLabel')}</Text>
        <Text>{t(plan.kept)}</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="secondary">{t('recovery.card.nextLabel')}</Text>
        <Text tone="secondary">{plan.retryable ? t('recovery.card.canRetry') : t('recovery.card.cannotRetry')}</Text>
        {actions.map((action, i) => (
          <Button
            key={action}
            label={t(actionKey(action))}
            variant={i === 0 ? 'primary' : 'outline'}
            loading={busy}
            onPress={() => void run(action)}
          />
        ))}
        {failed ? <Text tone="danger" role="alert">{t('recovery.log.outcome.failed')}</Text> : null}
      </View>

      {onDismiss ? (
        <Button
          label={t('common.close')}
          variant="ghost"
          onPress={() => {
            noteDismissed(plan);
            onDismiss();
          }}
        />
      ) : null}
    </Surface>
  );
}
