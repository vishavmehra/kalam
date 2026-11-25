/**
 * `useTranslatedSpec(spec, appId, lang)`: the display-only translated copy of a running app (docs/09 §12.3,
 * docs/05 §11.3). The canonical spec is never changed or saved. Switching language keeps the current screen,
 * the form values and the records, because only the spec prop changes (docs/10 §14.4).
 *
 * Opening an app only reads the saved translation. A model runs when `auto` is true (the person just picked
 * the language) or when `translate()` is called.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { baseLang, collectTranslatableLabels, sourceHash, translatedView } from '@/core/i18n-labels';
import type { KalamSpec } from '@/core/spec/schema';
import { getServices } from '@/services';
import {
  originalState, resolveSavedTranslation, runTranslation, type TranslationStatus, type TranslationViewState,
} from './translation-state';

const NO_LABELS: Readonly<Record<string, string>> = Object.freeze({});

export interface TranslatedSpecState<S extends KalamSpec | undefined = KalamSpec | undefined> {
  /** Spec to render. The translated copy when one applies, otherwise the original object. */
  spec: S;
  /** The canonical spec, untouched. Use it for editing, saving and the review list. */
  original: S;
  /** Enum option display names (canonical value to text). Pass to `OptionLabelsProvider`. */
  optionLabels: Readonly<Record<string, string>>;
  /** Language being shown, as a primary subtag: `hi`. */
  lang: string;
  /** True when the app is shown in its own language. */
  isOriginal: boolean;
  status: TranslationStatus;
  message?: string;
  source?: TranslationViewState['source'];
  cached: boolean;
  reviewed: boolean;
  /** Label keys that stayed in the original language. */
  missing: readonly string[];
  /** label key to translated text, as saved. */
  strings: Readonly<Record<string, string>>;
  /**
   * Runs the translation. `force` translates again even when a saved copy is current. `preferCloud` skips the
   * on-device model when the person wants cloud quality.
   */
  translate(force?: boolean, preferCloud?: boolean): Promise<void>;
  /** Saves the person's wording for one label and marks the translation as reviewed. Throws a readable error. */
  correct(key: string, text: string): Promise<void>;
}

export function useTranslatedSpec<S extends KalamSpec | undefined>(
  spec: S,
  appId: string,
  lang: string | undefined,
  opts: { auto?: boolean } = {},
): TranslatedSpecState<S> {
  const auto = opts.auto === true;
  const target = baseLang(lang);
  const own = baseLang(spec?.lang);
  const isOriginal = !spec || !target || target === own;
  const labelHash = useMemo(() => (spec ? sourceHash(collectTranslatableLabels(spec)) : ''), [spec]);

  const [state, setState] = useState<TranslationViewState>(() => originalState(isOriginal ? own : target));
  const stateRef = useRef(state);
  stateRef.current = state;
  const specRef = useRef(spec);
  specRef.current = spec;
  const run = useRef(0);
  const abort = useRef<AbortController | undefined>(undefined);

  const apply = useCallback((next: TranslationViewState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const translate = useCallback(async (force = false, preferCloud = false) => {
    const current = specRef.current;
    if (!current || !target || target === baseLang(current.lang)) return;
    const service = getServices().translate;
    const id = ++run.current;
    abort.current?.abort();
    if (!service) {
      apply({ ...stateRef.current, lang: target, status: 'failed', message: 'Translation is not set up in this build.' });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    apply({ ...stateRef.current, lang: target, status: 'translating', message: undefined });
    const next = await runTranslation(current, target, service, { force, preferCloud, signal: controller.signal, previous: stateRef.current });
    if (id === run.current) apply(next);
  }, [apply, target]);

  useEffect(() => {
    const id = ++run.current;
    abort.current?.abort();
    if (isOriginal) {
      apply(originalState(own));
      return;
    }
    // Keep showing what is on screen while the saved copy is read, so switching does not flicker.
    apply({ ...stateRef.current, lang: target, status: 'checking', message: undefined, strings: stateRef.current.lang === target ? stateRef.current.strings : NO_LABELS });
    const current = specRef.current;
    if (!current) return;
    void resolveSavedTranslation(current, target, getServices().db.translations).then((saved) => {
      if (id !== run.current) return;
      if (saved.status === 'needs_translation' && auto) void translate(false);
      else apply(saved);
    });
    return () => {
      run.current += 1;
      abort.current?.abort();
    };
    // `spec` is read through specRef; labelHash changes exactly when the label text changes.
  }, [apply, auto, isOriginal, labelHash, own, target, translate]);

  const view = useMemo(() => {
    if (!spec || isOriginal || state.lang !== target || !Object.keys(state.strings).length) {
      return { spec, optionLabels: NO_LABELS };
    }
    const v = translatedView(spec, state.strings, target);
    return { spec: v.spec as KalamSpec, optionLabels: v.optionLabels };
  }, [spec, isOriginal, state.lang, state.strings, target]);

  const correct = useCallback(async (key: string, text: string) => {
    const service = getServices().translate;
    const current = specRef.current;
    if (!service || !current || !target) throw new Error('Translation is not available.');
    await service.correct(appId, target, key, text);
    // Read the saved copy back so the screen shows exactly what was stored.
    const saved = await resolveSavedTranslation(current, target, getServices().db.translations);
    if (saved.status === 'ready' || saved.status === 'partial') apply(saved);
  }, [appId, apply, target]);

  return {
    spec: view.spec as S,
    original: spec,
    optionLabels: view.optionLabels,
    lang: isOriginal ? own : target,
    isOriginal,
    status: isOriginal ? 'original' : state.status,
    message: state.message,
    source: state.source,
    cached: state.cached,
    reviewed: state.reviewed,
    missing: state.missing,
    strings: state.strings,
    translate,
    correct,
  };
}
