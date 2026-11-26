/**
 * The one-line entry point (docs/14 §9): a button for an app that has a photo-reading step, and the batch
 * sheet behind it. Renders nothing for an app without one. Saves through the app's own record store, so
 * the list on screen updates by itself. ponytail: uses the first photo step; add a picker if an app ever
 * has several photo steps that fill different lists.
 */
import { FileText } from 'lucide-react-native';
import { useState } from 'react';

import type { RecordValue, RuntimeServices } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';

import { DocumentBatchSheet } from './DocumentBatchSheet';
import { saveDocumentRecords } from './save-records';

export function DocumentScan({ spec, appId, services, onAdded }: {
  spec: KalamSpec;
  appId: string;
  services: Pick<RuntimeServices, 'runAIBlock' | 'records'>;
  onAdded?(count: number): void;
}) {
  const { uiLanguage } = useKalamTheme();
  const t = useT(uiLanguage);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<Array<Record<string, RecordValue>>>([]);
  const step = Object.entries(spec.aiBlocks).find(([, b]) => b.kind === 'extractFromPhoto');
  if (!step || step[1].kind !== 'extractFromPhoto') return null;
  const [blockId, block] = step;
  const target = block.kind === 'extractFromPhoto' ? block.target : '';

  const show = () => {
    setOpen(true);
    // For spotting repeats only; if the list cannot be read, nothing is marked as a repeat.
    services.records.list(appId, target).then((rs) => setExisting(rs.map((r) => r.values))).catch(() => setExisting([]));
  };
  const add = async (records: Array<Record<string, RecordValue>>) => {
    // Same checks as the app's own Add button, then all records in one write: on a failure none are saved.
    const saved = await saveDocumentRecords(services.records, spec, appId, target, records);
    if (!saved.ok) {
      toast.show({ message: saved.message, tone: 'danger' });
      throw new Error(saved.message); // tells the sheet to keep every page on screen
    }
    setExisting((rows) => [...rows, ...records]); // pages still on screen that repeat these are marked again
    toast.show({ message: t('docIntel.added', { count: records.length }), tone: 'success' });
    onAdded?.(records.length);
  };

  return (
    <>
      <Button variant="outline" icon={FileText} label={t('docIntel.open')} onPress={show} />
      <DocumentBatchSheet
        visible={open}
        spec={spec}
        appId={appId}
        blockId={blockId}
        runAIBlock={services.runAIBlock}
        existing={existing}
        onAdd={add}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
