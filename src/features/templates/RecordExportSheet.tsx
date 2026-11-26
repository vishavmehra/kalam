import * as Clipboard from 'expo-clipboard';
import { Copy, FileJson, FileSpreadsheet } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  recordFileName, recordToCsv, recordToJson, recordToText, type RecordExportContext,
} from '@/core/clone';
import type { KalamRecord, StoredApp } from '@/core/contracts';
import { Button, Sheet, Text, useToast } from '@/design';
import { saveFile } from '@/features/storage/platform';
import { getDatabase } from '@/infrastructure/storage/database';

import { copy } from './copy';
import { useLast } from './use-last';

export interface RecordExportSheetProps {
  /** The app the entry belongs to. */
  app: StoredApp | null;
  /** The entry to export. Null keeps the sheet closed. */
  record: KalamRecord | null;
  onClose: () => void;
}

/**
 * One entry as a file or as text (docs/01 §3.3). Links are written as the linked entry's name. Nothing leaves the
 * device except through the file the person saves or the text they paste.
 */
export function RecordExportSheet({ app: givenApp, record: givenRecord, onClose }: RecordExportSheetProps) {
  const toast = useToast();
  const app = useLast(givenApp);
  const record = useLast(givenRecord);
  const [related, setRelated] = useState<RecordExportContext['related']>(undefined);
  const [busy, setBusy] = useState<string | undefined>();
  const appId = givenApp?.id;

  useEffect(() => {
    if (!appId) return;
    let live = true;
    getDatabase().records.listAll(appId).then((all) => { if (live) setRelated(all); }, () => { if (live) setRelated(undefined); });
    return () => { live = false; };
  }, [appId]);

  const ctx = useMemo<RecordExportContext>(() => ({ related }), [related]);

  const run = async (key: string, task: () => Promise<{ message: string; tone: 'success' | 'info' }>) => {
    setBusy(key);
    try {
      toast.show(await task());
    } catch {
      toast.show({ message: copy.entry.failed, tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  const file = (key: 'json' | 'csv') => () => {
    if (!app || !record) return;
    void run(key, async () => {
      const spec = app.spec;
      const text = key === 'json' ? JSON.stringify(recordToJson({ id: app.id, spec }, record, ctx), null, 2) : recordToCsv(spec, record, ctx);
      const ok = await saveFile(recordFileName(spec, record, key, ctx), text, key === 'json' ? 'application/json' : 'text/csv');
      // false means this device cannot share or save a file, which is not a failure of the app.
      return ok ? { message: copy.entry.saved, tone: 'success' as const } : { message: copy.entry.notSaved, tone: 'info' as const };
    });
  };

  const copyText = () => {
    if (!app || !record) return;
    void run('text', async () => {
      await Clipboard.setStringAsync(recordToText(app.spec, record, ctx));
      return { message: copy.entry.copied, tone: 'success' as const };
    });
  };

  return (
    <Sheet
      visible={!!givenApp && !!givenRecord}
      onClose={onClose}
      title={copy.entry.title}
      description={copy.entry.intro}
      maxWidth={480}
      footer={<Button label={copy.entry.close} variant="ghost" size="md" onPress={onClose} />}
    >
      <View style={{ gap: 10, paddingBottom: 8 }}>
        <Button label={copy.entry.json} icon={FileJson} variant="secondary" size="md" loading={busy === 'json'} disabled={!!busy} onPress={file('json')} fullWidth />
        <Button label={copy.entry.csv} icon={FileSpreadsheet} variant="secondary" size="md" loading={busy === 'csv'} disabled={!!busy} onPress={file('csv')} fullWidth />
        <Button label={copy.entry.text} icon={Copy} variant="secondary" size="md" loading={busy === 'text'} disabled={!!busy} onPress={copyText} fullWidth />
        <Text variant="bodySmall" tone="muted">{copy.entry.pictures}</Text>
      </View>
    </Sheet>
  );
}
