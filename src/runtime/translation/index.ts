/**
 * Language switching for running apps (docs/10 §14-15, docs/09 §12.3). The translated spec is a display-only
 * copy: the canonical spec and the stored records are never changed.
 *
 * Mount:
 *   const tr = useAppTranslation(app?.spec);                       // once, in the run screen
 *   <LanguageSwitch translation={tr} />                            // in the header
 *   <OptionLabelsProvider value={tr.optionLabels}>
 *     <KalamRuntime spec={tr.spec ?? app.spec} ... />
 *   </OptionLabelsProvider>
 */
export { CorrectionSheet, type CorrectionSheetProps } from './CorrectionSheet';
export { LanguageSwitch, type LanguageSwitchProps } from './LanguageSwitch';
export { OptionLabelsProvider, useOptionLabel } from './option-labels';
export { TranslationReviewSheet, type TranslationReviewSheetProps } from './TranslationReviewSheet';
export { useAppTranslation, type AppTranslation } from './use-app-translation';
export { useTranslatedSpec, type TranslatedSpecState } from './use-translated-spec';
export {
  originalState, resolveSavedTranslation, runTranslation, type TranslationStatus, type TranslationViewState,
} from './translation-state';
