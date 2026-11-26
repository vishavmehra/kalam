import { Pause, Play, RotateCcw, Square, Volume2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { DEFAULT_SPEECH } from '@/core/contracts';
import { Button, Text, useKalamTheme } from '@/design';
import { getSpeaker } from '@/infrastructure/platform/tts';
import { useT } from '@/i18n/react';
import { stopSpeakingAloud } from '@/runtime/voice/speak';
import { speechVoiceFor } from '@/runtime/voice/speech-voice';
import { useSettingsStore } from '@/state/settings-store';

import { createShelfReader, type ReaderSpeech, type ReaderStatus, type ShelfReader } from './read-aloud';

/** The shared speech queue, with the person's voice and speed (the same path as every other spoken line). */
function sharedSpeech(lang: string): ReaderSpeech {
  return {
    say(text) {
      try {
        const speech = useSettingsStore.getState().settings.speech ?? DEFAULT_SPEECH;
        return getSpeaker().say({ text, priority: 'result', ...speechVoiceFor(speech, lang) });
      } catch {
        return false; // No voice on this device: the shelf keeps working.
      }
    },
    stop: stopSpeakingAloud,
    subscribe(listener) {
      try {
        return getSpeaker().subscribe(listener);
      } catch {
        return () => undefined;
      }
    },
  };
}

/**
 * Read-aloud mode on the shelf (docs/10 §4.4): says what is on the shelf once it has loaded, and offers Pause, Resume,
 * Stop and Repeat for as long as the mode is on. Silent and invisible when the mode is off.
 */
export function ShelfReadAloud({ sentences, ready }: { sentences: readonly string[]; ready: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const on = useSettingsStore((s) => s.settings.accessModes.readAloud);
  const [status, setStatus] = useState<ReaderStatus>('idle');
  const reader = useRef<ShelfReader | null>(null);
  const started = useRef(false);
  const latest = useRef(sentences);
  useEffect(() => { latest.current = sentences; });

  useEffect(() => {
    if (!on) return undefined;
    const r = createShelfReader(sharedSpeech(theme.uiLanguage));
    reader.current = r;
    const off = r.onChange(setStatus);
    return () => { off(); r.dispose(); reader.current = null; started.current = false; setStatus('idle'); };
  }, [on, theme.uiLanguage]);

  // Once per visit, when the shelf has loaded.
  useEffect(() => {
    if (!on || !ready || started.current || !reader.current || !latest.current.length) return;
    started.current = true;
    reader.current.start(latest.current);
  }, [on, ready, sentences]);

  if (!on || !ready) return null;
  const label = t('shelf.readAloudBar.label');
  return (
    <View role="group" aria-label={label} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 }} testID="shelf-read-aloud">
      <Volume2 size={18} color={theme.colors.textSecondary} aria-hidden />
      <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite">{t(`shelf.readAloudBar.${status}` as const)}</Text>
      {status === 'reading' ? (
        <Button label={t('shelf.readAloudBar.pause')} icon={Pause} variant="outline" size="sm" onPress={() => reader.current?.pause()} testID="shelf-read-pause" />
      ) : status === 'paused' ? (
        <Button label={t('shelf.readAloudBar.resume')} icon={Play} variant="outline" size="sm" onPress={() => reader.current?.resume()} testID="shelf-read-resume" />
      ) : null}
      {status === 'reading' || status === 'paused' ? (
        <Button label={t('shelf.readAloudBar.stop')} icon={Square} variant="ghost" size="sm" onPress={() => reader.current?.stop()} testID="shelf-read-stop" />
      ) : null}
      <Button label={t('shelf.readAloudBar.repeat')} icon={RotateCcw} variant="ghost" size="sm" onPress={() => reader.current?.repeat()} testID="shelf-read-repeat" />
    </View>
  );
}
