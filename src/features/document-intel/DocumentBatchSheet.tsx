/**
 * Add records from documents (docs/14 §9, docs/16 R-016): choose photos or a scanned PDF, watch each page
 * get read, fix or confirm what the reader was unsure of, then add the records you approved. Nothing is
 * saved until the person presses the add button, and pages are dropped from memory when the sheet closes.
 */
import { Camera, CircleAlert, FileText } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { RecordValue } from '@/core/contracts';
import { isSavable, MAX_DOC_PAGES } from '@/core/document-intel';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, Sheet, Text, useKalamTheme } from '@/design';
import { useI18n } from '@/i18n/react';

import { RecordReview } from './RecordReview';
import { useDocumentBatch, type DocumentBatchOptions } from './use-document-batch';

export interface DocumentBatchSheetProps extends DocumentBatchOptions {
  visible: boolean;
  spec: KalamSpec;
  /**
   * Saves the approved records, in order, all or none. When it resolves the sheet drops those pages (and closes
   * if none are left); when it throws the pages stay on screen, so the caller shows the reason.
   */
  onAdd(records: Array<Record<string, RecordValue>>): Promise<void>;
  onClose(): void;
}

export function DocumentBatchSheet({ visible, onAdd, onClose, ...options }: DocumentBatchSheetProps) {
  const { space, colors, uiLanguage } = useKalamTheme();
  const { t, td } = useI18n(uiLanguage);
  const batch = useDocumentBatch(options);
  const { items, summary, busy, notes } = batch;
  const [adding, setAdding] = useState(false);

  // Pages are not kept: closing the sheet by any route lets go of them.
  useEffect(() => { if (!visible) batch.reset(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const reading = busy === 'reading';
  const left = summary.waiting + summary.failed;
  const add = async () => {
    setAdding(true);
    const ids = new Set(items.filter(isSavable).map((i) => i.page.id));
    try {
      await onAdd(batch.chosen().map((r) => r.values));
      // Only what was added goes; pages still to fix, left out, failed or waiting stay, with the person's edits.
      if (ids.size < items.length) batch.drop(ids);
      else { batch.reset(); onClose(); }
    } catch {
      // The records stay on screen so nothing read is lost; the caller shows its own save error.
    } finally {
      setAdding(false);
    }
  };

  const noteText = notes.map((n) => {
    switch (n.kind) {
      case 'pdf': return td(`docIntel.pdf.${n.reason}`, { name: n.name });
      case 'file': return n.name ? `${n.name}: ${n.reason}` : n.reason; // the reason is the media layer's own plain message
      case 'skipped': return t('docIntel.skipped', { count: n.count });
      case 'cut': return t('docIntel.cut', { max: n.max });
    }
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      dismissible={!adding}
      title={t('docIntel.title')}
      description={items.length ? undefined : t('docIntel.intro')}
      maxWidth={760}
      footer={
        <>
          <Button variant="ghost" label={t('common.cancel')} onPress={onClose} disabled={adding} />
          {items.length ? (
            <Button
              label={t('docIntel.add', { count: summary.savable })}
              onPress={() => void add()}
              disabled={summary.savable === 0 || reading}
              loading={adding}
            />
          ) : null}
        </>
      }
    >
      <View style={{ gap: space[4], paddingBottom: space[4] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
          <Button label={t('docIntel.choose')} icon={FileText} variant={items.length ? 'outline' : 'primary'} onPress={() => void batch.add('files')} loading={busy === 'picking'} disabled={!!busy || adding || batch.room <= 0} />
          <Button label={t('docIntel.camera')} icon={Camera} variant="outline" onPress={() => void batch.add('camera')} disabled={!!busy || adding || batch.room <= 0} />
        </View>
        {items.length ? null : <Text variant="bodySmall" tone="secondary">{t('docIntel.limits', { max: MAX_DOC_PAGES })}</Text>}
        <Text variant="bodySmall" tone="muted">{t('docIntel.privacy')}</Text>
        {noteText.map((n, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
            <CircleAlert size={16} color={colors.warning} style={{ marginTop: 2 }} />
            <Text variant="bodySmall" tone="warning" style={{ flex: 1 }}>{n}</Text>
          </View>
        ))}

        {items.length ? (
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[3] }}>
              <Text style={{ flexShrink: 1 }} accessibilityLiveRegion="polite">
                {reading
                  ? t('docIntel.progress', { done: Math.min(summary.read + summary.failed + 1, summary.total), total: summary.total })
                  : t('docIntel.summary', { ready: summary.savable, fix: summary.toFix, failed: summary.failed })}
              </Text>
              {reading ? <Button size="sm" variant="outline" label={t('docIntel.stop')} onPress={batch.stop} /> : null}
              {!reading && left > 0 ? <Text tone="warning">{t('docIntel.stopped', { count: left })}</Text> : null}
              {!reading && left > 0 ? <Button size="sm" variant="outline" label={t('docIntel.readRest')} onPress={batch.retry} /> : null}
            </View>
            <Text variant="caption" tone="muted">{t('docIntel.estimate')}</Text>
            {items.map((item, i) => <RecordReview key={item.page.id} item={item} index={i} batch={batch} />)}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
