/**
 * "Speak the change" for edit by drawing (docs/01 §9.3 step 4, docs/03 §17.3). Same rules as the
 * rest of Kalam's speech (docs/10 §16.4): on-device recognition when the device has it, the
 * platform's online speech service only after the person agrees, never in offline-only mode, and
 * the recording is not kept.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { speechServiceName } from '@/features/settings/speech/languages';
import { getSpeechCapability, startDictation, type DictationSession } from '@/infrastructure/platform/speech';
import { blockedMessage, chooseSpeechPath } from '@/infrastructure/platform/speech-policy';
import { t as gt } from '@/i18n/active';
import { useSettingsStore } from '@/state/settings-store';

const name = speechServiceName(Platform.OS);
const SERVICE = name.charAt(0).toUpperCase() + name.slice(1);

/** `lang` is the listening language (settings.speech.sttLanguage), never the app's own language. */
export function useDictation(lang: string, onText: (text: string) => void) {
  const aiMode = useSettingsStore((s) => s.settings.aiMode);
  const allowCloud = useSettingsStore((s) => s.settings.allowCloud);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const session = useRef<DictationSession | undefined>(undefined);
  const consent = useRef(false);
  /** Open while asking to use the online speech service. The host renders it as an in-app sheet. */
  const [ask, setAsk] = useState<{ message: string; answer(ok: boolean): void } | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  useEffect(() => () => session.current?.abort(), []);

  const stop = useCallback(() => session.current?.abort(), []);

  /** Starts listening (new words follow `before`), or stops when already listening. */
  const toggle = useCallback(async (before: string) => {
    if (session.current) {
      session.current.stop();
      return;
    }
    setError(undefined);
    const cap = await getSpeechCapability(lang).catch(() => undefined);
    let path = chooseSpeechPath(cap, { aiMode, allowCloud, consent: consent.current });
    if (path.kind === 'needs_consent') {
      const ok = await new Promise<boolean>((resolve) => {
        setAsk({
          message: gt('edit.draw.speech.askMessage', { service: SERVICE }),
          answer: (yes) => { setAsk(null); resolve(yes); },
        });
      });
      if (!ok) return;
      consent.current = true;
      path = { kind: 'cloud_service' };
    }
    if (path.kind === 'blocked' || path.kind === 'unsupported') {
      setError(blockedMessage(path));
      return;
    }
    const prefix = before.trim() ? `${before.trim()} ` : '';
    try {
      session.current = await startDictation({
        lang,
        onDevice: path.kind === 'on_device',
        keepRecording: false,
        onText: (text) => textRef.current(`${prefix}${text}`.trim()),
        onError: (message) => {
          if (message) setError(message);
        },
        onEnd: () => {
          session.current = undefined;
          setListening(false);
        },
      });
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : gt('edit.draw.speech.couldNotStart'));
    }
  }, [lang, aiMode, allowCloud]);

  return { listening, error, toggle, stop, ask };
}
