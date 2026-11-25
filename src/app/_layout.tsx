import { useFonts } from 'expo-font';
import { DefaultTheme, DarkTheme, ThemeProvider as NavThemeProvider, SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/components/pwa/install-prompt'; // catches the one-time install offer early (web)
import { fontAssets, ThemeProvider, ToastProvider, useKalamTheme, useToast } from '@/design';
import { useReminderBootstrap } from '@/features/reminders';
import { useI18nBoot } from '@/i18n/react';
import { registerServiceWorker } from '@/infrastructure/pwa/register-sw';
import { useSettingsStore } from '@/state/settings-store';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Root: fonts + settings hydration (splash held), theme, toasts, stack navigation. */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const settings = useSettingsStore((s) => s.settings);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const load = useSettingsStore((s) => s.load);
  const [loadFailed, setLoadFailed] = useState(false);
  useReminderBootstrap();

  useEffect(() => {
    load().catch((e: unknown) => {
      console.warn('[kalam] settings failed to load; using defaults', e);
      setLoadFailed(true);
    });
  }, [load]);

  // Holds the splash until the language's strings and script fonts are in, once; a later switch never blanks the app.
  const i18n = useI18nBoot(hydrated || loadFailed);
  const ready = (fontsLoaded || !!fontError) && (hydrated || loadFailed) && i18n.ready;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider settings={settings}>
        <ToastProvider>
          <RootStack />
          {Platform.OS === 'web' ? <ServiceWorkerUpdates /> : null}
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const theme = useKalamTheme();
  const nav = useMemo(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, background: theme.colors.background, card: theme.colors.surface, text: theme.colors.text, border: theme.colors.border, primary: theme.colors.primary },
    };
  }, [theme]);
  // iOS keeps its native push so the edge back-swipe works; Android slides; web fades.
  const animation = theme.reducedMotion ? 'none' : Platform.OS === 'web' ? 'fade' : Platform.OS === 'ios' ? 'default' : 'slide_from_right';
  return (
    <NavThemeProvider value={nav}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="index" options={{ animation: theme.reducedMotion ? 'none' : 'fade' }} />
        <Stack.Screen name="onboarding" options={{ animation: theme.reducedMotion ? 'none' : 'fade' }} />
      </Stack>
    </NavThemeProvider>
  );
}

/** Production web: register the service worker; offer updates without auto-reloading (docs/04 §14.4). */
function ServiceWorkerUpdates() {
  const toast = useToast();
  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (apply) =>
        toast.show({ message: 'A new version of Kalam is ready. Updating reloads the page. Your apps and typed description are kept.', tone: 'info', duration: 20000, action: { label: 'Update', onPress: apply } }),
    });
  }, [toast]);
  return null;
}
