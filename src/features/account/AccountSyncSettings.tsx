import { RefreshCw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { SyncChoice } from '@/core/account-sync';
import { Button, ConfirmSheet, SegmentedControl, Text, useKalamTheme, useToast } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { useFormat, useT } from '@/i18n/react';

import { PassphraseFields } from './PassphraseFields';
import { useAccountSync } from './use-account-sync';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 6 }}>
      <Text tone="secondary" style={{ minWidth: 180 }}>{label}</Text>
      <Text weight="semibold" style={{ flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

/**
 * Settings body for "my apps in my account": the choice, status (last synced, apps in the account,
 * changes waiting), the passphrase when records are included, sync now, and removing everything from
 * the account. Wrap it in the Settings section (see the mount lines in the report).
 */
export function AccountSyncSettings() {
  const { status, sync } = useAccountSync();
  const { user, configured } = useAuthUser();
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const toast = useToast();
  const [draft, setDraft] = useState<SyncChoice | undefined>();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!configured) return <Text tone="secondary">{t('accountSync.problem.not_set_up')}</Text>;
  if (!user) return <Text tone="secondary">{t('accountSync.settings.signedOut')}</Text>;
  if (user.isAnonymous) return <Text tone="secondary">{t('accountSync.problem.guest')}</Text>;

  const current: SyncChoice = status.choice ?? 'off';
  const shown = draft ?? current;
  const askNew = shown === 'apps_records' && current !== 'apps_records';
  const askUnlock = current === 'apps_records' && (status.problem === 'needs_passphrase' || status.problem === 'passphrase_changed');

  const reset = () => {
    setDraft(undefined);
    setPass('');
    setAgain('');
    setError(undefined);
  };
  const choose = async (next: SyncChoice) => {
    setError(undefined);
    if (next === 'apps_records' && current !== 'apps_records') {
      setDraft(next); // asks for the passphrase first
      return;
    }
    setDraft(undefined);
    setBusy(true);
    const r = await sync.setChoice(next);
    setBusy(false);
    if (!r.ok) setError(t(`accountSync.problem.${r.problem}`));
  };
  const savePassphrase = async () => {
    if (askNew && pass !== again) {
      setError(t('accountSync.passphrase.mismatch'));
      return;
    }
    setBusy(true);
    const r = askNew ? await sync.setChoice('apps_records', pass) : await sync.unlockRecords(pass);
    setBusy(false);
    if (r.ok) reset();
    else setError(t(`accountSync.problem.${r.problem}`));
  };
  const remove = async () => {
    const r = await sync.removeFromAccount();
    setConfirmRemove(false);
    toast.show(r.ok ? { message: t('accountSync.settings.removed'), tone: 'success' } : { message: t(`accountSync.problem.${r.problem}`), tone: 'danger' });
  };

  const on = current !== 'off';
  const phase = t(`accountSync.phase.${status.phase}`);
  const problem = status.problem && !askUnlock ? t(`accountSync.problem.${status.problem}`) : undefined;

  return (
    <View style={{ gap: 16 }}>
      <SegmentedControl
        label={t('accountSync.settings.choice')}
        wrap
        value={shown}
        onChange={(v) => void choose(v)}
        options={[
          { value: 'off', label: t('accountSync.settings.off') },
          { value: 'apps', label: t('accountSync.prompt.apps') },
          { value: 'apps_records', label: t('accountSync.prompt.records') },
        ]}
      />
      <Text tone="secondary">
        {shown === 'apps_records' ? t('accountSync.prompt.recordsHelp') : shown === 'apps' ? t('accountSync.prompt.appsHelp') : t('accountSync.prompt.nothingYet')}
      </Text>

      {askNew || askUnlock ? (
        <View style={{ gap: 12 }}>
          {askUnlock ? <Text tone="warning">{t(`accountSync.problem.${status.problem ?? 'needs_passphrase'}`)}</Text> : null}
          <PassphraseFields
            value={pass}
            onChange={setPass}
            {...(askNew ? { again, onAgainChange: setAgain } : {})}
            error={error}
          />
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Button label={askNew ? t('accountSync.passphrase.save') : t('accountSync.passphrase.unlock')} onPress={() => void savePassphrase()} loading={busy} />
            {askNew ? <Button variant="ghost" label={t('common.cancel')} onPress={reset} disabled={busy} /> : null}
          </View>
        </View>
      ) : error ? (
        <Text tone="danger">{error}</Text>
      ) : null}

      {on ? (
        <View accessibilityRole="summary">
          <Row label={t('accountSync.settings.status')} value={phase} />
          <Row label={t('accountSync.settings.lastSynced')} value={status.lastSyncAt ? relativeTime(status.lastSyncAt) : t('accountSync.settings.never')} />
          <Row label={t('accountSync.settings.appsInAccount')} value={String(status.appsInAccount)} />
          <Row label={t('accountSync.settings.pending')} value={String(status.pending)} />
          {current === 'apps_records' ? (
            <Row label={t('accountSync.settings.recordsBackup')} value={status.recordsBackupAt ? relativeTime(status.recordsBackupAt) : t('accountSync.settings.never')} />
          ) : null}
          {current === 'apps_records' ? <Text variant="bodySmall" tone="muted">{t('accountSync.settings.recordsHere')}</Text> : null}
          {status.restored?.apps ? <Text tone="success">{t('accountSync.settings.restored', { count: status.restored.apps })}</Text> : null}
          {problem ? <Text tone={status.phase === 'offline' ? 'secondary' : 'warning'}>{problem}</Text> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {on ? (
          <Button variant="secondary" icon={RefreshCw} label={t('accountSync.settings.syncNow')} onPress={() => void sync.sync()} loading={status.phase === 'syncing'} />
        ) : null}
        {on || status.appsInAccount > 0 ? (
          <Button variant="ghost" icon={Trash2} label={t('accountSync.settings.remove')} onPress={() => setConfirmRemove(true)} />
        ) : null}
      </View>

      <ConfirmSheet
        visible={confirmRemove}
        title={t('accountSync.settings.removeTitle')}
        message={t('accountSync.settings.removeBody')}
        confirmLabel={t('accountSync.settings.removeConfirm')}
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </View>
  );
}
