/** Save screens as PNG files (docs/08 §14.1-§14.3): one screen or all, at a chosen sharpness. */
import { FileDown } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Button, SegmentedControl, Sheet, Text, useKalamTheme, useToast } from '@/design';
import { exportDrawing } from './drawing-actions';
import { EXPORT_SCALE_LABELS, EXPORT_SCALES, exportSize, pageHasVisibleContent, type ExportScale } from './model';
import type { StudioState } from './studio-store';

type Scope = 'page' | 'all';
type ScaleKey = `${ExportScale}`;

export function ExportSheet({ store, visible, onClose, initialScope = 'page' }: {
  store: StoreApi<StudioState>; visible: boolean; onClose: () => void; initialScope?: Scope;
}) {
  const { space } = useKalamTheme();
  const toast = useToast();
  const pages = useStore(store, (s) => s.history.present.pages);
  const pageId = useStore(store, (s) => s.pageId);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [scale, setScale] = useState<ScaleKey>('2');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setScope(initialScope); }, [visible, initialScope]);

  const current = pages.find((p) => p.id === pageId) ?? pages[0]!;
  const chosen = scope === 'all' ? pages : [current];
  const withContent = chosen.filter(pageHasVisibleContent);
  const size = exportSize(current, Number(scale));

  const save = async () => {
    setBusy(true);
    try {
      const doc = store.getState().history.present;
      const res = await exportDrawing(doc, chosen.map((p) => p.id), Number(scale) as ExportScale);
      onClose();
      toast.show({
        message: res.outcome === 'saved'
          ? res.files === 1 ? 'Saved the PNG to your downloads.' : `Saved ${res.files} screens to your downloads as a zip file.`
          : 'Choose where to save the file.',
        tone: 'success',
      });
    } catch (e) {
      toast.show({ message: e instanceof Error && e.message ? e.message : 'The file could not be saved. Try again.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Export as PNG" description="Saves a picture of your screens to this device." dismissible={!busy}>
      <View style={{ gap: space[5] }}>
        <SegmentedControl<Scope>
          label="Screens"
          options={[{ value: 'page', label: 'This screen' }, { value: 'all', label: `All ${pages.length}` }]}
          value={scope}
          onChange={setScope}
        />
        <SegmentedControl<ScaleKey>
          label="Sharpness"
          options={EXPORT_SCALES.map((s) => ({ value: `${s}` as ScaleKey, label: EXPORT_SCALE_LABELS[s] }))}
          value={scale}
          onChange={setScale}
        />
        <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">
          {size.width} by {size.height} pixels per screen.{chosen.length > 1 ? ' Several screens are saved together in one zip file.' : ''}
          {withContent.length < chosen.length ? ' Empty screens are saved as blank pages.' : ''}
        </Text>
        <Button label={chosen.length > 1 ? `Save ${chosen.length} PNG files` : 'Save PNG'} icon={FileDown} onPress={save} loading={busy} />
      </View>
    </Sheet>
  );
}
