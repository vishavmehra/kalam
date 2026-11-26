/**
 * "Turn handwriting into text" (docs/08 §15.6). Reads the selected pen strokes and shows what it found, with
 * where the reading came from, in a box the person can fix. The strokes are replaced by typed text only when
 * the person presses the button, and one Undo brings the writing back.
 *
 * Order: digits matched on this device, then Gemini Nano on this device, and only after the person agrees,
 * one try with Gemini in the cloud. See handwriting-service.ts.
 */
import { Cloud, ScanText, Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { StoreApi } from 'zustand/vanilla';
import { Button, Sheet, Text, TextField, useKalamTheme, useToast } from '@/design';
import { cloudAllowed } from '@/features/create/cloud-use';
import { getServices } from '@/services';
import { useSettingsStore } from '@/state/settings-store';
import { exportPagePng } from './export';
import { readDigits, readInCloud, readOnDevice, type HandwritingDeps, type Reading } from './handwriting-service';
import {
  dominantColor, HANDWRITING_MAX_CHARS, handwritingStrokes, readingSourceLabel, strokePicturePage, textPlacement, tidyText, type StrokeElement,
} from './model';
import { currentPage, type StudioState } from './studio-store';
import { t as gt } from '@/i18n/active';

type Stage =
  | { name: 'working' }
  | { name: 'review'; reading?: Reading; note?: string }
  | { name: 'cloud_offer'; message: string }
  | { name: 'cloud_working' };

export function HandwritingSheet({ store, visible, onClose }: { store: StoreApi<StudioState>; visible: boolean; onClose: () => void }) {
  const { space } = useKalamTheme();
  const toast = useToast();
  const language = useSettingsStore((s) => s.settings.language);
  const [stage, setStage] = useState<Stage>({ name: 'working' });
  const [text, setText] = useState('');
  const strokes = useRef<StrokeElement[]>([]);
  const cloudTried = useRef(false);
  const abort = useRef<AbortController | undefined>(undefined);
  /** Counts readings, so an answer that arrives after the sheet closed or a newer reading started is ignored. */
  const run = useRef(0);

  const deps = (): HandwritingDeps => {
    const services = getServices();
    return {
      ai: services.ai,
      picture: (s) => {
        const image = exportPagePng(strokePicturePage(s), 0);
        return { mimeType: 'image/png', base64: image.base64 };
      },
      cloudAllowed: async () => cloudAllowed(await services.db.settings.get()) && services.network.online(),
      languages: [language],
      signal: abort.current?.signal,
    };
  };

  /** Gemini Nano on this device. `keep` is the reading shown before, which stays on screen if this one fails. */
  const readWithModel = (keep?: Reading) => {
    const mine = ++run.current;
    setStage({ name: 'working' });
    readOnDevice(strokes.current, deps()).then((out) => {
      if (run.current !== mine) return;
      if (out.kind === 'read') { setText(out.reading.text); setStage({ name: 'review', reading: out.reading }); }
      else if (out.kind === 'nothing') setStage({ name: 'review', reading: keep, note: gt('studio.hw.nothing') });
      else if (out.cloudPossible) setStage({ name: 'cloud_offer', message: out.message });
      else setStage({ name: 'review', reading: keep, note: `${out.message} Type what it says instead.` });
    }).catch(() => { if (run.current === mine) setStage({ name: 'review', reading: keep, note: gt('studio.hw.failed') }); });
  };

  useEffect(() => {
    if (!visible) { run.current += 1; abort.current?.abort(); return undefined; }
    // Take the selection once, when the sheet opens, so later taps on the canvas do not change what is read.
    const s = store.getState();
    const picked = new Set(s.selectedIds);
    strokes.current = handwritingStrokes(currentPage(s).elements.filter((e) => picked.has(e.id)));
    cloudTried.current = false;
    abort.current = new AbortController();
    setText('');
    if (strokes.current.length === 0) { setStage({ name: 'review', note: gt('studio.hw.selectFirst') }); return undefined; }
    const digits = readDigits(strokes.current);
    if (digits) { setText(digits.text); setStage({ name: 'review', reading: digits }); return undefined; }
    readWithModel();
    return () => { run.current += 1; };
    // The sheet reads once per opening. `deps` only reads services and the language at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, store]);

  const sendToCloud = async () => {
    // One cloud try per reading, and only after the person pressed the button (lead decision 2).
    if (cloudTried.current) return;
    cloudTried.current = true;
    const mine = ++run.current;
    setStage({ name: 'cloud_working' });
    try {
      const out = await readInCloud(strokes.current, deps());
      if (run.current !== mine) return;
      if (out.kind === 'read') { setText(out.reading.text); setStage({ name: 'review', reading: out.reading }); }
      else if (out.kind === 'nothing') setStage({ name: 'review', note: gt('studio.hw.nothing') });
      else setStage({ name: 'review', note: out.message });
    } catch {
      if (run.current === mine) setStage({ name: 'review', note: gt('studio.hw.noCloud') });
    }
  };

  const confirm = () => {
    // What the person sees in the box is what is used. Only blanks are tidied, nothing is cut off.
    const clean = tidyText(text);
    if (!clean || strokes.current.length === 0) return;
    const at = textPlacement(strokes.current, clean);
    store.getState().replaceWithText(strokes.current.map((s) => s.id), clean, { ...at, color: dominantColor(strokes.current) });
    onClose();
    toast.show({ message: gt('studio.hw.replaced'), tone: 'success' });
  };

  const working = stage.name === 'working' || stage.name === 'cloud_working';
  const reading = stage.name === 'review' ? stage.reading : undefined;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={gt('studio.sel.handwriting')}
      description={gt('studio.hw.intro')}
      dismissible={stage.name !== 'cloud_working'}
    >
      <View style={{ gap: space[4] }} accessibilityLiveRegion="polite">
        {working ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <ActivityIndicator />
            <Text>{stage.name === 'cloud_working' ? gt('studio.hw.workingCloud') : gt('studio.hw.workingDevice')}</Text>
          </View>
        ) : null}

        {stage.name === 'cloud_offer' ? (
          <View style={{ gap: space[3] }}>
            <Text>{stage.message}</Text>
            <Text variant="bodySmall" tone="secondary">
              Gemini in the cloud can try instead. Only a picture of the selected writing would be sent. The rest of your drawing and your apps stay on this device.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <Button label={gt('studio.hw.sendCloud')} icon={Cloud} onPress={() => { void sendToCloud(); }} />
              <Button label={gt('studio.hw.typeInstead')} variant="outline" onPress={() => setStage({ name: 'review', note: gt('studio.hw.typePrompt') })} />
            </View>
          </View>
        ) : null}

        {stage.name === 'review' ? (
          <View style={{ gap: space[3] }}>
            {reading ? <Text variant="bodySmall" tone="secondary">{readingSourceLabel(reading.source)}</Text> : null}
            {stage.note ? <Text variant="bodySmall" tone="secondary">{stage.note}</Text> : null}
            {reading?.source === 'deterministic' ? (
              <Text variant="bodySmall" tone="secondary">{gt('studio.hw.digitsNote')}</Text>
            ) : null}
            {reading?.unsure ? <Text variant="bodySmall" tone="warning">{gt('studio.hw.unsure')}</Text> : null}
            {reading?.shortened ? <Text variant="bodySmall" tone="warning">{gt('studio.hw.shortened')}</Text> : null}
            <TextField label={gt('studio.hw.whatItSays')} value={text} onChangeText={setText} multiline maxLength={HANDWRITING_MAX_CHARS} testID="handwriting-text" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <Button label={gt('studio.hw.replace')} icon={ScanText} disabled={!tidyText(text)} onPress={confirm} testID="handwriting-confirm" />
              {reading?.source === 'deterministic' ? (
                <Button label={gt('studio.hw.readAi')} icon={Sparkles} variant="outline" onPress={() => readWithModel(reading)} testID="handwriting-read-ai" />
              ) : null}
              <Button label={gt('studio.hw.keep')} variant="ghost" onPress={onClose} />
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
