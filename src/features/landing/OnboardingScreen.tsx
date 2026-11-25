import { router } from 'expo-router';
import { Accessibility, Camera, Mic, PenTool, Type, Video, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LANGUAGES } from '@/components/languages';
import { routes } from '@/components/shell/routes';
import { Button, Chip, Logo, Sheet, Text, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { AccessModeSwitches } from '@/features/settings/AccessModeSwitches';
import { onboardingPatch } from '@/i18n/language-prefs';
import { useSettingsStore } from '@/state/settings-store';

import { HeroStage } from './HeroStage';

const METHODS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Type, label: 'Type it' },
  { icon: Mic, label: 'Say it' },
  { icon: Video, label: 'Film it' },
  { icon: Camera, label: 'Snap a sketch' },
  { icon: PenTool, label: 'Draw it' },
];

/** First-run welcome (docs/03 §4): what Kalam is, five ways in, the offline promise, language, Continue. */
export function OnboardingScreen() {
  const theme = useKalamTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width, height, isDesktop, isPhone } = useBreakpoint();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useToast();
  const [language, setLanguage] = useState<string>(settings.language || 'en');
  const [busy, setBusy] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const setModes = (patch: Parameters<typeof update>[0]) => {
    update(patch).catch(() => toast.show({ message: 'Could not save that setting. Try again.', tone: 'danger' }));
  };

  const finish = async () => {
    setBusy(true);
    try {
      // One answer sets Kalam's screens, new apps, listening and read-aloud; Settings can split them later.
      await update({ onboarded: true, ...onboardingPatch(language, settings) });
      router.replace(routes.shelf);
    } catch {
      toast.show({ message: 'Could not save your choice. Try again.', tone: 'danger' });
      setBusy(false);
    }
  };

  const heroH = isDesktop ? Math.min(Math.max(height - 64, 560), 820) : Math.min(width * 1.12, 470);

  const content = (
    <View style={{ gap: isPhone ? 24 : 26, maxWidth: 640 }}>
      <View style={{ gap: 16 }}>
        <Text variant={isPhone ? 'display' : 'hero'} style={isDesktop ? { fontSize: 56 * theme.fontScale, lineHeight: 62 * theme.fontScale } : undefined}>
          {isDesktop ? 'Draw the app\nyou need.\nOwn it forever.' : 'Draw the app you need. Own it forever.'}
        </Text>
        <Text variant="bodyLarge" tone="secondary" style={{ maxWidth: 470 }}>
          Describe a tool for your shop, your family or your work. Kalam turns it into a working app that lives on
          your device. No code, no account.
        </Text>
      </View>

      <View accessibilityRole="list" accessibilityLabel="Ways to describe your app" style={{ flexDirection: 'row', gap: isPhone ? 4 : 10 }}>
        {METHODS.map(({ icon: Icon, label }) => (
          <View key={label} accessibilityRole="text" style={{ flex: 1, alignItems: 'center', gap: 8, minWidth: 0 }}>
            <View
              style={{
                width: isPhone ? 44 : 52, height: isPhone ? 44 : 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                backgroundColor: c.primarySoft,
              }}
            >
              <Icon size={isPhone ? 20 : 22} color={c.primary} strokeWidth={1.9} />
            </View>
            <Text variant="caption" weight="medium" align="center" tone="secondary" numberOfLines={2}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: 16, paddingVertical: 2 }}>
        <Text display weight="regular" style={{ fontSize: 22 * theme.fontScale, lineHeight: 30 * theme.fontScale, color: c.text }}>
          Building may need the cloud. Using your app never does.
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        <Text variant="bodySmall" weight="medium" tone="secondary" nativeID="onb-lang">Your language</Text>
        <View role="radiogroup" aria-labelledby="onb-lang" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LANGUAGES.map((l) => (
            <Chip
              key={l.code}
              role="radio"
              label={l.native}
              lang={l.code}
              accessibilityLabel={l.code === 'en' ? 'English' : `${l.native}, ${l.english}`}
              selected={language === l.code}
              onPress={() => setLanguage(l.code)}
            />
          ))}
        </View>
        <Text variant="bodySmall" tone="muted">Used for new apps, voice and read-aloud. Change it any time in Settings.</Text>
      </View>

      <View style={{ gap: 12, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 8, alignItems: isPhone ? 'stretch' : 'center' }}>
          <Button label="Continue" size="lg" onPress={finish} loading={busy} fullWidth={isPhone} testID="onboarding-continue" />
          {/* Optional accessibility step (docs/03 §4.2): never required, applies at once. */}
          <Button label="Make Kalam easier to use" icon={Accessibility} variant="ghost" onPress={() => setAccessOpen(true)} fullWidth={isPhone} />
        </View>
        <Text variant="bodySmall" tone="muted">Everything you make is saved on this device.</Text>
      </View>
      <Sheet
        visible={accessOpen}
        onClose={() => setAccessOpen(false)}
        title="Make Kalam easier to use"
        description="Turn on what helps. You see the change straight away, and you can change it later in Settings."
        footer={<Button label="Done" onPress={() => setAccessOpen(false)} fullWidth={isPhone} />}
      >
        <AccessModeSwitches modes={settings.accessModes} set={setModes} />
      </Sheet>
    </View>
  );

  if (isDesktop) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ minHeight: height }}>
        <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: 56, paddingTop: 24, paddingBottom: 24, gap: 24, maxWidth: 1440, width: '100%', alignSelf: 'center' }}>
          <View style={{ flex: 5, justifyContent: 'center', gap: 28, paddingVertical: 8, minWidth: 460 }}>
            <Logo size={36} />
            {content}
          </View>
          <View style={{ flex: 7, justifyContent: 'center' }}>
            <HeroStage height={heroH} />
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: isPhone ? 20 : 40 }}
    >
      <Logo size={30} />
      <View style={{ marginVertical: 8 }}>
        <HeroStage height={heroH} />
      </View>
      {content}
    </ScrollView>
  );
}
