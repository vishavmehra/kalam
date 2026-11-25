import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Download, FlaskConical, Moon, Sun, SunMoon } from 'lucide-react-native';
import { View } from 'react-native';

import { useInstallPrompt } from '@/components/pwa/install-prompt';
import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import type { KalamSettings } from '@/core/contracts';
import { Button, Logo, Screen, SegmentedControl, Text, useToast } from '@/design';
import { BackupPanel } from '@/features/storage/BackupPanel';
import { StorageManagerPanel } from '@/features/storage/StorageManagerPanel';
import { LanguageSettings } from '@/i18n/LanguageSettings';
import { useSettingsStore } from '@/state/settings-store';

import { AccessModeSwitches } from './AccessModeSwitches';
import { AISection } from './AISection';
import { Divider, Section } from './Section';
import { SpeechSettingsPanel } from './speech';
import { StorageSection } from './StorageSection';

/** Settings (docs/02 §11.8): AI & privacy, on-device AI, access modes, appearance, language, storage, about. */
export function SettingsScreen() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useToast();
  const set = (patch: Partial<KalamSettings>) => {
    update(patch).catch(() => toast.show({ message: 'Could not save that setting. It was changed back.', tone: 'danger' }));
  };
  const install = useInstallPrompt();

  return (
    <AppShell active="settings">
      <Screen maxWidth={900}>
        <View style={{ gap: 6, marginBottom: 32 }}>
          <Text variant="h1">Settings</Text>
          <Text tone="secondary">Saved on this device. Changes apply straight away.</Text>
        </View>
        <View style={{ gap: 40 }}>
          <AISection settings={settings} set={set} />

          <Section title="Access modes" description="Applied to Kalam and every app you make. Turn on any mix, and turn them off at any time.">
            <AccessModeSwitches modes={settings.accessModes} set={set} />
          </Section>

          {/* The speech panel brings its own heading and card. */}
          <SpeechSettingsPanel />

          <Section title="Appearance">
            <View style={{ gap: 20, paddingVertical: 8 }}>
              <SegmentedControl
                label="Theme"
                value={settings.colorScheme}
                onChange={(v) => set({ colorScheme: v })}
                options={[
                  { value: 'system', label: 'Match device', icon: SunMoon },
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                ]}
              />
              <SegmentedControl
                label="Motion"
                value={settings.reducedMotion}
                onChange={(v) => set({ reducedMotion: v })}
                options={[
                  { value: 'system', label: 'Match device' },
                  { value: 'on', label: 'Reduce motion' },
                  { value: 'off', label: 'Full motion' },
                ]}
              />
              <Text variant="bodySmall" tone="muted">
                If your device asks for less motion or more contrast, Kalam always follows it.
              </Text>
            </View>
          </Section>

          {/* Separate choices for Kalam's screens, new apps, listening and read-aloud (docs/10 §11.2). */}
          <Section title="Language" description="Apps you already made keep their own language.">
            <LanguageSettings />
          </Section>

          <BackupPanel />
          <StorageManagerPanel />
          <StorageSection />

          <Section title="About">
            <View style={{ gap: 12, paddingVertical: 8 }}>
              <Logo size={32} />
              <Text tone="secondary">Draw the app you need. Own it forever.</Text>
              {install.available ? (
                <View style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Button label="Install Kalam on this device" icon={Download} variant="secondary" onPress={() => void install.prompt()} />
                  <Text variant="bodySmall" tone="muted">Opens from your home screen or desktop and works without internet.</Text>
                </View>
              ) : null}
              <Divider />
              <Text variant="bodySmall" tone="muted">
                Version {Constants.expoConfig?.version ?? 'unknown'}. Built for #BuildHybridAI 2026 with Firebase AI Logic: Gemini Nano on
                device, Gemini in the cloud, and plain app logic first.
              </Text>
              {/* Developer builds only (docs/13 §9.4): run golden cases through the real pipeline. */}
              {__DEV__ ? (
                <View style={{ alignItems: 'flex-start' }}>
                  <Button label="Evaluation lab" icon={FlaskConical} variant="ghost" size="sm" onPress={() => router.push(routes.lab)} />
                </View>
              ) : null}
            </View>
          </Section>
        </View>
      </Screen>
    </AppShell>
  );
}
