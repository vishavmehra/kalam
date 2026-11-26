/**
 * Speech settings (docs/10 §5.3, §16): language to listen in, language and voice to speak in,
 * speaking speed, a "Test voice" button, and the recording privacy switch.
 * Self-contained: reads and writes `settings.speech` through the settings store.
 *
 * Recognition and speech output are separate. The panel says plainly when this device has no voice
 * for a language, and where the person's voice is turned into text.
 */
import { Minus, Plus, ScanSearch, Volume2 } from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { DEFAULT_SPEECH, type SpeechPreferences } from '@/core/contracts';
import { Button, Chip, IconButton, LedgerRule, Surface, SwitchRow, Text, useKalamTheme, useToast } from '@/design';
import { t as tActive } from '@/i18n/active';
import { useT } from '@/i18n/react';
import { getSpeechCapability, type SpeechCapability } from '@/infrastructure/platform/speech';
import {
  chooseVoice, getSpeaker, getTtsAdapter, languageBase, voicesForLanguage, type SpeechVoice,
} from '@/infrastructure/platform/tts';
import { useSettingsStore } from '@/state/settings-store';
import { findSpeechLanguage, formatRate, SPEECH_LANGUAGES, speechServiceName, stepRate } from './languages';

const SERVICE = speechServiceName(Platform.OS);
const MAX_VOICE_CHIPS = 6;

function Block({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text variant="h4" level={3}>{title}</Text>
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
  if (!cap) return tActive('settings.speech.rec.unchecked');
  if (!cap.supported) return tActive('settings.speech.rec.unsupported');
  if (cap.onDevice === 'available') return tActive('settings.speech.rec.onDevice');
  if (cap.onDevice === 'downloadable' || cap.onDevice === 'downloading') {
    return tActive('settings.speech.rec.download', { service: SERVICE });
  }
  return tActive('settings.speech.rec.cloud', { service: SERVICE });
}

/** What Kalam will do about the voice for the chosen speaking language. Never silent about a mismatch. */
export function voiceNote(
  voices: readonly SpeechVoice[], speech: SpeechPreferences, available: boolean | undefined,
): string {
  if (available === false) return tActive('settings.speech.voiceNote.none');
  if (available === undefined) return tActive('settings.speech.voiceNote.checking');
  const lang = findSpeechLanguage(speech.ttsLanguage);
  const name = lang?.english ?? speech.ttsLanguage;
  const choice = chooseVoice(voices, { voiceId: speech.voiceId, language: speech.ttsLanguage });
  switch (choice.match) {
    case 'voice':
    case 'language':
      return tActive('settings.speech.voiceNote.using', { voice: choice.voice?.name ?? '' });
    case 'language_base':
      return tActive('settings.speech.voiceNote.base', { language: name, voice: choice.voice?.name ?? '', code: choice.voice?.language ?? '' });
    default:
      return tActive('settings.speech.voiceNote.missing', { language: name });
  }
}

export function SpeechSettingsPanel() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const stored = useSettingsStore((s) => s.settings.speech);
  const update = useSettingsStore((s) => s.update);
  const speech: SpeechPreferences = stored ?? DEFAULT_SPEECH;

  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [canSpeak, setCanSpeak] = useState<boolean | undefined>(undefined);
  /** What a Check found, for the language it was checked in. */
  const [checked, setChecked] = useState<{ lang: string; cap: SpeechCapability }>();
  const cap = checked?.lang === speech.sttLanguage ? checked.cap : undefined;

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

  // Recognition is checked only when asked: some browsers misbehave when probed on page load.
  const [checking, setChecking] = useState(false);
  const checkRecognition = () => {
    const lang = speech.sttLanguage;
    setChecking(true);
    getSpeechCapability(lang)
      .catch((): SpeechCapability => ({ supported: false, onDevice: 'unavailable', locale: lang }))
      .then((c) => setChecked({ lang, cap: c }))
      .finally(() => setChecking(false));
  };

  const save = (patch: Partial<SpeechPreferences>) => {
    const next: SpeechPreferences = { ...speech, ...patch };
    if (next.voiceId === undefined) delete next.voiceId;
    update({ speech: next }).catch(() => toast.show({ message: t('settings.saveError'), tone: 'danger' }));
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
      toast.show({ message: t('settings.speech.cannotSpeak'), tone: 'danger' });
      return;
    }
    const sample = findSpeechLanguage(speech.ttsLanguage)?.sample ?? t('settings.speech.sample');
    getSpeaker().say({
      text: sample, language: speech.ttsLanguage, voiceId: speech.voiceId, rate: speech.rate, priority: 'critical', interrupt: true,
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text variant="h3" level={2}>{t('settings.speech.title')}</Text>
        <LedgerRule width={56} />
        <Text tone="secondary" style={{ marginTop: 8 }}>{t('settings.speech.intro')}</Text>
      </View>
      <Surface padded={20} style={{ gap: 24 }}>
        <Block title={t('settings.speech.listening')} description={recognitionNote(cap)}>
          <LanguageChips value={speech.sttLanguage} label={t('settings.speech.listening')} onChange={(tag) => save({ sttLanguage: tag })} />
          {cap ? null : (
            <View style={{ flexDirection: 'row' }}>
              <Button label={t('settings.speech.check')} icon={ScanSearch} variant="outline" size="sm" loading={checking} onPress={checkRecognition} />
            </View>
          )}
        </Block>

        <Block title={t('settings.speech.speaking')} description={voiceNote(voices, speech, canSpeak)}>
          <LanguageChips value={speech.ttsLanguage} label={t('settings.speech.speaking')} onChange={setSpeakingLanguage} />
          {voiceChoices.length > 0 ? (
            <View role="radiogroup" aria-label={t('settings.speech.voice')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip role="radio" label={t('settings.speech.automatic')} selected={speech.voiceId === undefined} onPress={() => save({ voiceId: undefined })} />
              {voiceChoices.map((v) => (
                <Chip
                  key={v.id}
                  role="radio"
                  label={v.name}
                  accessibilityLabel={v.local ? v.name : t('settings.speech.needsInternet', { name: v.name })}
                  selected={speech.voiceId === v.id}
                  onPress={() => save({ voiceId: v.id })}
                />
              ))}
            </View>
          ) : null}
        </Block>

        <Block title={t('settings.speech.speed')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconButton
              icon={Minus} label={t('settings.speech.slower')} variant="outline" disabled={speech.rate <= 0.5}
              onPress={() => save({ rate: stepRate(speech.rate, -1) })}
            />
            <Text variant="h4" level={0} numeric accessibilityLiveRegion="polite" style={{ minWidth: 64, textAlign: 'center' }}>
              {formatRate(speech.rate)}
            </Text>
            <IconButton
              icon={Plus} label={t('settings.speech.faster')} variant="outline" disabled={speech.rate >= 2}
              onPress={() => save({ rate: stepRate(speech.rate, 1) })}
            />
            <Button label={t('settings.speech.test')} icon={Volume2} variant="secondary" onPress={testVoice} />
          </View>
        </Block>

        <SwitchRow
          label={t('settings.speech.keep')}
          description={t('settings.speech.keepHint')}
          value={speech.keepRecordings}
          onValueChange={(v) => save({ keepRecordings: v })}
        />
        <Text variant="bodySmall" tone="muted">{t('settings.speech.savedHere')}</Text>
      </Surface>
    </View>
  );
}
