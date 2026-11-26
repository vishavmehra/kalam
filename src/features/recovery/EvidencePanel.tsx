import { Copy, Download } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import type { InferenceEvent } from '@/core/contracts';
import { timings } from '@/core/observability';
import { Button, Surface, Text, useKalamTheme, useToast } from '@/design';
import { readDeviceInfo } from '@/features/diagnostics/device';
import { copyText } from '@/features/diagnostics/share';
import { saveExportFiles } from '@/features/drawing/export';
import { SectionHeading } from '@/features/settings/Section';
import { useFormat, useT } from '@/i18n/react';
import { getServices } from '@/services';

import { buildEvidence, EVIDENCE_RUN_LIMIT, evidenceFileName, evidenceJson } from './evidence';

const load = (): Promise<InferenceEvent[]> => getServices().db.events.list(EVIDENCE_RUN_LIMIT);

/**
 * Settings block that saves the hybrid-run evidence file (docs/17 §5.4). The file is built from the
 * activity log when the person presses a button, holds no prompts, entries, photos, recordings or app
 * names (see evidence.ts), and goes only where they save or paste it. Nothing is sent by this panel.
 * Self-contained: it draws its own heading.
 */
export function EvidencePanel() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { integer } = useFormat(theme.uiLanguage);
  const toast = useToast();
  const [count, setCount] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    load().then((events) => alive && setCount(events.length)).catch(() => alive && setCount(0));
    return () => {
      alive = false;
    };
  }, []);

  const build = useCallback(async () => {
    const now = Date.now();
    const events = await load();
    return { now, json: evidenceJson(buildEvidence({ events, timings: timings.summarize(), device: readDeviceInfo(), now })) };
  }, []);

  const act = async (how: 'save' | 'copy') => {
    setBusy(true);
    try {
      const { now, json } = await build();
      if (how === 'copy') {
        const out = await copyText(json);
        toast.show(out === 'copied' ? { message: t('recovery.evidence.copied'), tone: 'success' } : { message: t('recovery.evidence.failed'), tone: 'danger' });
      } else {
        await saveExportFiles(
          [{ name: evidenceFileName(now), bytes: new TextEncoder().encode(json), mimeType: 'application/json' }],
          'kalam-hybrid-evidence.zip',
        );
        toast.show({ message: t('recovery.evidence.saved'), tone: 'success' });
      }
    } catch {
      toast.show({ message: t('recovery.evidence.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <SectionHeading title={t('recovery.evidence.title')} description={t('recovery.evidence.description')} />

      <Surface padded={20} style={{ gap: 12 }}>
        <Text>{count === undefined ? t('common.loading') : count === 0 ? t('recovery.evidence.empty') : t('recovery.evidence.runs', { count: integer(count) })}</Text>
        <Text variant="bodySmall" tone="secondary">{t('recovery.evidence.local')}</Text>
        <View style={{ gap: 8 }}>
          <Button label={t('recovery.evidence.save')} icon={Download} loading={busy} disabled={!count} onPress={() => void act('save')} />
          <Button label={t('recovery.evidence.copy')} variant="outline" icon={Copy} disabled={busy || !count} onPress={() => void act('copy')} />
        </View>
      </Surface>
    </View>
  );
}
