import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { SyncChoice } from '@/core/account-sync';
import { Button, SegmentedControl, Sheet, Text, useKalamTheme } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { useT } from '@/i18n/react';
import { startAccountSync } from '@/infrastructure/account-sync/service';

import { PassphraseFields } from './PassphraseFields';
import { useAccountSync } from './use-account-sync';

/**
 * Mount once at the app root. Starts background sync, and after the first sign-in on this device asks
 * once: apps only, apps and their records (encrypted with a passphrase), or not now. Closing the
 * sheet counts as "not now". Nothing is uploaded before an answer; Settings can change it later.
 */
export function AccountSyncPrompt() {
  useEffect(() => startAccountSync(), []);
  const { status, sync } = useAccountSync();
  const { user } = useAuthUser();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [choice, setChoice] = useState<Exclude<SyncChoice, 'off'>>('apps');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const google = !!user?.providers.includes('google.com');

  const notNow = async () => {
    if (busy) return;
    await sync.notNow();
  };
  const keep = async () => {
    if (choice === 'apps_records' && pass !== again) {
      setError(t('accountSync.passphrase.mismatch'));
      return;
    }
    setBusy(true);
    const r = await sync.setChoice(choice, choice === 'apps_records' ? pass : undefined);
    setBusy(false);
    if (!r.ok) {
      setError(t(`accountSync.problem.${r.problem}`));
      return;
    }
    setPass('');
    setAgain('');
    setError(undefined);
  };

  return (
    <Sheet
      visible={status.needsPrompt}
      onClose={() => void notNow()}
      dismissible={!busy}
      title={google ? t('accountSync.prompt.title') : t('accountSync.prompt.titleEmail')}
      description={t('accountSync.prompt.description')}
      footer={
        <>
          <Button variant="ghost" label={t('accountSync.prompt.notNow')} onPress={() => void notNow()} disabled={busy} />
          <Button label={t('accountSync.prompt.keep')} onPress={() => void keep()} loading={busy} />
        </>
      }
    >
      <View style={{ gap: 14 }}>
        <SegmentedControl
          label={t('accountSync.settings.choice')}
          wrap
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setError(undefined);
          }}
          options={[
            { value: 'apps', label: t('accountSync.prompt.apps') },
            { value: 'apps_records', label: t('accountSync.prompt.records') },
          ]}
        />
        <Text tone="secondary">{choice === 'apps' ? t('accountSync.prompt.appsHelp') : t('accountSync.prompt.recordsHelp')}</Text>
        {choice === 'apps_records' ? (
          <PassphraseFields value={pass} onChange={setPass} again={again} onAgainChange={setAgain} error={error} />
        ) : error ? (
          <Text tone="danger">{error}</Text>
        ) : null}
        <Text variant="bodySmall" tone="muted">{t('accountSync.prompt.nothingYet')}</Text>
      </View>
    </Sheet>
  );
}
