import { router } from 'expo-router';
import { Accessibility, Info, PenLine } from 'lucide-react-native';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { routes } from '@/components/shell/routes';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { Button, Chip, Logo, Sheet, Text, useBreakpoint, useKalamTheme, useToast, webData } from '@/design';
import { AccountButton } from '@/features/auth/AccountButton';
import { AccessModeSwitches } from '@/features/settings/AccessModeSwitches';
import { onboardingPatch } from '@/i18n/language-prefs';
import { LANGUAGES, type LanguageCode } from '@/i18n/languages';
import { useI18n, useT } from '@/i18n/react';
import type { Script } from '@/i18n/scripts';
import { loadScriptFonts } from '@/i18n/use-script-fonts';
import { useSettingsStore } from '@/state/settings-store';

import { HeroStage } from './HeroStage';
import { Close, CreatePreview, HowItWorks, ShelfExamples } from './LandingSections';
import { OnboardingExplainers } from './OnboardingExplainers';

/** Owner, 2026-11-25: below 1280 px the hero stacks (words, then the stage). */
const SIDE_BY_SIDE = 1280;
/** From here up to SIDE_BY_SIDE the stacked words sit in two columns. */
const TWO_COLUMNS = 700;

/** Hero size per script (DIRECTION §3): Indic display gets a smaller size and more line height. */
function heroSize(script: Script, phone: boolean): number {
  if (script === 'latin') return phone ? 43 : 66;
  if (script === 'devanagari' || script === 'bengali' || script === 'gurmukhi' || script === 'gujarati') return phone ? 38 : 58;
  return phone ? 31 : 50;
}

/**
 * The landing page and first-run welcome in one ("Khata and Kalam", DIRECTION §4 and §6): the headline, the
 * language choice (which re-sets the page in that script at once), the optional accessibility step, the story
 * on the ink field, then how it works, the shelf, making an app, and a plain footer. "Make your first app"
 * saves the language for Kalam, new apps and speech and opens Create. Sign in is in the header; the sign-in gate (features/auth) asks for it before Create opens.
 */
export function OnboardingScreen() {
  const theme = useKalamTheme();
  // The UI language as the theme sees it, like every other screen (useT re-renders when its catalogue loads).
  const language = theme.uiLanguage as LanguageCode;
  const t = useT(language);
  const isDraft = useI18n(language).isDraft;
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width, height, isPhone } = useBreakpoint();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const anchors = useRef({ main: 0, how: 0, shelf: 0 });
  const wide = width >= SIDE_BY_SIDE;
  // Stacked on a tablet, the words take two columns so the first screen has no empty half (owner override 3).
  const twoUp = !wide && width >= TWO_COLUMNS;

  // The hero, the slips and the shelf show Hindi example data: load its face once.
  useEffect(() => { void loadScriptFonts(['devanagari']).catch(() => undefined); }, []);

  const setModes = (patch: Parameters<typeof update>[0]) => {
    update(patch).catch(() => toast.show({ message: t('landing.access.saveError'), tone: 'danger' }));
  };
  // Choosing a language re-sets the whole page in it straight away (DIRECTION §4).
  const choose = (code: LanguageCode) => {
    if (code === language) return;
    update({ language: code }).catch(() => toast.show({ message: t('onboarding.saveError'), tone: 'danger' }));
  };
  const finish = async () => {
    setBusy(true);
    try {
      // One answer sets Kalam's screens, new apps, listening and read-aloud; Settings can split them later.
      await update({ onboarded: true, ...onboardingPatch(language, settings) });
      router.replace(routes.create);
    } catch {
      toast.show({ message: t('onboarding.saveError'), tone: 'danger' });
      setBusy(false);
    }
  };
  const scrollTo = (key: 'how' | 'shelf') => scroller.current?.scrollTo({ y: anchors.current.main + anchors.current[key], animated: !theme.reducedMotion });

  // Large mode grows the headline less than body text: it is already the biggest thing on the page.
  const narrow = isPhone || (twoUp && width < 960);
  const size = heroSize(theme.script, narrow) * Math.min(theme.fontScale, 1.25);
  const indic = theme.script !== 'latin';
  const headline = { fontSize: size, lineHeight: Math.round(size * (indic ? 1.2 : 1.03)), letterSpacing: size * (indic ? -0.005 : -0.022) };

  const header = (
    <View
      role="banner"
      style={{
        paddingTop: insets.top + (isPhone ? 8 : 14), paddingBottom: isPhone ? 8 : 10, paddingHorizontal: isPhone ? 12 : 32,
        flexDirection: 'row', alignItems: 'center', gap: isPhone ? 4 : 20, width: '100%',
      }}
    >
      <View style={{ paddingStart: isPhone ? 4 : 0 }}><Logo size={isPhone ? 30 : 36} compact={isPhone} /></View>
      {isPhone ? null : (
        <View role="navigation" aria-label={t('landing.nav.label')} style={{ flexDirection: 'row', gap: 4, marginStart: 12 }}>
          {(['how', 'shelf'] as const).map((key) => (
            <Pressable
              key={key}
              role="link"
              onPress={() => scrollTo(key)}
              {...webData({ kPress: '', kHover: 'link' })}
              style={{ minHeight: theme.touchTarget, paddingHorizontal: 10, justifyContent: 'center', borderRadius: theme.radius.press }}
            >
              <Text weight="medium" tone="secondary">{t(key === 'how' ? 'landing.nav.how' : 'landing.nav.shelf')}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flex: 1 }} />
      <ThemeToggle />
      <AccountButton />
    </View>
  );

  // The headline, the lede and the actions; then the language and accessibility choices. One reading order.
  const intro = (
    <View style={{ gap: isPhone ? 22 : 28 }}>
      <View style={{ gap: isPhone ? 14 : 18 }}>
        <Text variant="hero" level={1} {...({ lang: language } as object)} style={headline}>
          {t('landing.hero.line1')}
          {'\n'}
          <Text variant="hero" level={0} tone="secondary" style={headline}>{t('landing.hero.line2')}</Text>
        </Text>
        <Text variant="bodyLarge" tone="secondary" style={{ maxWidth: 540 }}>{t('landing.hero.lede')}</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {/* One row in a narrow column, as in the comp: the main action takes the room the other leaves. */}
        <Button label={t('landing.hero.make')} icon={PenLine} size={narrow ? 'md' : 'lg'} onPress={finish} loading={busy} style={narrow ? { flexGrow: 1 } : undefined} testID="onboarding-continue" />
        <Button label={t('landing.nav.how')} variant="outline" size={narrow ? 'md' : 'lg'} onPress={() => scrollTo('how')} />
      </View>
    </View>
  );
  const choices = (
    <View style={{ gap: isPhone ? 22 : 28 }}>
      <View style={{ gap: 10 }}>
        <Text variant="bodySmall" weight="semibold" tone="secondary" nativeID="onb-lang">{t('onboarding.language')}</Text>
        {/* Every language stays in view (wrapped, never scrolled away): the choice is the point of this step. */}
        <View role="radiogroup" aria-labelledby="onb-lang" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LANGUAGES.map((l) => (
              <Chip
                key={l.code}
                role="radio"
                label={l.native}
                lang={l.code}
                accessibilityLabel={l.code === 'en' ? 'English' : `${l.native}, ${l.english}`}
                selected={language === l.code}
                onPress={() => choose(l.code)}
              />
            ))}
        </View>
        <Text variant="bodySmall" tone="muted">{t('onboarding.languageHint')}</Text>
        {isDraft ? (
          <View role="note" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: theme.radius.paper, backgroundColor: c.accentSoft, maxWidth: 540 }}>
            <Info size={18} color={c.accentInk} strokeWidth={2.2} />
            <Text variant="bodySmall" style={{ flex: 1 }}>{t('landing.draftNote')}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ alignItems: 'flex-start', gap: 6 }}>
        {/* Optional accessibility step (docs/03 §4.2): never required, applies at once. */}
        <Button label={t('landing.access.open')} icon={Accessibility} variant="ghost" onPress={() => setAccessOpen(true)} style={{ marginStart: -12 }} />
        <Text variant="bodySmall" tone="muted">{t('onboarding.local')}</Text>
      </View>
      <OnboardingExplainers />
      <Sheet
        visible={accessOpen}
        onClose={() => setAccessOpen(false)}
        title={t('landing.access.open')}
        description={t('landing.access.body')}
        footer={<Button label={t('common.done')} onPress={() => setAccessOpen(false)} fullWidth={isPhone} />}
      >
        <AccessModeSwitches modes={settings.accessModes} set={setModes} />
      </Sheet>
    </View>
  );
  const copy = twoUp ? (
    <View style={{ flexDirection: 'row', gap: 48, alignItems: 'flex-start' }}>
      <View style={{ flex: 1.15, minWidth: 0 }}>{intro}</View>
      <View style={{ flex: 1, minWidth: 0, paddingTop: 12 }}>{choices}</View>
    </View>
  ) : (
    <View style={{ gap: isPhone ? 22 : 28, maxWidth: 600 }}>{intro}{choices}</View>
  );

  const heroHeight = Math.max(height - 72, 780);
  return (
    <ScrollView ref={scroller} style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ paddingBottom: insets.bottom }}>
      {header}
      <View role="main" onLayout={(e) => { anchors.current.main = e.nativeEvent.layout.y; }}>
        {wide ? (
          <View style={{ flexDirection: 'row', minHeight: heroHeight }}>
            <View style={{ width: Math.min(640, Math.max(520, width * 0.42)), paddingStart: 32, paddingEnd: 32, paddingVertical: 48, justifyContent: 'center' }}>{copy}</View>
            <View style={{ flex: 1 }}><HeroStage wide /></View>
          </View>
        ) : (
          <View>
            <View style={{ paddingHorizontal: isPhone ? 16 : 32, paddingTop: isPhone ? 20 : 40, paddingBottom: isPhone ? 36 : 48 }}>{copy}</View>
            <View style={{ height: isPhone ? 560 : 740 }}><HeroStage wide={false} /></View>
          </View>
        )}
        <HowItWorks onLayout={(y) => { anchors.current.how = y; }} />
        <ShelfExamples onLayout={(y) => { anchors.current.shelf = y; }} />
        <CreatePreview onMake={finish} busy={busy} />
        <Close onMake={finish} busy={busy} />
      </View>
    </ScrollView>
  );
}
