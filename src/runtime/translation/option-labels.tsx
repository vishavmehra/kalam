/**
 * Display names for enum options in a translated app. Stored record values stay canonical (the option text
 * written in the app's own language); only what the person SEES changes (docs/10 §14.2).
 *
 * Wrap the running app in `<OptionLabelsProvider value={translation.optionLabels}>`. Choice chips and list rows
 * call `useOptionLabel()` for the visible text and keep using the canonical option for values and logic.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});
const OptionLabelsContext = createContext<Readonly<Record<string, string>>>(EMPTY);

export function OptionLabelsProvider({ value, children }: { value: Readonly<Record<string, string>>; children: ReactNode }) {
  return <OptionLabelsContext.Provider value={value}>{children}</OptionLabelsContext.Provider>;
}

/** Returns `(canonicalOption) => displayText`. With no provider, or no translation, it returns the option itself. */
export function useOptionLabel(): (canonical: string) => string {
  const labels = useContext(OptionLabelsContext);
  return useCallback(
    (canonical: string) => (Object.prototype.hasOwnProperty.call(labels, canonical) ? labels[canonical] ?? canonical : canonical),
    [labels],
  );
}
