import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Download, FileText, FlaskConical, Moon, Sun, SunMoon } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { useInstallPrompt } from '@/components/pwa/install-prompt';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import type { KalamSettings } from '@/core/contracts';
import { Button, Chip, LedgerRule, Logo, Screen, SegmentedControl, setTextScale, Text, TEXT_SCALES, useKalamTheme, useTextScale, useToast } from '@/design';
import { AccountSyncSettings } from '@/features/account';
import { DiagnosticsPanel } from '@/features/diagnostics';
import { EvidencePanel, RecoveryLogPanel } from '@/features/recovery';
import { BackupPanel } from '@/features/storage/BackupPanel';
import { StorageManagerPanel } from '@/features/storage/StorageManagerPanel';
import { WIDGET_UI, WidgetSettingsButton } from '@/features/widgets';
import { loadCatalogue } from '@/i18n/catalogue';
import { languageOptions, languagePatch, resolveLanguages } from '@/i18n/language-prefs';
import { DraftLanguageNote } from '@/i18n/LanguageSettings';
import { useT } from '@/i18n/react';
import { useSettingsStore } from '@/state/settings-store';

import { AccessModeSwitches } from './AccessModeSwitches';
import { AISection } from './AISection';
import { OssNoticesSheet } from './OssNoticesSheet';
import { Divider, Section } from './Section';
import { SpeechSettingsPanel } from './speech';
import { StorageSection } from './StorageSection';

/**
 * Settings (DIRECTION §6): plain and quiet, grouped sections on sheets with Tiro titles. Access modes come
 * first, not buried; then appearance, language, AI and privacy, voice, storage, diagnostics and about.
 */
export function SettingsScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useToast();
  const set = (patch: Partial<KalamSettings>) => {
    update(patch).catch(() => toast.show({ message: t('settings.saveError'), tone: 'danger' }));
  };
  const install = useInstallPrompt();
  const [noticesOpen, setNoticesOpen] = useState(false);

  return (
    <AppShell active="settings">
      <Screen maxWidth={900}>
        <View style={{ gap: 6, marginBottom: 36 }}>
          <Text variant="h1">{t('settings.title')}</Text>
          <LedgerRule />
          <Text tone="secondary" style={{ marginTop: 10 }}>{t('settings.subtitle')}</Text>
        </View>
        <View style={{ gap: 44 }}>
          <Section title={t('settings.access.title')} description={t('settings.access.description')} testID="settings-access">
            <AccessModeSwitches modes={settings.accessModes} set={set} />
          </Section>

          <Section title={t('settings.appearance.title')}>
            <View style={{ gap: 20, paddingVertical: 8 }}>
              <SegmentedControl
                label={t('settings.appearance.theme')}
                value={settings.colorScheme}
                onChange={(v) => set({ colorScheme: v })}
                wrap
                options={[
                  { value: 'system', label: t('settings.appearance.system'), icon: SunMoon },
                  { value: 'light', label: t('settings.appearance.paper'), icon: Sun },
                  { value: 'dark', label: t('settings.appearance.ink'), icon: Moon },
                ]}
              />
              <SegmentedControl
                label={t('settings.appearance.motion')}
                value={settings.reducedMotion}
                onChange={(v) => set({ reducedMotion: v })}
                wrap
                options={[
                  { value: 'system', label: t('settings.appearance.system') },
                  { value: 'on', label: t('settings.appearance.reduce') },
                  { value: 'off', label: t('settings.appearance.full') },
                ]}
              />
              <TextSizeControl />
              <Text variant="bodySmall" tone="muted">{t('settings.appearance.deviceWins')}</Text>
            </View>
          </Section>

          {/* docs/10 §11.2: separate choices. Listening and read-aloud languages are in "Voice and speech". */}
          <Section title={t('settings.language.title')} description={t('settings.language.description')}>
            <LanguageRows settings={settings} set={set} />
          </Section>

          <AISection settings={settings} set={set} />

          {/* The speech panel brings its own heading and card. */}
          <SpeechSettingsPanel />

          <BackupPanel />
          <StorageManagerPanel />
          {/* M1: usage counts and timings, off until the person turns them on. Draws its own heading. */}
          <DiagnosticsPanel />
          {/* U11: what failed and how to retry (this session only), and the evidence file for judges and owners. */}
          <RecoveryLogPanel />
          <EvidencePanel />
          <Section title={t('accountSync.settings.title')} description={t('accountSync.settings.description')} testID="settings-account-sync">
            <AccountSyncSettings />
          </Section>
          <StorageSection />
          <Section title={WIDGET_UI.settings.title} description={WIDGET_UI.settings.intro} testID="settings-widgets">
            <View style={{ paddingVertical: 8, alignItems: 'flex-start' }}>
              <WidgetSettingsButton />
            </View>
          </Section>

          <Section title={t('settings.about')}>
            <View style={{ gap: 12, paddingVertical: 8 }}>
              <Logo size={34} />
              <Text tone="secondary">{t('app.tagline')}</Text>
              {install.available ? (
                <View style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Button label={t('settings.install')} icon={Download} variant="secondary" onPress={() => void install.prompt()} />
                  <Text variant="bodySmall" tone="muted">{t('settings.installHint')}</Text>
                </View>
              ) : null}
              <View style={{ alignItems: 'flex-start' }}>
                <Button label={t('settings.notices.button')} icon={FileText} variant="secondary" onPress={() => setNoticesOpen(true)} testID="settings-notices" />
              </View>
              <Divider />
              <Text variant="bodySmall" tone="muted">
                {t(Platform.OS === 'ios' ? 'settings.versionIos' : 'settings.version', { version: Constants.expoConfig?.version ?? '?' })}
              </Text>
              {/* Developer builds only (docs/13 §9.4): run golden cases through the real pipeline. */}
              {__DEV__ ? (
                <View style={{ alignItems: 'flex-start' }}>
                  <Button label={t('settings.lab')} icon={FlaskConical} variant="ghost" size="sm" onPress={() => router.push(routes.lab)} />
                </View>
              ) : null}
            </View>
          </Section>
        </View>
      </Screen>
      <OssNoticesSheet visible={noticesOpen} onClose={() => setNoticesOpen(false)} />
    </AppShell>
  );
}

/**
 * Kalam's own language and the language for new apps, with N9's helpers, and the draft note for a
 * machine-translated language (in that language and in English).
 * ponytail: a trimmed copy of i18n/LanguageSettings, whose listening and read-aloud rows would duplicate
 * the speech panel (and keep a voice picked for another language). Mount it directly once it takes `roles`.
 */
function LanguageRows({ settings, set }: { settings: KalamSettings; set: (patch: Partial<KalamSettings>) => void }) {
  const t = useT(useKalamTheme().uiLanguage);
  const current = resolveLanguages(settings);
  const choose = (role: 'studio' | 'newApp', value: string) => {
    const patch = languagePatch(role, value, settings);
    // Load the new screens' strings first so the switch does not flash English.
    (role === 'studio' ? loadCatalogue(value) : Promise.resolve(undefined)).finally(() => set(patch));
  };
  return (
    <View style={{ gap: 20, paddingVertical: 8 }}>
      {(['studio', 'newApp'] as const).map((role) => {
        const label = t(role === 'studio' ? 'settings.language.studio' : 'settings.language.newApp');
        return (
          <View key={role} style={{ gap: 10 }}>
            <Text variant="bodySmall" weight="semibold" tone="secondary">{label}</Text>
            <View role="radiogroup" aria-label={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {languageOptions(role).map((o) => (
                <Chip
                  key={o.value}
                  role="radio"
                  label={o.native}
                  lang={o.lang}
                  accessibilityLabel={o.lang === 'en' ? o.english : `${o.native}, ${o.english}`}
                  selected={current[role] === o.value}
                  onPress={() => choose(role, o.value)}
                />
              ))}
            </View>
          </View>
        );
      })}
      <DraftLanguageNote language={current.studio} />
    </View>
  );
}

const STEP_LABEL = { 0.9: 'settings.appearance.textSmaller', 1: 'settings.appearance.textDefault', 1.15: 'settings.appearance.textLarger', 1.3: 'settings.appearance.textLargest' } as const;

/**
 * Text size (docs/10 §5.3): four steps on top of Large mode. A device preference: it changes every label in Kalam at once,
 * and the hint line under it is the live sample.
 */
function TextSizeControl() {
  const t = useT(useKalamTheme().uiLanguage);
  const toast = useToast();
  const step = useTextScale();
  return (
    <View style={{ gap: 8 }}>
      <SegmentedControl
        label={t('settings.appearance.textSize')}
        value={String(step)}
        onChange={(v) => {
          const next = TEXT_SCALES.find((s) => String(s) === v);
          if (next !== undefined) setTextScale(next).catch(() => toast.show({ message: t('settings.saveError'), tone: 'danger' }));
        }}
        wrap
        options={TEXT_SCALES.map((s) => ({ value: String(s), label: t(STEP_LABEL[s]) }))}
      />
      <Text variant="bodySmall" tone="muted">{t('settings.appearance.textSizeHint')}</Text>
    </View>
  );
}
