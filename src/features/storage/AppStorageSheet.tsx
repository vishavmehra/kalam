/**
 * One app on the Storage screen (docs/11 §6.3, §6.5, §13.1): what it uses, exports (design only, design
 * with records after a warning, records as CSV per list), deleting older versions, deleting the app.
 * Confirm steps replace this sheet instead of stacking a second modal on top of it.
 */
import { FileJson, FileSpreadsheet, History, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { collectionToCsv, exportAppJson, exportFileName, exportRecordsJson } from '@/core/backup';
import { Button, ConfirmSheet, Sheet, Text, useKalamTheme, useToast } from '@/design';
import { getDatabase, type StorageUsage } from '@/infrastructure/storage/database';
import { useAppsStore } from '@/state/apps-store';
import { formatBytes } from './helpers';
import { saveFile } from './platform';

type AppUsage = StorageUsage['apps'][number];
type Confirm = 'records' | 'recordsOnly' | 'history' | 'delete';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AppStorageSheet({ app, onClose, onChanged }: { app: AppUsage | undefined; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { space } = useKalamTheme();
  const [confirm, setConfirm] = useState<Confirm>();
  const [busy, setBusy] = useState<string>();

  const run = async (key: string, task: () => Promise<string | undefined>) => {
    setBusy(key);
    try {
      const message = await task();
      if (message) toast.show({ message, tone: 'success' });
    } catch (e) {
      toast.show({ message: e instanceof Error && e.message.length < 200 ? e.message : 'That did not work. Nothing was changed.', tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  const loadApp = async () => {
    const stored = app ? await getDatabase().apps.get(app.appId) : undefined;
    if (!stored) throw new Error('This app is no longer on this device.');
    return stored;
  };
  const shared = (ok: boolean, what: string) => (ok ? `${what} is ready.` : 'Sharing is not available on this device.');

  const exportDesign = () =>
    run('design', async () => {
      const stored = await loadApp();
      const json = JSON.stringify(exportAppJson(stored), null, 2);
      return shared(await saveFile(exportFileName(stored.spec.name, 'design', 'json'), json, 'application/json'), 'The design file');
    });

  const exportWithRecords = async () => {
    const stored = await loadApp();
    const db = getDatabase();
    const records = Object.values(await db.records.listAll(stored.id)).flat();
    const json = JSON.stringify(exportAppJson(stored, { records, state: await db.state.all(stored.id) }), null, 2);
    const ok = await saveFile(exportFileName(stored.spec.name, 'with records', 'json'), json, 'application/json');
    setConfirm(undefined);
    toast.show({ message: shared(ok, 'The file with records'), tone: ok ? 'success' : 'danger' });
  };

  const exportRecordsOnly = async () => {
    const stored = await loadApp();
    const records = Object.values(await getDatabase().records.listAll(stored.id)).flat();
    const json = JSON.stringify(exportRecordsJson(stored, records), null, 2);
    const ok = await saveFile(exportFileName(stored.spec.name, 'records', 'json'), json, 'application/json');
    setConfirm(undefined);
    toast.show({ message: shared(ok, 'The records file'), tone: ok ? 'success' : 'danger' });
  };

  const exportCsv = (collectionId: string, label: string) =>
    run(`csv:${collectionId}`, async () => {
      const stored = await loadApp();
      const collection = stored.spec.collections[collectionId];
      if (!collection) throw new Error('This list is no longer in the app.');
      const csv = collectionToCsv(collection, await getDatabase().records.list(stored.id, collectionId));
      return shared(await saveFile(exportFileName(stored.spec.name, label, 'csv'), csv, 'text/csv'), 'The spreadsheet file');
    });

  const clearHistory = async () => {
    if (!app) return;
    const removed = await getDatabase().clearHistory(app.appId);
    setConfirm(undefined);
    toast.show({ message: `${plural(removed, 'older version')} deleted. The current design is kept.`, tone: 'success' });
    onChanged();
  };

  const deleteApp = async () => {
    if (!app) return;
    await useAppsStore.getState().remove(app.appId);
    setConfirm(undefined);
    toast.show({ message: `${app.name} was deleted from this device.`, tone: 'success' });
    onClose();
    onChanged();
  };

  const confirmProps: Record<Confirm, { title: string; message: string; label: string; destructive: boolean; onConfirm: () => Promise<void> }> = {
    records: {
      title: 'Export with records?',
      message: `The file will hold every record in ${app?.name ?? 'this app'}. Anyone who gets the file can read them.`,
      label: 'Export with records',
      destructive: false,
      onConfirm: exportWithRecords,
    },
    recordsOnly: {
      title: 'Export the records?',
      message: `The file will hold every record in ${app?.name ?? 'this app'}, without the app design. Anyone who gets the file can read them.`,
      label: 'Export records',
      destructive: false,
      onConfirm: exportRecordsOnly,
    },
    history: {
      title: 'Delete older versions?',
      message: `The current design and all records of ${app?.name ?? 'this app'} stay. You will not be able to go back to an older design.`,
      label: 'Delete older versions',
      destructive: true,
      onConfirm: clearHistory,
    },
    delete: {
      title: `Delete ${app?.name ?? 'this app'}?`,
      message: `The app, its ${plural(app?.records ?? 0, 'record')}, its older versions and its files are removed from this device. Export it first if you may need it later. This cannot be undone.`,
      label: 'Delete app',
      destructive: true,
      onConfirm: deleteApp,
    },
  };
  const c = confirm ? confirmProps[confirm] : undefined;

  return (
    <>
      <Sheet
        visible={!!app && !confirm}
        onClose={onClose}
        dismissible={!busy}
        title={app?.name ?? 'App'}
        description={app ? `Uses about ${formatBytes(app.totalBytes)} on this device.` : undefined}
        footer={<Button label="Done" variant="ghost" onPress={onClose} disabled={!!busy} />}
      >
        {app ? (
          <View style={{ gap: space[5] }}>
            <View style={{ gap: space[1] }}>
              <Text variant="bodySmall" tone="secondary">Design: {formatBytes(app.designBytes)}</Text>
              <Text variant="bodySmall" tone="secondary">
                Records: {plural(app.records, 'record')}, {formatBytes(app.recordBytes)}
              </Text>
              <Text variant="bodySmall" tone="secondary">
                Older versions: {app.versions}, {formatBytes(app.historyBytes)}
              </Text>
              {app.fileBytes ? <Text variant="bodySmall" tone="secondary">Photos and files: {formatBytes(app.fileBytes)}</Text> : null}
            </View>

            <View style={{ gap: space[2] }}>
              <Text weight="semibold">Export</Text>
              <Button label="Design only (safe to share)" icon={FileJson} variant="outline" onPress={exportDesign} loading={busy === 'design'} disabled={!!busy} />
              <Button label="Design and records" icon={FileJson} variant="outline" onPress={() => setConfirm('records')} disabled={!!busy || !app.records} />
              <Button label="Records only" icon={FileJson} variant="outline" onPress={() => setConfirm('recordsOnly')} disabled={!!busy || !app.records} />
              {app.collections.filter((col) => col.records > 0).map((col) => (
                <Button
                  key={col.id}
                  label={`${col.label} as a spreadsheet (${plural(col.records, 'record')})`}
                  icon={FileSpreadsheet}
                  variant="outline"
                  onPress={() => exportCsv(col.id, col.label)}
                  loading={busy === `csv:${col.id}`}
                  disabled={!!busy}
                />
              ))}
            </View>

            <View style={{ gap: space[2] }}>
              <Text weight="semibold">Clean up</Text>
              <Button
                label={app.versions ? `Delete ${plural(app.versions, 'older version')}` : 'No older versions to delete'}
                icon={History}
                variant="outline"
                onPress={() => setConfirm('history')}
                disabled={!!busy || !app.versions}
              />
              <Button label="Delete app" icon={Trash2} variant="destructive" onPress={() => setConfirm('delete')} disabled={!!busy} />
            </View>
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet
        visible={!!c}
        title={c?.title ?? ''}
        message={c?.message ?? ''}
        confirmLabel={c?.label ?? ''}
        destructive={c?.destructive}
        onConfirm={async () => {
          try {
            await c?.onConfirm();
          } catch (e) {
            setConfirm(undefined);
            toast.show({ message: e instanceof Error && e.message.length < 200 ? e.message : 'That did not work. Nothing was changed.', tone: 'danger' });
          }
        }}
        onCancel={() => setConfirm(undefined)}
      />
    </>
  );
}
