/**
 * Pure state for a translated app view (docs/03 §20.2-3, docs/10 §14.4). No React: the hooks in this folder
 * wrap these functions, and Vitest exercises them directly.
 *
 * Rules from the docs: check the saved translation first, never call a model just to open an app, keep the
 * original language visible when anything fails, and never blank a label.
 */
import type { InferenceSource, TranslateAppResult, TranslateService, TranslationCacheRepository } from '@/core/contracts';
import { languageLabel } from '@/core/i18n-labels';
import type { KalamSpec } from '@/core/spec/schema';
import { readCachedTranslation } from '@/core/tasks/translate-service';

export type TranslationStatus =
  /** The app is shown in its own language. */
  | 'original'
  /** Reading the saved translation. */
  | 'checking'
  /** A model call is running. */
  | 'translating'
  /** Every label is translated. */
  | 'ready'
  /** Translated, but some labels stayed in the original language. */
  | 'partial'
  /** Nothing is saved for this language, or what is saved is for older labels. */
  | 'needs_translation'
  | 'failed';

export interface TranslationViewState {
  lang: string;
  status: TranslationStatus;
  /** label key to translated text. Empty when nothing is translated. */
  strings: Readonly<Record<string, string>>;
  /** Keys that stayed in the original language. */
  missing: readonly string[];
  /** Which model made the translation. Absent when nothing is translated. */
  source?: InferenceSource;
  /** The strings came from the saved copy, not from a new model call. */
  cached: boolean;
  /** The person corrected or approved the saved translation. */
  reviewed: boolean;
  /** Plain-language note for the language sheet. */
  message?: string;
}

const NONE: Readonly<Record<string, string>> = Object.freeze({});

export function originalState(lang: string): TranslationViewState {
  return { lang, status: 'original', strings: NONE, missing: [], cached: false, reviewed: false };
}

const hasStrings = (s: TranslationViewState): boolean => Object.keys(s.strings).length > 0;

/**
 * Reads the saved translation only. Never calls a model, so opening an app never costs anything and works
 * offline.
 */
export async function resolveSavedTranslation(
  spec: KalamSpec,
  lang: string,
  cache: TranslationCacheRepository | undefined,
): Promise<TranslationViewState> {
  const saved = await readCachedTranslation(spec, lang, cache);
  const name = languageLabel(lang);
  if (saved.status === 'current' && saved.entry) {
    const missing = saved.missing;
    return {
      lang, status: missing.length ? 'partial' : 'ready', strings: saved.strings, missing, source: saved.entry.source,
      cached: true, reviewed: saved.entry.reviewed === true,
      message: missing.length ? `${missing.length} ${missing.length === 1 ? 'label stays' : 'labels stay'} in ${languageLabel(spec.lang)}.` : undefined,
    };
  }
  return {
    lang, status: 'needs_translation', strings: NONE, missing: saved.missing, cached: false, reviewed: false,
    message: saved.status === 'stale'
      ? `This app changed after it was translated into ${name}. Translate it again to update the labels.`
      : `This app has not been translated into ${name} yet.`,
  };
}

/**
 * Runs the translate service (saved copy first, then a model). On failure the original language stays visible;
 * strings from an earlier successful translation of the same language are kept so a failed retry loses nothing.
 */
export async function runTranslation(
  spec: KalamSpec,
  lang: string,
  service: TranslateService,
  opts: { force?: boolean; preferCloud?: boolean; signal?: AbortSignal; previous?: TranslationViewState } = {},
): Promise<TranslationViewState> {
  const kept = opts.previous && opts.previous.lang === lang && hasStrings(opts.previous) ? opts.previous : undefined;
  let r: TranslateAppResult;
  try {
    r = await service.translateApp(spec, lang, { force: opts.force, preferCloud: opts.preferCloud, signal: opts.signal });
  } catch (e) {
    r = { ok: false, lang, source: 'deterministic', cached: false, missing: [], message: e instanceof Error ? e.message : 'The translation failed.' };
  }
  if (r.ok && r.strings && Object.keys(r.strings).length) {
    const missing = r.missing;
    return {
      lang, status: missing.length ? 'partial' : 'ready', strings: r.strings, missing, source: r.source, cached: r.cached,
      reviewed: false, message: r.message,
    };
  }
  if (r.ok) return { ...originalState(lang), message: r.message };
  return {
    lang,
    status: 'failed',
    strings: kept?.strings ?? NONE,
    missing: kept?.missing ?? r.missing,
    source: kept?.source,
    cached: kept?.cached ?? false,
    reviewed: kept?.reviewed ?? false,
    message: r.message ?? 'The translation did not work. The original labels stay on screen.',
  };
}
