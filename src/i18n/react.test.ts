// @vitest-environment jsdom
/**
 * The React bindings, against a fake settings store and a fake font loader (expo-font cannot load in Node).
 * Verifies that changing `settings.language` re-renders text, that an app language is independent of it,
 * and that the boot flag latches so a later language switch never unmounts the app.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/state/settings-store';

import { resetCatalogues } from './catalogue';
import { useFormat, useI18n, useI18nBoot, useLanguage, useT } from './react';

vi.mock('@/state/settings-store', async () => {
  const { create } = await import('zustand');
  const useSettingsStore = create<{ settings: { language: string }; hydrated: boolean }>()(() => ({ settings: { language: 'en' }, hydrated: true }));
  return { useSettingsStore };
});

vi.mock('./use-script-fonts', () => ({
  useScriptFonts: () => ({ ready: true, script: 'latin', error: null }),
  useShellFonts: () => ({ ready: true, script: 'latin', error: null }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setLanguage = (language: string) => act(() => useSettingsStore.setState({ settings: { language } } as never));

afterEach(async () => {
  cleanup();
  await setLanguage('en');
  resetCatalogues();
});

describe('React bindings', () => {
  it('useT follows settings.language and re-renders when the catalogue arrives', async () => {
    const { result } = renderHook(() => useT());
    expect(result.current('nav.shelf')).toBe('Shelf');
    await setLanguage('hi');
    await waitFor(() => expect(result.current('nav.shelf')).toBe('शेल्फ'));
    await setLanguage('ta');
    await waitFor(() => expect(result.current('nav.shelf')).toBe('அலமாரி'));
  });

  it('useLanguage normalises the stored tag', async () => {
    const { result } = renderHook(() => useLanguage());
    await setLanguage('mr-IN');
    expect(result.current).toBe('mr');
    await setLanguage('fr');
    expect(result.current).toBe('en');
  });

  it('an app language is independent of the Studio language (docs/10 §11)', async () => {
    await setLanguage('hi');
    const { result } = renderHook(() => ({ studio: useI18n(), app: useI18n('ta') }));
    await waitFor(() => {
      expect(result.current.studio.t('nav.shelf')).toBe('शेल्फ');
      expect(result.current.app.t('nav.shelf')).toBe('அலமாரி');
    });
    expect(result.current.app.language).toBe('ta');
    expect(result.current.app.htmlLang).toBe('ta');
  });

  it('useFormat is bound to the language and formats with Indian grouping', async () => {
    const { result } = renderHook(() => useFormat());
    expect(result.current.number(1234567)).toBe('12,34,567');
    await setLanguage('hi');
    await waitFor(() => expect(result.current.language).toBe('hi'));
  });

  it('useI18nBoot waits for settings and the catalogue, then stays ready', async () => {
    const { result, rerender } = renderHook(({ settingsReady }) => useI18nBoot(settingsReady), { initialProps: { settingsReady: false } });
    expect(result.current.ready).toBe(false);
    rerender({ settingsReady: true });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await setLanguage('ml'); // not loaded yet: the app must stay mounted
    expect(result.current.ready).toBe(true);
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it('boot becomes ready even when a language fails to load, and shows English', async () => {
    const { setCatalogueLoaders } = await import('./catalogue');
    setCatalogueLoaders({ gu: () => Promise.reject(new Error('offline')) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setLanguage('gu');
    const { result } = renderHook(() => ({ boot: useI18nBoot(true), t: useT() }));
    await waitFor(() => expect(result.current.boot.ready).toBe(true));
    expect(result.current.t('nav.shelf')).toBe('Shelf');
    vi.restoreAllMocks();
  });
});
