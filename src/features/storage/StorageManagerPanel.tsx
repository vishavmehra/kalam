/**
 * Storage screen panel (docs/11 §6.5, docs/09 §19.5, docs/04 §13.9, docs/01 §14): space used per app,
 * drawings and temporary data; browser quota and persistence on the web, free space on Android; safe
 * clean-up actions. Records are never removed here without a named, confirmed action.
 */
import { ArchiveRestore, ChevronRight, Eraser, ShieldCheck, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { relativeTime } from '@/components/format';
import { Button, ConfirmSheet, IconButton, Surface, Text, useKalamTheme, useToast } from '@/design';
import { getDatabase, type StorageUsage } from '@/infrastructure/storage/database';
import { SectionHeading } from '@/features/settings/Section';
import { useArchiveApp } from '@/features/templates';
import { useT } from '@/i18n/react';
import { AppStorageSheet } from './AppStorageSheet';
import { type ArchivedRow, archivedApps, formatBytes } from './helpers';
import { cleanupTemporaryExports, deviceStorage, requestPersistence, type DeviceStorage } from './platform';

type AppUsage = StorageUsage['apps'][number];
type DrawingRow = { id: string; title: string; updatedAt: number };
type Confirm = { kind: 'drawing'; drawing: DrawingRow } | { kind: 'translations' };

const LOW_FREE_BYTES = 200 * 1024 * 1024;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { space } = useKalamTheme();
  return (
    <Surface padded={20} style={{ gap: space[2] }}>
      <Text weight="semibold" accessibilityRole="header">{title}</Text>
      {children}
    </Surface>
  );
}

function Row({ label, detail, action }: { label: string; detail?: string; action?: ReactNode }) {
  const { space, colors } = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2], borderTopWidth: 1, borderColor: colors.border, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Text>{label}</Text>
        {detail ? <Text variant="bodySmall" tone="secondary">{detail}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function StorageManagerPanel() {
  const toast = useToast();
  const theme = useKalamTheme();
  const { space, colors } = theme;
  const t = useT(theme.uiLanguage);
  const archive = useArchiveApp();
  const [archived, setArchived] = useState<ArchivedRow[]>([]);
  const [usage, setUsage] = useState<StorageUsage>();
  const [device, setDevice] = useState<DeviceStorage>();
  const [drawings, setDrawings] = useState<DrawingRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<AppUsage>();
  const [confirm, setConfirm] = useState<Confirm>();
  const [busy, setBusy] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const db = getDatabase();
      const [u, d, list, apps] = await Promise.all([db.usage(), deviceStorage(), db.drawings.list(), db.apps.list()]);
      setUsage(u);
      setArchived(archivedApps(apps));
      setDevice(d);
      setDrawings(list.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    cleanupTemporaryExports();
    void refresh();
  }, [refresh]);

  const act = async (key: string, task: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.show({ message: await task(), tone: 'success' });
      await refresh();
    } catch {
      toast.show({ message: 'That did not work. Nothing was changed.', tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  const clearAiCache = () =>
    act('ai', async () => {
      await getDatabase().aiCache.clear();
      return 'Saved AI answers cleared. Kalam asks again when it needs them.';
    });
  const removeUnused = () =>
    act('unused', async () => `${plural(await getDatabase().removeUnusedFiles(), 'unused file')} removed.`);
  const keepSafe = () =>
    act('persist', async () =>
      (await requestPersistence())
        ? 'Your browser will now keep Kalam data when space runs low.'
        : 'Your browser said no. Install Kalam or keep a backup to be safe.');

  const onConfirm = async () => {
    if (!confirm) return;
    const db = getDatabase();
    try {
      if (confirm.kind === 'drawing') {
        await db.drawings.remove(confirm.drawing.id);
        toast.show({ message: `Drawing "${confirm.drawing.title || 'Untitled sketch'}" deleted.`, tone: 'success' });
      } else {
        await db.clearTranslations();
        toast.show({ message: 'Saved translations cleared.', tone: 'success' });
      }
    } catch {
      toast.show({ message: 'That did not work. Nothing was changed.', tone: 'danger' });
    }
    setConfirm(undefined);
    await refresh();
  };

  const lowSpace =
    (device?.free !== undefined && device.free < LOW_FREE_BYTES) ||
    (device?.usage !== undefined && device.quota ? device.usage / device.quota > 0.8 : false);

  return (
    <View style={{ gap: space[3] }}>
      <SectionHeading
        title="Storage on this device"
        description="See what uses space and clear what you do not need. Records are only deleted when you choose to."
      />

      {failed ? (
        <Surface padded={20} style={{ gap: space[2] }}>
          <Text tone="danger" accessibilityRole="alert">Storage details could not be read.</Text>
          <Button label="Try again" variant="outline" onPress={refresh} />
        </Surface>
      ) : !usage ? (
        <Surface padded={20}><Text tone="secondary" accessibilityLiveRegion="polite">Adding up storage…</Text></Surface>
      ) : (
        <>
          <Group title="Space used">
            <Row label={`Kalam data: ${formatBytes(usage.totalBytes)}`} detail="Apps, records, drawings, photos and saved answers." />
            {device?.quota !== undefined ? (
              <Row
                label={`Browser storage: ${formatBytes(device.usage ?? 0)} of ${formatBytes(device.quota)}`}
                detail={device.persisted ? 'Your browser keeps this data even when space runs low.' : 'Your browser may clear this data if the device runs low on space.'}
                action={device.canRequestPersistence ? (
                  <Button label="Keep my data safe" icon={ShieldCheck} size="sm" variant="outline" onPress={keepSafe} loading={busy === 'persist'} disabled={!!busy} />
                ) : undefined}
              />
            ) : null}
            {device?.free !== undefined ? (
              <Row label={`Free space on this device: ${formatBytes(device.free)}`} detail="Kalam data stays until you uninstall Kalam or clear its storage in Android settings." />
            ) : null}
            {lowSpace ? (
              <Text tone="warning" accessibilityRole="alert">Space is running low. Make a backup, then clear what you do not need.</Text>
            ) : null}
          </Group>

          <Group title={`Apps (${usage.apps.length})`}>
            {usage.apps.length === 0 ? <Text tone="secondary">No apps yet.</Text> : null}
            {usage.apps.map((app) => (
              <Pressable
                key={app.appId}
                onPress={() => setSelected(app)}
                accessibilityRole="button"
                accessibilityLabel={`${app.name}, ${formatBytes(app.totalBytes)}. Export or clean up`}
                style={{ minHeight: 48 }}
              >
                <Row
                  label={`${app.name}: ${formatBytes(app.totalBytes)}`}
                  detail={`${plural(app.records, 'record')}, ${plural(app.versions, 'older version')}${app.fileBytes ? `, ${formatBytes(app.fileBytes)} of photos` : ''}`}
                  action={<ChevronRight size={20} color={colors.textSecondary} />}
                />
              </Pressable>
            ))}
          </Group>

          {/* The archive list (docs/11 §6.5): hidden from the shelf, nothing deleted, one press brings an app back. */}
          <Group title={t('storage.archive.title', { count: archived.length })}>
            {archived.length === 0 ? <Text tone="secondary">{t('storage.archive.empty')}</Text> : null}
            {archived.map((a) => (
              <Row
                key={a.id}
                label={a.name}
                detail={t('storage.archive.changed', { when: relativeTime(a.changedAt) })}
                action={(
                  <IconButton
                    icon={ArchiveRestore}
                    label={t('storage.archive.restoreLabel', { name: a.name })}
                    onPress={() => { void archive({ id: a.id }, false).then((ok) => { if (ok) void refresh(); }); }}
                    testID={`storage-unarchive-${a.id}`}
                  />
                )}
              />
            ))}
          </Group>

          <Group title={`Drawings (${usage.drawings.count})`}>
            {drawings.length === 0 ? <Text tone="secondary">No drawings saved.</Text> : null}
            {drawings.map((d) => (
              <Row
                key={d.id}
                label={d.title || 'Untitled sketch'}
                detail={`Changed ${relativeTime(d.updatedAt)}`}
                action={<IconButton icon={Trash2} label={`Delete drawing ${d.title || 'Untitled sketch'}`} onPress={() => setConfirm({ kind: 'drawing', drawing: d })} />}
              />
            ))}
          </Group>

          <Group title="Saved for speed">
            <Row
              label={`Saved AI answers: ${plural(usage.aiCache.entries, 'answer')}, ${formatBytes(usage.aiCache.bytes)}`}
              detail="Kept so the same question does not have to be asked again. Safe to clear."
              action={<Button label="Clear" icon={Eraser} size="sm" variant="outline" onPress={clearAiCache} loading={busy === 'ai'} disabled={!!busy || !usage.aiCache.entries} />}
            />
            <Row
              label={`Saved translations: ${plural(usage.translations.entries, 'language')}, ${formatBytes(usage.translations.bytes)}`}
              detail="App labels in other languages. Clearing them removes your corrections too."
              action={<Button label="Clear" icon={Eraser} size="sm" variant="outline" onPress={() => setConfirm({ kind: 'translations' })} disabled={!!busy || !usage.translations.entries} />}
            />
            {usage.unusedFiles.count ? (
              <Row
                label={`Unused files: ${plural(usage.unusedFiles.count, 'file')}, ${formatBytes(usage.unusedFiles.bytes)}`}
                detail="Photos left behind by apps or drawings that were deleted."
                action={<Button label="Remove" icon={Eraser} size="sm" variant="outline" onPress={removeUnused} loading={busy === 'unused'} disabled={!!busy} />}
              />
            ) : null}
            {usage.drafts.sessions ? (
              <Row
                label={`Unfinished new app: ${formatBytes(usage.drafts.fileBytes)} of photos and frames`}
                detail="Removed when you save the app or start over. Older drafts are removed after 7 days."
              />
            ) : null}
          </Group>
        </>
      )}

      <AppStorageSheet app={selected} onClose={() => setSelected(undefined)} onChanged={refresh} />
      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.kind === 'drawing' ? `Delete drawing "${confirm.drawing.title || 'Untitled sketch'}"?` : 'Clear saved translations?'}
        message={confirm?.kind === 'drawing'
          ? 'The drawing and its pictures are removed from this device. Apps you made from it keep working.'
          : 'Apps show their own language until you translate them again. Corrections you made to translations are lost.'}
        confirmLabel={confirm?.kind === 'drawing' ? 'Delete drawing' : 'Clear translations'}
        destructive
        onConfirm={onConfirm}
        onCancel={() => setConfirm(undefined)}
      />
    </View>
  );
}
