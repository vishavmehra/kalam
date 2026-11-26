/** Rename and Details sheets for a shelf app (docs/01 §6.2, docs/03 §5.2-5.3). */
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import { Button, Sheet, Text, TextField, useKalamTheme } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { languageInfo } from '@/i18n/languages';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

const MAX_NAME = 60;

export function RenameSheet({ app, onClose, onDone }: { app: StoredApp | null; onClose: () => void; onDone: (name: string) => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(app?.spec.name ?? ''); setError(undefined); }, [app]);

  const save = async () => {
    if (!app) return;
    const next = name.trim();
    if (!next) { setError(t('shelf.rename.empty')); return; }
    if (next === app.spec.name) { onClose(); return; }
    setBusy(true);
    try {
      // Same path as any other edit, so the rename is a new version you can undo from History.
      const summary = t('shelf.toast.renamed', { name: next });
      const out = getServices().edit.applyOps(app.spec, [{ op: 'setAppName', value: next }], summary);
      if (!out.ok || !out.spec) { setError(t('shelf.rename.invalid')); return; }
      await useAppsStore.getState().save({ ...app, spec: out.spec, updatedAt: Date.now() }, { summary, source: 'edit' });
      onDone(next);
      onClose();
    } catch {
      setError(t('shelf.rename.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={!!app}
      onClose={onClose}
      title={t('shelf.rename.title')}
      dismissible={!busy}
      footer={[
        <Button key="cancel" label={t('common.cancel')} variant="ghost" onPress={onClose} disabled={busy} />,
        <Button key="save" label={t('shelf.rename.save')} onPress={() => void save()} loading={busy} />,
      ]}
    >
      <TextField
        label={t('shelf.rename.label')}
        value={name}
        onChangeText={(v) => { setName(v.slice(0, MAX_NAME)); setError(undefined); }}
        error={error}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
    </Sheet>
  );
}

const BUILT: Record<StoredApp['origin']['route'], TranslationKey> = {
  template: 'shelf.details.builtTemplate',
  'template+on_device': 'shelf.details.builtOnDevice',
  cloud: 'shelf.details.builtCloud',
  'cloud+repair': 'shelf.details.builtCloudRepair',
  specialist: 'shelf.details.builtSpecialist',
  manual: 'shelf.details.builtManual',
  import: 'shelf.details.builtImport',
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { colors } = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text tone="secondary" style={{ width: 140 }}>{label}</Text>
      <Text mono={mono} style={{ flex: 1, minWidth: 160 }}>{value}</Text>
    </View>
  );
}

/** What the person can know about an app on their shelf: version, dates, size, language and how it was built. */
export function AppDetailsSheet({ app, entries, onClose }: { app: StoredApp | null; entries?: number; onClose: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  if (!app) return <Sheet visible={false} onClose={onClose} title={t('shelf.details.title')} />;
  const { spec } = app;
  const collections = Object.keys(spec.collections ?? {}).length;
  const lang = languageInfo(spec.lang);
  return (
    <Sheet visible onClose={onClose} title={spec.name} description={spec.description} footer={<Button label={t('common.done')} onPress={onClose} />}>
      <View>
        <Row label={t('shelf.details.version')} value={String(spec.version)} mono />
        <Row label={t('shelf.details.made')} value={relativeTime(app.createdAt)} />
        <Row label={t('shelf.details.lastOpened')} value={app.lastOpenedAt ? relativeTime(app.lastOpenedAt) : t('shelf.details.notOpened')} />
        <Row label={t('shelf.details.screens')} value={String(spec.screens.length)} mono />
        <Row label={t('shelf.details.kinds')} value={collections ? String(collections) : t('shelf.details.noKinds')} mono={!!collections} />
        {entries !== undefined ? <Row label={t('shelf.details.entries')} value={String(entries)} mono /> : null}
        <Row label={t('shelf.details.language')} value={lang.code === 'en' ? lang.english : `${lang.native} (${lang.english})`} />
        <Row label={t('shelf.details.built')} value={t(BUILT[app.origin.route] ?? 'shelf.details.builtTemplate')} />
        <Row label={t('shelf.details.offline')} value={t('shelf.details.offlineValue')} />
      </View>
    </Sheet>
  );
}
