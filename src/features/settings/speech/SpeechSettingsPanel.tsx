/**
 * Speech settings (docs/10 §5.3, §16): language to listen in, language and voice to speak in,
 * speaking speed, a "Test voice" button, and the recording privacy switch.
 * Self-contained: reads and writes `settings.speech` through the settings store.
 *
 * Recognition and speech output are separate. The panel says plainly when this device has no voice
 * for a language, and where the person's voice is turned into text.
 */
import { Minus, Plus, Volume2 } from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { DEFAULT_SPEECH, type SpeechPreferences } from '@/core/contracts';
import { Button, Chip, IconButton, Surface, SwitchRow, Text, useToast } from '@/design';
import { getSpeechCapability, type SpeechCapability } from '@/infrastructure/platform/speech';
import {
  chooseVoice, getSpeaker, getTtsAdapter, languageBase, voicesForLanguage, type SpeechVoice,
} from '@/infrastructure/platform/tts';
import { useSettingsStore } from '@/state/settings-store';
import { findSpeechLanguage, formatRate, SPEECH_LANGUAGES, stepRate } from './languages';

const SERVICE = Platform.OS === 'web' ? "your browser's speech service" : "Android's speech service";
const MAX_VOICE_CHIPS = 6;

function Block({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text variant="h4">{title}</Text>
        {description ? <Text variant="bodySmall" tone="secondary">{description}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function LanguageChips({ value, label, onChange }: { value: string; label: string; onChange(tag: string): void }) {
  return (
    <View role="radiogroup" aria-label={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {SPEECH_LANGUAGES.map((l) => (
        <Chip
          key={l.tag}
          role="radio"
          label={l.native}
          accessibilityLabel={l.english}
          selected={value === l.tag}
          onPress={() => onChange(l.tag)}
        />
      ))}
    </View>
  );
}

/** Where the person's voice is turned into text, in one plain sentence. */
export function recognitionNote(cap: SpeechCapability | undefined): string {
  if (!cap) return 'Checking what this device can hear.';
  if (!cap.supported) return 'Speech recognition is not available here. You can type commands instead.';
  if (cap.onDevice === 'available') return 'Your voice is turned into text on this device.';
  if (cap.onDevice === 'downloadable' || cap.onDevice === 'downloading') {
    return `Your voice goes to ${SERVICE} to be turned into text. Download the on-device model when asked, and it stays on this device.`;
  }
  return `Your voice goes to ${SERVICE} to be turned into text. Kalam asks first, and never uploads the recording.`;
}

/** What Kalam will do about the voice for the chosen speaking language. Never silent about a mismatch. */
export function voiceNote(
  voices: readonly SpeechVoice[], speech: SpeechPreferences, available: boolean | undefined,
): string {
  if (available === false) return 'This device cannot speak aloud, so spoken replies and read-aloud stay silent.';
  if (available === undefined) return 'Checking the voices on this device.';
  const lang = findSpeechLanguage(speech.ttsLanguage);
  const name = lang?.english ?? speech.ttsLanguage;
  const choice = chooseVoice(voices, { voiceId: speech.voiceId, language: speech.ttsLanguage });
  switch (choice.match) {
    case 'voice':
    case 'language':
      return `Speaking with ${choice.voice?.name}.`;
    case 'language_base':
      return `No ${name} voice is installed. Kalam will use ${choice.voice?.name} (${choice.voice?.language}).`;
    default:
      return `No ${name} voice is installed on this device. Kalam will use the default voice, which may not read ${name} well. Install a voice in your device settings.`;
  }
}

export function SpeechSettingsPanel() {
  const toast = useToast();
  const stored = useSettingsStore((s) => s.settings.speech);
  const update = useSettingsStore((s) => s.update);
  const speech: SpeechPreferences = stored ?? DEFAULT_SPEECH;

  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [canSpeak, setCanSpeak] = useState<boolean | undefined>(undefined);
  const [cap, setCap] = useState<SpeechCapability | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const tts = getTtsAdapter();
    Promise.all([tts.isAvailable(), tts.getVoices()])
      .then(([ok, list]) => {
        if (!alive) return;
        setCanSpeak(ok);
        setVoices(list);
      })
      .catch(() => alive && setCanSpeak(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setCap(undefined);
    getSpeechCapability(speech.sttLanguage)
      .then((c) => alive && setCap(c))
      .catch(() => alive && setCap({ supported: false, onDevice: 'unavailable', locale: speech.sttLanguage }));
    return () => {
      alive = false;
    };
  }, [speech.sttLanguage]);

  const save = (patch: Partial<SpeechPreferences>) => {
    const next: SpeechPreferences = { ...speech, ...patch };
    if (next.voiceId === undefined) delete next.voiceId;
    update({ speech: next }).catch(() => toast.show({ message: 'Could not save that setting. It was changed back.', tone: 'danger' }));
  };

  const voiceChoices = useMemo(
    () => voicesForLanguage(voices, speech.ttsLanguage).slice(0, MAX_VOICE_CHIPS),
    [voices, speech.ttsLanguage],
  );

  const setSpeakingLanguage = (tag: string) => {
    // A saved voice belongs to the language it was picked for.
    const keep = speech.voiceId && voices.find((v) => v.id === speech.voiceId && languageBase(v.language) === languageBase(tag));
    save({ ttsLanguage: tag, voiceId: keep ? speech.voiceId : undefined });
  };

  const testVoice = () => {
    if (canSpeak === false) {
      toast.show({ message: 'This device cannot speak aloud.', tone: 'danger' });
      return;
    }
    const sample = findSpeechLanguage(speech.ttsLanguage)?.sample ?? 'This is how Kalam will sound.';
    getSpeaker().say({
      text: sample, language: speech.ttsLanguage, voiceId: speech.voiceId, rate: speech.rate, priority: 'critical', interrupt: true,
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h3">Voice and speech</Text>
        <Text tone="secondary">
          Choose the language Kalam listens for, and the voice it speaks with. Listening only starts when you tap the microphone.
        </Text>
      </View>
      <Surface padded={20} style={{ gap: 24 }}>
        <Block title="Listening language" description={recognitionNote(cap)}>
          <LanguageChips value={speech.sttLanguage} label="Listening language" onChange={(tag) => save({ sttLanguage: tag })} />
        </Block>

        <Block title="Speaking language" description={voiceNote(voices, speech, canSpeak)}>
          <LanguageChips value={speech.ttsLanguage} label="Speaking language" onChange={setSpeakingLanguage} />
          {voiceChoices.length > 0 ? (
            <View role="radiogroup" aria-label="Voice" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip role="radio" label="Automatic" selected={speech.voiceId === undefined} onPress={() => save({ voiceId: undefined })} />
              {voiceChoices.map((v) => (
                <Chip
                  key={v.id}
                  role="radio"
                  label={v.name}
                  accessibilityLabel={`${v.name}${v.local ? '' : ', needs the internet'}`}
                  selected={speech.voiceId === v.id}
                  onPress={() => save({ voiceId: v.id })}
                />
              ))}
            </View>
          ) : null}
        </Block>

        <Block title="Speaking speed">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconButton
              icon={Minus} label="Speak slower" variant="outline" disabled={speech.rate <= 0.5}
              onPress={() => save({ rate: stepRate(speech.rate, -1) })}
            />
            <Text variant="h4" numeric accessibilityLiveRegion="polite" style={{ minWidth: 64, textAlign: 'center' }}>
              {formatRate(speech.rate)}
            </Text>
            <IconButton
              icon={Plus} label="Speak faster" variant="outline" disabled={speech.rate >= 2}
              onPress={() => save({ rate: stepRate(speech.rate, 1) })}
            />
            <Button label="Test voice" icon={Volume2} variant="secondary" onPress={testVoice} />
          </View>
        </Block>

        <SwitchRow
          label="Keep recordings on this device"
          description="When you describe an app by voice, the recording is deleted as soon as it has been turned into text. Turn this on to keep a copy here. Recordings are never uploaded."
          value={speech.keepRecordings}
          onValueChange={(v) => save({ keepRecordings: v })}
        />
        <Text variant="bodySmall" tone="muted">
          Speech settings are saved on this device only.
        </Text>
      </Surface>
    </View>
  );
}
