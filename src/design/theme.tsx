/**
 * Kalam shell theme: colour scheme, access-mode overlays (Large, High Contrast) and reduced
 * motion, resolved from user settings + OS preferences. Generated apps never use this theme
 * (docs/02 §12) — they render with their own KalamSpec tokens.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, useColorScheme, useWindowDimensions } from 'react-native';

import type { AccessModes, KalamSettings } from '@/core/contracts';
import type { Script } from '@/i18n/scripts';
import { useScriptFonts } from '@/i18n/use-script-fonts';

import { installGlobalCss } from './global-css';
import {
  breakpoints, darkColors, elevation, highContrastDarkColors, highContrastLightColors, type KalamColors,
  layout, lightColors, motion, radius, space,
} from './tokens';

export interface KalamTheme {
  scheme: 'light' | 'dark';
  colors: KalamColors;
  /** Multiplier applied to the type scale (Large access mode = 1.5, docs/10 §4.1, lead decision 4). */
  fontScale: number;
  /** Minimum interactive size (48, or 64 in Large mode — docs/10 §4.1). */
  touchTarget: number;
  reducedMotion: boolean;
  accessModes: AccessModes;
  space: typeof space;
  radius: typeof radius;
  layout: typeof layout;
  motion: typeof motion;
  elevation: typeof elevation;
  /** Loaded script of the UI language. Pass to `fontFamily()` so Indic text gets its Noto face. */
  script: Script;
  /**
   * Language the shell's strings are really shown in. Pass it to `useT()` / `useFormat()` for keyed
   * strings so a sentence is never half translated. It follows Settings once P1-5b moves the strings.
   */
  uiLanguage: string;
}

/** The subset of settings the theme depends on. */
export type ThemeSettings = Pick<KalamSettings, 'colorScheme' | 'reducedMotion' | 'accessModes' | 'language'>;

/** Language of the shell's own strings today (see ThemeProvider). */
const UI_LANGUAGE = 'en';

const NO_MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };

function buildTheme(scheme: 'light' | 'dark', modes: AccessModes, reducedMotion: boolean, script: Script = 'latin', uiLanguage = UI_LANGUAGE): KalamTheme {
  const hc = modes.highContrast;
  const colors = scheme === 'dark' ? (hc ? highContrastDarkColors : darkColors) : hc ? highContrastLightColors : lightColors;
  return {
    scheme,
    colors,
    fontScale: modes.large ? 1.5 : 1,
    touchTarget: modes.large ? 64 : layout.touchTarget,
    reducedMotion,
    accessModes: modes,
    space, radius, layout, motion, elevation,
    script,
    uiLanguage,
  };
}

const ThemeContext = createContext<KalamTheme>(buildTheme('light', NO_MODES, false));

/** OS "reduce motion" preference, kept live. */
function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

/** OS "more contrast" preference (web media query, Android high-text-contrast), kept live. */
function useOsHighContrast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
      const mq = window.matchMedia('(prefers-contrast: more), (forced-colors: active)');
      const sync = () => setOn(mq.matches);
      sync();
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    let alive = true;
    const info = AccessibilityInfo as unknown as { isHighTextContrastEnabled?: () => Promise<boolean> };
    info.isHighTextContrastEnabled?.().then((v) => alive && setOn(v)).catch(() => {});
    return () => { alive = false; };
  }, []);
  return on;
}

/**
 * Provides the Kalam shell theme.
 * @param settings  user settings (colour scheme, reduced motion, access modes, language). Optional
 *                  so the provider can render before settings hydrate.
 */
export function ThemeProvider({ settings, children }: { settings?: ThemeSettings; children: ReactNode }) {
  const system = useColorScheme();
  const osReduced = useOsReducedMotion();
  const osContrast = useOsHighContrast();
  const pref = settings?.colorScheme ?? 'system';
  const scheme: 'light' | 'dark' = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  // A Kalam setting may only make things stricter than the device asks for (docs/10 §3.3):
  // "Full motion" cannot undo the device's "reduce motion", and device high contrast always applies.
  const rm = settings?.reducedMotion ?? 'system';
  const reduced = osReduced || rm === 'on';
  const userModes = settings?.accessModes ?? NO_MODES;
  const modes = useMemo(
    () => (osContrast && !userModes.highContrast ? { ...userModes, highContrast: true } : userModes),
    [osContrast, userModes],
  );

  // <html lang> and keyed strings name the language the UI is really shown in (docs/10 §11). The
  // shell's strings are English until they move to i18n keys (GAP P1-5b), so it stays 'en' even when
  // another language is chosen for new apps and voice. Generated apps tag their own content
  // (KalamRuntime) and language names carry their own lang. When translated catalogues load, use
  // `isCatalogueLoaded(language) ? language : 'en'` from src/i18n/catalogue here.
  const uiLang = UI_LANGUAGE;
  // Script fonts for the language in Settings; Latin until they finish loading.
  const { script } = useScriptFonts();
  const theme = useMemo(() => buildTheme(scheme, modes, reduced, script, uiLang), [scheme, modes, reduced, script, uiLang]);
  useEffect(() => {
    installGlobalCss(theme, uiLang);
  }, [theme, uiLang]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Current Kalam shell theme. Read colours from here — never hardcode them. */
export function useKalamTheme(): KalamTheme {
  return useContext(ThemeContext);
}

/** True when motion should be reduced (user setting overrides the OS preference). */
export function useReducedMotion(): boolean {
  return useContext(ThemeContext).reducedMotion;
}

export interface Breakpoint {
  width: number;
  height: number;
  /** < 640 */
  isPhone: boolean;
  /** ≥ 768 — wide enough for the navigation rail. */
  hasRail: boolean;
  /** ≥ 1024 */
  isDesktop: boolean;
}

/** Layout breakpoint from the window size (docs/02 §7.3). Never use it to infer capabilities. */
export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isPhone: width < breakpoints.tablet,
    hasRail: width >= 768,
    isDesktop: width >= breakpoints.desktop,
  };
}
