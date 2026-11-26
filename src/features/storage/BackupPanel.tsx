/**
 * Encrypted backup and restore (docs/11 §12, docs/14 §15, docs/16 R-033). Self-contained settings
 * panel: makes a passphrase-locked file, and restores one after showing what it holds and asking
 * before anything on this device is replaced. The passphrase never leaves this screen's memory.
 */
import { FileLock2, FileUp, ShieldAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  createBackupService, isBackupError, localStamp, MAX_BACKUP_FILE_BYTES, type BackupPreview, type KalamBackupService,
} from '@/core/backup';
import {
  Button, Checkbox, ConfirmSheet, SegmentedControl, Sheet, Surface, SwitchRow, Text, TextField, useBreakpoint, useKalamTheme, useToast,
} from '@/design';
import { getDatabase, secureRandomBytes } from '@/infrastructure/storage/database';
import { useAppsStore } from '@/state/apps-store';
import { useSettingsStore } from '@/state/settings-store';
import { SectionHeading } from '@/features/settings/Section';
import { backupFileName, passphraseStrength } from './helpers';
import { cleanupTemporaryExports, pickFile, saveFile, type PickedFile } from './platform';

let service: KalamBackupService | undefined;
/** Stateless over the local database; one instance is enough. */
export function getBackupService(): KalamBackupService {
  return (service ??= createBackupService({ db: getDatabase(), randomBytes: secureRandomBytes }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errorText = (e: unknown, fallback: string) => (isBackupError(e) ? e.message : e instanceof Error && e.message.length < 200 ? e.message : fallback);

const LEVEL_LABEL = { too_short: 'Too short', weak: 'Weak', fair: 'Fair', strong: 'Strong' } as const;

/** Selectable apps, one checkbox each (all chosen at first); docs/11 §12.2, docs/14 §15.5 step 3. */
function AppChooser({ label, apps, left, onToggle }: {
  label: string; apps: ReadonlyArray<{ id: string; name: string }>; left: ReadonlySet<string>; onToggle: (id: string) => void;
}) {
  const { space } = useKalamTheme();
  if (!apps.length) return null;
  return (
    <View style={{ gap: space[2] }} accessibilityRole="list" accessibilityLabel={label}>
      <Text weight="semibold">{label}</Text>
      <View>
        {apps.map((a) => <Checkbox key={a.id} label={a.name} checked={!left.has(a.id)} onChange={() => onToggle(a.id)} />)}
      </View>
    </View>
  );
}

const toggled = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

function MakeBackupSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const { space, colors } = useKalamTheme();
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [noted, setNoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<Array<{ id: string; name: string }>>([]);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [withSettings, setWithSettings] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLeft(new Set());
    getDatabase().apps.list().then((list) => setApps(list.map((a) => ({ id: a.id, name: a.spec.name }))), () => setApps([]));
  }, [visible]);
  const strength = passphraseStrength(pass);
  const mismatch = again.length > 0 && again !== pass;
  const ready = strength.level !== 'too_short' && pass === again && noted && !busy;

  const close = () => {
    setPass('');
    setAgain('');
    setNoted(false);
    onClose();
  };

  const make = async () => {
    setBusy(true);
    try {
      const { bytes, manifest } = await getBackupService().exportEncrypted(pass, {
        // Only narrow the backup when the person left something out (the list loads asynchronously).
        ...(left.size ? { appIds: apps.filter((a) => !left.has(a.id)).map((a) => a.id) } : {}),
        includeSettings: withSettings,
      });
      const saved = await saveFile(backupFileName(manifest.createdAt), bytes, 'application/octet-stream');
      if (!saved) {
        toast.show({ message: 'Sharing is not available on this device, so the backup file could not be saved.', tone: 'danger' });
        return;
      }
      toast.show({
        message: `Backup saved with ${plural(manifest.appCount, 'app')} and ${plural(manifest.recordCount, 'record')}.`,
        tone: 'success',
      });
      close();
    } catch (e) {
      toast.show({ message: errorText(e, 'The backup could not be made. Nothing was changed.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      dismissible={!busy}
      title="Make an encrypted backup"
      description="The file is locked with a passphrase you choose. Kalam does not keep the passphrase anywhere."
      footer={
        <>
          <Button label="Cancel" variant="ghost" onPress={close} disabled={busy} />
          <Button label={busy ? 'Locking the backup' : 'Make backup'} icon={FileLock2} onPress={make} loading={busy} disabled={!ready} />
        </>
      }
    >
      <View style={{ gap: space[4] }}>
        <AppChooser label="Apps in this backup" apps={apps} left={left} onToggle={(id) => setLeft((s) => toggled(s, id))} />
        <SwitchRow label="Include my settings" value={withSettings} onValueChange={setWithSettings} disabled={busy} />
        <TextField
          label="Passphrase"
          value={pass}
          onChangeText={setPass}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          helper={pass ? `${LEVEL_LABEL[strength.level]}. ${strength.hint}` : strength.hint}
          editable={!busy}
        />
        <TextField
          label="Type the passphrase again"
          value={again}
          onChangeText={setAgain}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          error={mismatch ? 'The two passphrases are different.' : undefined}
          editable={!busy}
        />
        <Surface tone="accentSoft" padded radius="md" style={{ flexDirection: 'row', gap: space[3] }} accessibilityRole="alert">
          <ShieldAlert size={20} color={colors.text} />
          <View style={{ flex: 1, gap: space[1] }}>
            <Text weight="semibold">If you forget the passphrase, this backup cannot be opened.</Text>
            <Text variant="bodySmall">
              Nobody can reset it, not even Kalam. Write it down and keep it apart from the file. Do not make this file your only copy of
              important records.
            </Text>
          </View>
        </Surface>
        <SwitchRow label="I have written the passphrase down" value={noted} onValueChange={setNoted} disabled={busy} />
        {busy ? (
          <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">
            Locking your backup. This can take a few seconds on a phone.
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

type RestoreStep = { file: PickedFile };

function RestoreSheet({ step, onClose }: { step: RestoreStep | undefined; onClose: () => void }) {
  const toast = useToast();
  const { space } = useKalamTheme();
  const [pass, setPass] = useState('');
  const [preview, setPreview] = useState<BackupPreview>();
  const [choice, setChoice] = useState<'keep' | 'replace'>('keep');
  const [withSettings, setWithSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setPass('');
    setPreview(undefined);
    setChoice('keep');
    setWithSettings(true);
    setError(undefined);
    setLeftOut(new Set());
  }, [step?.file]);

  const close = () => {
    setPass('');
    setPreview(undefined);
    setConfirmReplace(false);
    onClose();
  };

  const open = async () => {
    if (!step) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await getBackupService().preview(step.file.bytes, pass));
    } catch (e) {
      setError(errorText(e, 'This backup could not be opened.'));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (overwrite: boolean | undefined) => {
    if (!step || !preview) return;
    setBusy(true);
    try {
      const res = await getBackupService().importEncrypted(step.file.bytes, pass, {
        overwrite,
        restoreSettings: withSettings,
        ...(leftOut.size ? { appIds: preview.apps.filter((a) => !leftOut.has(a.id)).map((a) => a.id) } : {}),
      });
      await Promise.all([useAppsStore.getState().refresh(), res.settingsApplied ? useSettingsStore.getState().load() : undefined]);
      const skipped = res.skippedApps + res.skippedRecords;
      toast.show({
        message: `Restored ${plural(res.apps, 'app')} and ${plural(res.records, 'record')}.${skipped ? ` ${plural(skipped, 'item')} could not be read and were left out.` : ''}`,
        tone: 'success',
      });
      close();
    } catch (e) {
      setConfirmReplace(false);
      setError(errorText(e, 'The backup could not be restored. Nothing on this device was changed.'));
    } finally {
      setBusy(false);
    }
  };

  const conflicts = (preview?.conflicts ?? []).filter((c) => !leftOut.has(c.id));
  const skipped = preview ? preview.skipped.apps + preview.skipped.records + preview.skipped.drawings + preview.skipped.files : 0;
  const onRestorePress = () => (conflicts.length && choice === 'replace' ? setConfirmReplace(true) : restore(conflicts.length ? false : undefined));

  return (
    <>
      <Sheet
        visible={!!step && !confirmReplace}
        onClose={close}
        dismissible={!busy}
        title="Restore from a backup"
        description={step ? `File: ${step.file.name}` : undefined}
        footer={
          <>
            <Button label="Cancel" variant="ghost" onPress={close} disabled={busy} />
            {preview ? (
              <Button label="Restore" icon={FileUp} onPress={onRestorePress} loading={busy} />
            ) : (
              <Button label="Open backup" onPress={open} loading={busy} disabled={!pass || busy} />
            )}
          </>
        }
      >
        <View style={{ gap: space[4] }}>
          {!preview ? (
            <>
              <TextField
                label="Passphrase"
                value={pass}
                onChangeText={setPass}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                onSubmitEditing={open}
                editable={!busy}
              />
              <Text variant="bodySmall" tone="secondary">
                Nothing changes on this device until you have seen what the backup holds and pressed Restore.
              </Text>
            </>
          ) : (
            <>
              <View style={{ gap: space[1] }}>
                <Text weight="semibold">Made on {localStamp(preview.createdAt)}</Text>
                <Text>
                  {plural(preview.apps.length, 'app')}, {plural(preview.recordCount, 'record')}, {plural(preview.drawingCount, 'drawing')}
                  {preview.settingsIncluded ? ' and your settings' : ''}.
                </Text>
                {preview.apps.length === 1 ? (
                  <Text variant="bodySmall" tone="secondary">{preview.apps[0].name}: {plural(preview.apps[0].records, 'record')}</Text>
                ) : null}
                {skipped ? (
                  <Text variant="bodySmall" tone="warning">{plural(skipped, 'item')} could not be read and will be left out.</Text>
                ) : null}
              </View>
              {preview.apps.length > 1 ? (
                <AppChooser
                  label="Apps to restore"
                  apps={preview.apps.map((a) => ({ id: a.id, name: `${a.name} (${plural(a.records, 'record')})` }))}
                  left={leftOut}
                  onToggle={(id) => setLeftOut((s) => toggled(s, id))}
                />
              ) : null}
              {conflicts.length ? (
                <Surface tone="alt" padded radius="md" style={{ gap: space[3] }}>
                  <Text>
                    {conflicts.length === 1 ? 'This app is' : 'These apps are'} already on this device:{' '}
                    {conflicts.map((c) => c.localName).join(', ')}.
                  </Text>
                  <SegmentedControl
                    label="What should happen to them?"
                    value={choice}
                    onChange={setChoice}
                    wrap
                    options={[
                      { value: 'keep', label: 'Keep the ones here' },
                      { value: 'replace', label: 'Use the backup copies' },
                    ]}
                  />
                </Surface>
              ) : null}
              {preview.settingsIncluded ? (
                <SwitchRow
                  label="Also restore my settings"
                  description="Access modes, language, theme and voice. Cloud AI permissions on this device stay as they are."
                  value={withSettings}
                  onValueChange={setWithSettings}
                  disabled={busy}
                />
              ) : null}
            </>
          )}
          {error ? <Text tone="danger" accessibilityRole="alert">{error}</Text> : null}
        </View>
      </Sheet>
      <ConfirmSheet
        visible={confirmReplace}
        title={`Replace ${plural(conflicts.length, 'app')}?`}
        message={`${conflicts.map((c) => c.localName).join(', ')} on this device will be deleted with their records, and the backup copies will take their place. This cannot be undone.`}
        confirmLabel="Replace with backup"
        destructive
        onConfirm={() => restore(true)}
        onCancel={() => setConfirmReplace(false)}
      />
    </>
  );
}

/** Settings panel: make an encrypted backup file, or restore one. */
export function BackupPanel() {
  const toast = useToast();
  const { space } = useKalamTheme();
  const { isPhone } = useBreakpoint();
  const [making, setMaking] = useState(false);
  const [restoring, setRestoring] = useState<RestoreStep>();
  const [picking, setPicking] = useState(false);

  useEffect(() => cleanupTemporaryExports(), []);

  const chooseFile = async () => {
    setPicking(true);
    try {
      const file = await pickFile(MAX_BACKUP_FILE_BYTES);
      if (file) setRestoring({ file });
    } catch (e) {
      toast.show({ message: errorText(e, 'That file could not be opened.'), tone: 'danger' });
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      <SectionHeading
        title="Encrypted backup"
        description="Lock a copy of everything with a passphrase and keep the file somewhere safe, like a pen drive or your email. Use it to move your apps to a new phone or computer."
      />
      <Surface padded={20} style={{ gap: space[3] }}>
        <Text variant="bodySmall">
          Included: apps, their older versions, records, drawings and your settings. Not included: saved AI answers, unfinished drafts
          and the activity log.
        </Text>
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: space[2] }}>
          <Button label="Make a backup" icon={FileLock2} onPress={() => setMaking(true)} fullWidth={isPhone} />
          <Button label="Restore from a backup" icon={FileUp} variant="outline" onPress={chooseFile} loading={picking} fullWidth={isPhone} />
        </View>
      </Surface>
      <MakeBackupSheet visible={making} onClose={() => setMaking(false)} />
      <RestoreSheet step={restoring} onClose={() => setRestoring(undefined)} />
    </View>
  );
}
