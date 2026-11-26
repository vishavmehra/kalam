/** Save screens as PNG, SVG or PDF files (docs/08 §14.1-§14.3): one screen or all, at a chosen sharpness. */
import { FileDown } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button, SegmentedControl, Sheet, Text, useKalamTheme, useToast } from '@/design';
import { exportDrawingAs } from './drawing-actions';
import { EXPORT_FORMATS, EXPORT_SCALES, exportSize, pageHasVisibleContent, type ExportFormat, type ExportScale } from './model';
import type { StudioState } from './studio-store';
import { t as gt } from '@/i18n/active';
import type { TranslationKey } from '@/i18n/keys';
import { formatLabel, scaleLabel } from './studio-text';

type Scope = 'page' | 'all';
type ScaleKey = `${ExportScale}`;

const DESCRIPTION_KEYS: Record<ExportFormat, TranslationKey> = { png: 'studio.export.descPng', svg: 'studio.export.descSvg', pdf: 'studio.export.descPdf' };
const NOUN: Record<ExportFormat, string> = { png: 'PNG', svg: 'SVG', pdf: 'PDF' };

export function ExportSheet({ store, visible, onClose, initialScope = 'page', initialFormat = 'png' }: {
  store: StoreApi<StudioState>; visible: boolean; onClose: () => void; initialScope?: Scope; initialFormat?: ExportFormat;
}) {
  const { space } = useKalamTheme();
  const toast = useToast();
  const pages = useStore(store, (s) => s.history.present.pages);
  const pageId = useStore(store, (s) => s.pageId);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [scale, setScale] = useState<ScaleKey>('2');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setScope(initialScope); setFormat(initialFormat); } }, [visible, initialScope, initialFormat]);

  const current = pages.find((p) => p.id === pageId) ?? pages[0]!;
  // A PDF always holds every screen.
  const chosen = format === 'pdf' || scope === 'all' ? pages : [current];
  const withContent = chosen.filter(pageHasVisibleContent);
  const size = exportSize(current, Number(scale));

  const save = async () => {
    setBusy(true);
    try {
      const doc = store.getState().history.present;
      const res = await exportDrawingAs(format, doc, chosen.map((p) => p.id), Number(scale) as ExportScale);
      onClose();
      toast.show({
        message: res.outcome === 'saved'
          ? res.files === 1 ? gt('studio.export.savedOne', { format: NOUN[format] }) : gt('studio.export.savedMany', { count: res.files })
          : gt('studio.export.chooseWhere'),
        tone: 'success',
      });
    } catch (e) {
      toast.show({ message: e instanceof Error && e.message ? e.message : gt('studio.export.saveFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const several = chosen.length > 1;
  const label = format === 'pdf' ? gt('studio.export.savePdf') : several ? gt('studio.export.saveMany', { count: chosen.length, format: NOUN[format] }) : gt('studio.export.saveOne', { format: NOUN[format] });

  const summary = [
    format === 'svg' ? gt('studio.export.sizeSvg', { count: chosen.length, width: current.width, height: current.height }) : gt('studio.export.sizePng', { width: size.width, height: size.height }),
    format === 'pdf' ? gt('studio.export.pagesInFile', { count: pages.length }) : several ? gt('studio.export.zipNote') : '',
    withContent.length < chosen.length ? gt('studio.export.blankNote') : '',
  ].filter(Boolean).join(' ');

  return (
    <Sheet visible={visible} onClose={onClose} title={gt('studio.export.title')} description={gt(DESCRIPTION_KEYS[format])} dismissible={!busy}>
      <View style={{ gap: space[5] }}>
        <SegmentedControl<ExportFormat>
          label={gt('studio.export.fileType')}
          options={EXPORT_FORMATS.map((f) => ({ value: f.id, label: formatLabel(f.id) }))}
          value={format}
          onChange={setFormat}
        />
        {format === 'pdf' ? null : (
          <SegmentedControl<Scope>
            label={gt('studio.pages.label')}
            options={[{ value: 'page', label: gt('studio.export.thisScreen') }, { value: 'all', label: gt('studio.export.all', { count: pages.length }) }]}
            value={scope}
            onChange={setScope}
          />
        )}
        {format === 'svg' ? null : (
          <SegmentedControl<ScaleKey>
            label={gt('studio.export.sharpness')}
            options={EXPORT_SCALES.map((s) => ({ value: `${s}` as ScaleKey, label: scaleLabel(s) }))}
            value={scale}
            onChange={setScale}
          />
        )}
        <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">
          {summary}
        </Text>
        <Button label={label} icon={FileDown} onPress={save} loading={busy} />
      </View>
    </Sheet>
  );
}
