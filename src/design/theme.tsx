/**
 * Kalam shell theme: Paper or Ink night, access-mode overlays (Large, High Contrast), reduced motion and the
 * UI language's script, resolved from user settings and OS preferences. Generated apps never use this theme:
 * they render with their own KalamSpec tokens.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, useColorScheme, useWindowDimensions } from 'react-native';

import type { AccessModes, KalamSettings } from '@/core/contracts';
import { isCatalogueLoaded } from '@/i18n/catalogue';
import { htmlLang } from '@/i18n/languages';
import { useSyncCatalogues } from '@/i18n/react';
import type { Script } from '@/i18n/scripts';
import { useShellFonts } from '@/i18n/use-script-fonts';

import { installGlobalCss } from './global-css';
import { effectiveFontScale, loadTextScale, useTextScale } from './text-scale';
import {
  breakpoints, darkColors, darkTints, elevation, highContrastDarkColors, highContrastLightColors, type KalamColors,
  layout, lightColors, lightTints, motion, radius, space, stampColors, type StampColors, type TintColors,
} from './tokens';

export interface KalamTheme {
  /** `light` is Paper, `dark` is Ink night. */
  scheme: 'light' | 'dark';
  colors: KalamColors;
  /** Stamp ink and wash per kind (Template, On device, Cloud, Checked, Needs check, plain). */
  stamps: StampColors;
  /** Order-book slip tints. */
  tints: TintColors;
  /** Multiplier applied to the type scale: Large access mode (1.5, docs/10 §4.1) times the Settings text size. */
  fontScale: number;
  /** Minimum interactive size (48, or 64 in Large mode, docs/10 §4.1). */
  touchTarget: number;
  reducedMotion: boolean;
  accessModes: AccessModes;
  /** Narrower than 640 px: display type uses the phone scale. */
  compact: boolean;
  space: typeof space;
  radius: typeof radius;
  layout: typeof layout;
  motion: typeof motion;
  elevation: typeof elevation;
  /** Loaded script of the UI language. Pass to `fontFamily()` so Indic text gets its Anek or Tiro face. */
  script: Script;
  /**
   * Language the shell's strings are really shown in: the Settings language once its catalogue has loaded,
   * English until then. Pass it to `useT()` / `useFormat()` so a sentence is never half translated.
   */
  uiLanguage: string;
}

/** The subset of settings the theme depends on. */
export type ThemeSettings = Pick<KalamSettings, 'colorScheme' | 'reducedMotion' | 'accessModes' | 'language'>;

const NO_MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };

function buildTheme(
  scheme: 'light' | 'dark', modes: AccessModes, reducedMotion: boolean, compact: boolean, script: Script = 'latin', uiLanguage = 'en', textScale = 1,
): KalamTheme {
  const hc = modes.highContrast;
  const colors = scheme === 'dark' ? (hc ? highContrastDarkColors : darkColors) : hc ? highContrastLightColors : lightColors;
  return {
    scheme,
    colors,
    stamps: stampColors(colors),
    tints: scheme === 'dark' ? darkTints : lightTints,
    fontScale: effectiveFontScale(modes.large, textScale),
    touchTarget: modes.large ? 64 : layout.touchTarget,
    reducedMotion,
    accessModes: modes,
    compact,
    space, radius, layout, motion, elevation,
    script,
    uiLanguage,
  };
}

const ThemeContext = createContext<KalamTheme>(buildTheme('light', NO_MODES, false, false));

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
export function ThemeProvider({ settings, preview, children }: { settings?: ThemeSettings; /** A sample inside a sheet: never touches the page's global CSS or the saved text size. */ preview?: boolean; children: ReactNode }) {
  const system = useColorScheme();
  const osReduced = useOsReducedMotion();
  const osContrast = useOsHighContrast();
  const compact = useWindowDimensions().width < breakpoints.tablet;
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

  // The shell's strings are keyed (P1-5b), so <html lang> and keyed strings name the Settings language once
  // its catalogue has arrived, and English until then (docs/10 §11). Generated apps tag their own content.
  useSyncCatalogues();
  const language = settings?.language ?? 'en';
  const uiLang = isCatalogueLoaded(language) ? language : 'en';
  // Anek and Tiro for the language in Settings; Latin until they finish loading.
  const { script } = useShellFonts();
  // The Settings text size lives on this device, not in the settings record; read once, then live.
  const textScale = useTextScale();
  useEffect(() => { if (!preview) void loadTextScale(); }, [preview]);
  const theme = useMemo(() => buildTheme(scheme, modes, reduced, compact, script, uiLang, textScale), [scheme, modes, reduced, compact, script, uiLang, textScale]);
  useEffect(() => {
    if (!preview) installGlobalCss(theme, htmlLang(uiLang));
  }, [theme, uiLang, preview]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Current Kalam shell theme. Read colours from here, never hardcode them. */
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
  /** ≥ 768: wide enough for the navigation rail. */
  hasRail: boolean;
  /** ≥ 1024 */
  isDesktop: boolean;
}

/** Layout breakpoint from the window size. Never use it to infer capabilities. */
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
