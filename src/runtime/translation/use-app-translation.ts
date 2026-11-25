/**
 * `useAppTranslation(spec)`: everything a running app screen needs for its language switch. It remembers the
 * language chosen for this app on this device, reads the saved translations, tracks connectivity and wraps
 * `useTranslatedSpec`. Pass `undefined` while the app is still loading.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { baseLang, collectTranslatableLabels, sourceHash, TRANSLATION_LANGUAGES } from '@/core/i18n-labels';
import type { KalamSpec } from '@/core/spec/schema';
import { getServices } from '@/services';
import { useTranslatedSpec, type TranslatedSpecState } from './use-translated-spec';

const KEY = (appId: string) => `kalam.appLanguage.${appId}`;

/** The language last chosen for this app on this device. `undefined` means "the app's own language". */
function usePersistedLanguage(appId: string): [string | undefined, (lang: string | undefined) => void] {
  const [chosen, setChosen] = useState<{ appId: string; lang: string | undefined }>({ appId, lang: undefined });
  useEffect(() => {
    if (!appId) return;
    let alive = true;
    AsyncStorage.getItem(KEY(appId))
      .then((value) => {
        if (alive) setChosen({ appId, lang: value && baseLang(value) ? baseLang(value) : undefined });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [appId]);
  const set = useCallback((lang: string | undefined) => {
    setChosen({ appId, lang });
    // Storage can be blocked (private window); the choice still holds for this session.
    const write = lang ? AsyncStorage.setItem(KEY(appId), lang) : AsyncStorage.removeItem(KEY(appId));
    void write.catch(() => undefined);
  }, [appId]);
  return [chosen.appId === appId ? chosen.lang : undefined, set];
}

function useOnlineStatus(): boolean {
  const network = getServices().network;
  const [online, setOnline] = useState(() => network.online());
  useEffect(() => network.subscribe(setOnline), [network]);
  return online;
}

export interface AppTranslation<S extends KalamSpec | undefined = KalamSpec | undefined> extends TranslatedSpecState<S> {
  /** The app's own language, as a primary subtag. */
  ownLang: string;
  /** Languages with a saved translation that matches the app as it is now. These work offline. */
  savedLangs: readonly string[];
  /** Languages offered for translation (the ten planned ones, minus the app's own). */
  offered: readonly string[];
  online: boolean;
  /** True while a model call runs. */
  busy: boolean;
  /** Picks a language. Pass the app's own language to go back to the original. Translates when needed. */
  setLang(lang: string): void;
  /** Translates again, replacing the saved copy. */
  retry(): Promise<void>;
}

export function useAppTranslation<S extends KalamSpec | undefined>(spec: S): AppTranslation<S> {
  const appId = spec?.id ?? '';
  const ownLang = baseLang(spec?.lang);
  const [stored, setStored] = usePersistedLanguage(appId);
  // A model runs only after the person picks a language in this session. A remembered choice just reads the saved copy.
  const [pickedFor, setPickedFor] = useState<string | undefined>(undefined);
  const online = useOnlineStatus();
  const inner = useTranslatedSpec(spec, appId, stored, { auto: pickedFor !== undefined && pickedFor === stored });

  const labelHash = useMemo(() => (spec ? sourceHash(collectTranslatableLabels(spec)) : ''), [spec]);
  const [savedLangs, setSavedLangs] = useState<readonly string[]>([]);
  useEffect(() => {
    let alive = true;
    const cache = getServices().db.translations;
    if (!appId || !cache) {
      setSavedLangs([]);
      return;
    }
    cache.listForApp(appId)
      .then((entries) => {
        if (alive) setSavedLangs(entries.filter((e) => e.sourceHash === labelHash).map((e) => baseLang(e.lang)));
      })
      .catch(() => alive && setSavedLangs([]));
    return () => {
      alive = false;
    };
    // Re-read after each translation finishes or a correction is saved.
  }, [appId, labelHash, inner.status, inner.reviewed]);

  const setLang = useCallback((lang: string) => {
    const next = baseLang(lang);
    setPickedFor(next);
    setStored(next && next !== ownLang ? next : undefined);
  }, [ownLang, setStored]);

  const offered = useMemo(() => TRANSLATION_LANGUAGES.map((l) => l.code).filter((c) => c !== ownLang), [ownLang]);
  const { translate } = inner;
  const retry = useCallback(() => translate(true), [translate]);

  return { ...inner, ownLang, savedLangs, offered, online, busy: inner.status === 'translating' || inner.status === 'checking', setLang, retry };
}
