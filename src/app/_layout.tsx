import { useFonts } from 'expo-font';
import { DefaultTheme, DarkTheme, type Href, ThemeProvider as NavThemeProvider, SplashScreen, Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/components/pwa/install-prompt'; // catches the one-time install offer early (web)
import { navigationType, readLastRoute, rememberRoute, routeToRestore } from '@/components/shell/route-memory';
import { fontAssets, ThemeProvider, ToastProvider, useKalamTheme, useToast } from '@/design';
import { AccountSyncPrompt } from '@/features/account';
import { diagnosticsAllowed, gateState } from '@/features/auth/gate-logic';
import { SignInChecking, SignInGate } from '@/features/auth/SignInGate';
import { useAuthUser } from '@/features/auth/use-auth';
import { CloudNoticeHost } from '@/features/cloud-consent/CloudNoticeHost';
import { useCollabSync } from '@/features/collab';
import { startDiagnostics } from '@/features/diagnostics';
import { QueueNotifier, startOperationQueue } from '@/features/queue';
import { useReminderBootstrap } from '@/features/reminders';
import { useWidgetSync } from '@/features/widgets';
import { useI18nBoot, useT } from '@/i18n/react';
import { registerServiceWorker } from '@/infrastructure/pwa/register-sw';
import { useSettingsStore } from '@/state/settings-store';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Root: fonts + settings hydration (splash held), theme, toasts, the sign-in gate, stack navigation. */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const settings = useSettingsStore((s) => s.settings);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const load = useSettingsStore((s) => s.load);
  const [loadFailed, setLoadFailed] = useState(false);
  useCollabSync();
  useReminderBootstrap();
  useWidgetSync();
  // M1: connects track() and reportError() to the counters. Counting stays off until the person turns it on.
  useEffect(() => { startDiagnostics(); }, []);

  useEffect(() => {
    load().catch((e: unknown) => {
      console.warn('[kalam] settings failed to load; using defaults', e);
      setLoadFailed(true);
    });
  }, [load]);

  // Picks up what was queued while offline (Smart Queue). It waits for settings so it reads the saved choices.
  useEffect(() => {
    if (hydrated || loadFailed) void startOperationQueue().catch(() => undefined);
  }, [hydrated, loadFailed]);

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
          <GatedStack />
          {/* Opt-in account sync: asks once after the first Google or email sign-in, then syncs in the background. */}
          <AccountSyncPrompt />
          {/* The cloud notice and the offline queue's "done" toasts: one host each, for the whole app. */}
          <CloudNoticeHost />
          <QueueNotifier />
          {Platform.OS === 'web' ? <ServiceWorkerUpdates /> : null}
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Sign-in is required (owner, 2026-11-25): once the welcome page is done, nothing opens until a Google or email
 * account is signed in. The saved session makes this a one-time step, and apps then open offline. The stack stays
 * mounted (hidden) behind the gate, so the address and the screen the person asked for are still there once they
 * sign in; `display: none` also keeps it out of the tab order and the screen-reader tree.
 */
function GatedStack() {
  const onboarded = useSettingsStore((s) => s.settings.onboarded);
  const { user, restoring, configured } = useAuthUser();
  const pathname = usePathname();
  const router = useRouter();
  const state = gateState({
    configured, restoring, user, onboarded, pathname,
    diagnosticsAllowed: diagnosticsAllowed(__DEV__, process.env.EXPO_PUBLIC_DIAGNOSTICS),
  });
  // Route restore (docs/03 §3.2): once the gate is open, a reload of the page returns to the screen the person was on.
  // The first look at the saved route comes before anything is remembered, so opening on the shelf cannot erase it.
  const [routeChecked, setRouteChecked] = useState(false);
  useEffect(() => {
    if (state !== 'open' || routeChecked) return;
    const target = routeToRestore({ pathname, saved: readLastRoute(), navType: navigationType() });
    if (target) router.replace(target as Href);
    setRouteChecked(true);
  }, [state, routeChecked, pathname, router]);
  useEffect(() => {
    if (state === 'open' && routeChecked) rememberRoute(pathname);
  }, [state, routeChecked, pathname]);
  return (
    <>
      <View style={{ flex: 1, display: state === 'open' ? 'flex' : 'none' }}>
        <RootStack />
      </View>
      {state === 'signIn' ? <SignInGate /> : state === 'checking' ? <SignInChecking /> : null}
    </>
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
  const t = useT(useKalamTheme().uiLanguage);
  // A ref: registering is not idempotent, so a new translator must not register again.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    registerServiceWorker({
      onUpdateAvailable: (apply) => {
        const tr = tRef.current;
        toast.show({
          message: tr('shell.updateReady'),
          tone: 'info',
          duration: 20000,
          action: { label: tr('common.update'), onPress: apply },
        });
      },
    });
  }, [toast]);
  return null;
}
