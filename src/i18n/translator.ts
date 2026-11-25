/**
 * The translator: looks a key up in the selected language, then English, interpolates `{params}`, and
 * picks plural forms from `params.count`. Pure TypeScript, so it runs in Node tests.
 *
 * Fallback order (docs/10 §11.3): selected language, then English, then `options.defaultValue`, then an
 * empty string. A raw key is never shown to the person. Missing keys warn once in development only.
 */
import { isDev } from './dev';
import { getCatalogue } from './catalogue';
import { createFormatter, type Formatter, type FormatterOptions } from './format';
import { interpolate } from './interpolate';
import type { TranslationKey } from './keys';
import { DEFAULT_LANGUAGE, htmlLang, resolveLanguage, textDirection, localeFor, type LanguageCode } from './languages';
import { pluralCategory } from './plural';
import { scriptForLanguage, type Script } from './scripts';
import type { MissingEvent, ParsedCatalogue, PluralCategory, TranslateOptions, TranslateParams, Message } from './types';

export type TFunction = (key: TranslationKey, params?: TranslateParams, options?: TranslateOptions) => string;
/** Same as `TFunction` for keys built at run time, such as `` `status.${state}` ``. Not type-checked. */
export type DynamicTFunction = (key: string, params?: TranslateParams, options?: TranslateOptions) => string;

export interface Translator {
  readonly language: LanguageCode;
  /** Locale used for Intl formatting, for example `hi-IN`. */
  readonly locale: string;
  /** Value for the HTML `lang` attribute. */
  readonly htmlLang: string;
  readonly direction: 'ltr' | 'rtl';
  readonly script: Script;
  /** True while this language's catalogue is still an unreviewed draft. */
  readonly isDraft: boolean;
  readonly format: Formatter;
  t: TFunction;
  td: DynamicTFunction;
  /** True if the key exists in the selected language or in English. */
  has(key: string): boolean;
}

export interface TranslatorOptions {
  /** Where to read catalogues from. Defaults to the shared registry. */
  getCatalogue?: (language: string) => ParsedCatalogue | undefined;
  /** Called once per missing key, fallback or missing placeholder. */
  onMissing?: (event: MissingEvent) => void;
  /** Set false to silence the development console warning (tests). */
  warn?: boolean;
  /** Options for the bound formatter (currency, time zone, digits). */
  formatter?: Omit<FormatterOptions, 'translate'>;
  fallbackLanguage?: LanguageCode;
}

const warnedInConsole = new Set<string>();

/** Forget which warnings were printed. For tests. */
export function resetMissingKeyWarnings(): void {
  warnedInConsole.clear();
}

export function createTranslator(language: string, options: TranslatorOptions = {}): Translator {
  const lang = resolveLanguage(language);
  const fallback = options.fallbackLanguage ?? DEFAULT_LANGUAGE;
  const catalogueOf = options.getCatalogue ?? getCatalogue;
  const chain: readonly LanguageCode[] = lang === fallback ? [lang] : [lang, fallback];
  const reported = new Set<string>();

  const report = (event: MissingEvent): void => {
    const id = `${event.kind}|${event.language}|${event.key}|${event.param ?? ''}`;
    if (!reported.has(id)) {
      reported.add(id);
      options.onMissing?.(event);
    }
    if (isDev() && options.warn !== false && !warnedInConsole.has(id)) {
      warnedInConsole.add(id);
      const what =
        event.kind === 'missing'
          ? `no translation for "${event.key}" in any language`
          : event.kind === 'fallback'
            ? `"${event.key}" is missing in "${event.language}"; showing English`
            : `"${event.key}" has no value for {${event.param}}`;
      console.warn(`[i18n] ${what}`);
    }
  };

  // The formatter's relative-time strings come from this translator's own catalogue.
  const format = createFormatter(lang, {
    ...options.formatter,
    translate: (key, params) => translate(key, params),
  });

  const lookup = (key: string): { message: Message; language: LanguageCode } | undefined => {
    for (const l of chain) {
      const message = catalogueOf(l)?.messages.get(key);
      if (message !== undefined) return { message, language: l };
    }
    return undefined;
  };

  const render = (key: string, message: Message, messageLanguage: LanguageCode, params: TranslateParams | undefined): string => {
    let template: string;
    if (typeof message === 'string') {
      template = message;
    } else {
      const raw = params?.count;
      const count = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
      let category: PluralCategory = 'other';
      if (Number.isFinite(count)) category = count === 0 && message.zero !== undefined ? 'zero' : pluralCategory(messageLanguage, count);
      else report({ kind: 'param', key, language: lang, param: 'count' });
      template = message[category] ?? message.other;
    }
    return interpolate(template, params, {
      formatNumber: (n) => format.number(n),
      onMissingParam: (param) => {
        if (param !== 'count' || typeof message === 'string') report({ kind: 'param', key, language: lang, param });
      },
    });
  };

  const translate = (key: string, params?: TranslateParams, opts?: TranslateOptions): string => {
    const found = lookup(key);
    if (!found) {
      report({ kind: 'missing', key, language: lang });
      return opts?.defaultValue === undefined ? '' : interpolate(opts.defaultValue, params, { formatNumber: (n) => format.number(n) });
    }
    // Only a loaded catalogue can be "missing" a key. While a language is still loading, English is expected.
    if (found.language !== lang && catalogueOf(lang)) report({ kind: 'fallback', key, language: lang });
    return render(key, found.message, found.language, params);
  };

  return {
    language: lang,
    locale: localeFor(lang),
    htmlLang: htmlLang(lang),
    direction: textDirection(lang),
    script: scriptForLanguage(lang),
    get isDraft() {
      return catalogueOf(lang)?.meta.draft ?? false;
    },
    format,
    t: (key, params, opts) => translate(key, params, opts),
    td: translate,
    has: (key) => lookup(key) !== undefined,
  };
}
