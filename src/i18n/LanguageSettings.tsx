/**
 * The language controls for Settings (docs/10 §11.2): Kalam screens, new apps, speech recognition and
 * read-aloud, each its own choice. An existing app keeps its own language and is not touched here.
 *
 * Mount inside the Settings "Language" section:
 *   <Section title={t('settings.language.title')} description={t('settings.language.description')}>
 *     <LanguageSettings />
 *   </Section>
 */
import { View } from 'react-native';

import { Chip, Text, useToast } from '@/design';
import { useSettingsStore } from '@/state/settings-store';

import { loadCatalogue } from './catalogue';
import type { TranslationKey } from './keys';
import { languageOptions, languagePatch, resolveLanguages, type LanguageRole } from './language-prefs';
import { useI18n } from './react';

const ROLES: ReadonlyArray<{ role: LanguageRole; label: TranslationKey }> = [
  { role: 'studio', label: 'settings.language.studio' },
  { role: 'newApp', label: 'settings.language.newApp' },
  { role: 'stt', label: 'settings.language.speech' },
  { role: 'tts', label: 'settings.language.voice' },
];

export function LanguageSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const { t, isDraft } = useI18n();
  const toast = useToast();
  const current = resolveLanguages(settings);

  const choose = (role: LanguageRole, value: string) => {
    const patch = languagePatch(role, value, settings);
    // Load the new screens' strings first so the switch does not flash English.
    const ready = role === 'studio' ? loadCatalogue(value) : Promise.resolve();
    ready
      .then(() => update(patch))
      .catch(() => toast.show({ message: t('settings.saveError'), tone: 'danger' }));
  };

  return (
    <View style={{ gap: 20, paddingVertical: 8 }}>
      {ROLES.map(({ role, label }) => (
        <View key={role} style={{ gap: 8 }}>
          <Text variant="bodySmall" weight="medium" tone="secondary">{t(label)}</Text>
          <View role="radiogroup" aria-label={t(label)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {languageOptions(role).map((option) => (
              <Chip
                key={option.value}
                role="radio"
                label={option.native}
                lang={option.lang}
                accessibilityLabel={option.lang === 'en' ? option.english : `${option.native}, ${option.english}`}
                selected={current[role].toLowerCase() === option.value.toLowerCase()}
                onPress={() => choose(role, option.value)}
              />
            ))}
          </View>
        </View>
      ))}
      {isDraft ? <DraftLanguageNote /> : null}
    </View>
  );
}

/**
 * The note under a machine-translated language (MOUNTS "i18n review"): said in that language and in English,
 * so a person who cannot read the draft still learns why it may read oddly. Nothing when the language is reviewed.
 */
export function DraftLanguageNote({ language }: { language?: string }) {
  const own = useI18n(language);
  const english = useI18n('en');
  if (!own.isDraft) return null;
  const same = own.language === english.language;
  return (
    <View role="note" style={{ gap: 2 }}>
      <Text variant="bodySmall" tone="muted" {...({ lang: own.language } as object)}>{own.t('settings.language.draft')}</Text>
      {same ? null : <Text variant="bodySmall" tone="muted" {...({ lang: 'en' } as object)}>{english.t('settings.language.draft')}</Text>}
    </View>
  );
}
