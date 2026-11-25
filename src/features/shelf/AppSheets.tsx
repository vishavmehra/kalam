/** Rename and Details sheets for a shelf app (docs/01 §6.2, docs/03 §5.2-5.3). */
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { relativeTime } from '@/components/format';
import { LANGUAGES } from '@/components/languages';
import type { StoredApp } from '@/core/contracts';
import { Button, Sheet, Text, TextField, useKalamTheme } from '@/design';
import { getServices } from '@/services';
import { useAppsStore } from '@/state/apps-store';

const MAX_NAME = 60;

export function RenameSheet({ app, onClose, onDone }: { app: StoredApp | null; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(app?.spec.name ?? ''); setError(undefined); }, [app]);

  const save = async () => {
    if (!app) return;
    const next = name.trim();
    if (!next) { setError('Give the app a name.'); return; }
    if (next === app.spec.name) { onClose(); return; }
    setBusy(true);
    try {
      // Same path as any other edit, so the rename is a new version you can undo from History.
      const out = getServices().edit.applyOps(app.spec, [{ op: 'setAppName', value: next }], `Renamed to ${next}`);
      if (!out.ok || !out.spec) { setError(out.message ?? 'That name cannot be used.'); return; }
      await useAppsStore.getState().save({ ...app, spec: out.spec, updatedAt: Date.now() }, { summary: `Renamed to ${next}`, source: 'edit' });
      onDone(next);
      onClose();
    } catch {
      setError('The new name could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={!!app}
      onClose={onClose}
      title="Rename app"
      dismissible={!busy}
      footer={[
        <Button key="cancel" label="Cancel" variant="ghost" onPress={onClose} disabled={busy} />,
        <Button key="save" label="Save name" onPress={() => void save()} loading={busy} />,
      ]}
    >
      <TextField
        label="App name"
        value={name}
        onChangeText={(t) => { setName(t.slice(0, MAX_NAME)); setError(undefined); }}
        error={error}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
    </Sheet>
  );
}

const BUILT: Record<StoredApp['origin']['route'], string> = {
  template: 'From a ready-made template on this device',
  'template+on_device': 'From a template, filled in by Gemini Nano on this device',
  cloud: 'By Gemini in the cloud through Firebase',
  'cloud+repair': 'By Gemini in the cloud through Firebase, then fixed by a check',
  specialist: 'By a specialist model through the Kalam server',
  manual: 'By hand',
  import: 'Imported from a file',
};

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text tone="secondary" style={{ width: 132 }}>{label}</Text>
      <Text style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}

export function AppDetailsSheet({ app, onClose }: { app: StoredApp | null; onClose: () => void }) {
  if (!app) return <Sheet visible={false} onClose={onClose} title="Details" />;
  const { spec } = app;
  const collections = Object.keys(spec.collections ?? {}).length;
  const lang = LANGUAGES.find((l) => l.code === spec.lang);
  return (
    <Sheet visible onClose={onClose} title={spec.name} description={spec.description} footer={<Button label="Done" onPress={onClose} />}>
      <View>
        <Row label="Version" value={String(spec.version)} />
        <Row label="Made" value={relativeTime(app.createdAt)} />
        <Row label="Last opened" value={app.lastOpenedAt ? relativeTime(app.lastOpenedAt) : 'Not opened yet'} />
        <Row label="Screens" value={String(spec.screens.length)} />
        <Row label="Kinds of records" value={collections ? String(collections) : 'None. This app does not save records.'} />
        <Row label="Language" value={lang ? lang.english : spec.lang} />
        <Row label="Built" value={BUILT[app.origin.route] ?? 'On this device'} />
        <Row label="Works offline" value="Yes. Opening and using it never needs the internet." />
      </View>
    </Sheet>
  );
}
