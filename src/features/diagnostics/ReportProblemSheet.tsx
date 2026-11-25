import { Copy, LifeBuoy, Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, fontFamilies, SegmentedControl, Sheet, Surface, Text, useToast } from '@/design';

import { diagnosticsCopy } from './copy';
import { REPORT_AREAS, type ReportArea } from './report';
import { copyText, shareText } from './share';
import { useProblemReport } from './use-diagnostics';

const copy = diagnosticsCopy.problem;

export interface ReportProblemSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Which area is picked when the sheet opens. Default "Something else". */
  defaultArea?: ReportArea;
}

/**
 * A problem report the person builds, reads and then chooses to share or copy. It holds an app
 * version, the platform, recent error codes, timing summaries and a few settings. It never holds
 * apps, entries, prompts, photos, recordings or file names. Nothing is sent from here: the system
 * share sheet or the clipboard is the only way it leaves the device, and only when the person asks.
 */
export function ReportProblemSheet({ visible, onClose, defaultArea = 'other' }: ReportProblemSheetProps) {
  const toast = useToast();
  const [area, setArea] = useState<ReportArea>(defaultArea);
  const [busy, setBusy] = useState<'share' | 'copy' | null>(null);
  const { text, ready } = useProblemReport(visible, area);

  const share = async () => {
    setBusy('share');
    const outcome = await shareText(text, copy.shareTitle);
    setBusy(null);
    if (outcome === 'shared') toast.show({ message: copy.toasts.shared, tone: 'success' });
    else if (outcome === 'copied') toast.show({ message: copy.toasts.copied, tone: 'success' });
    else if (outcome === 'failed') toast.show({ message: copy.toasts.failed, tone: 'danger' });
    // 'cancelled': the person closed the share sheet. Nothing to say.
  };

  const copyReport = async () => {
    setBusy('copy');
    const outcome = await copyText(text);
    setBusy(null);
    toast.show(outcome === 'copied' ? { message: copy.toasts.copied, tone: 'success' } : { message: copy.toasts.failed, tone: 'danger' });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      maxWidth={600}
      footer={
        <>
          <Button label={copy.copy} icon={Copy} variant="outline" onPress={() => void copyReport()} loading={busy === 'copy'} disabled={!ready || busy !== null} />
          <Button label={copy.share} icon={Share2} onPress={() => void share()} loading={busy === 'share'} disabled={!ready || busy !== null} />
        </>
      }
    >
      <View style={{ gap: 16, paddingBottom: 8 }}>
        <SegmentedControl
          label={copy.areaLabel}
          wrap
          value={area}
          onChange={setArea}
          options={REPORT_AREAS.map((value) => ({ value, label: copy.areas[value] }))}
        />
        <View style={{ gap: 8 }}>
          <Text variant="bodySmall" weight="medium" tone="secondary">{copy.previewLabel}</Text>
          <Surface tone="alt" padded={14} accessibilityLabel={copy.previewA11y} role="group">
            <Text variant="bodySmall" selectable style={{ fontFamily: fontFamilies.mono }}>{text}</Text>
          </Surface>
        </View>
      </View>
    </Sheet>
  );
}

/** A button that opens the report sheet. Owns the sheet's open state, so it can be dropped in anywhere. */
export function ReportProblemButton({ defaultArea }: { defaultArea?: ReportArea }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label={copy.open} icon={LifeBuoy} variant="outline" onPress={() => setOpen(true)} accessibilityHint={copy.openHint} />
      <ReportProblemSheet visible={open} onClose={() => setOpen(false)} defaultArea={defaultArea} />
    </>
  );
}
