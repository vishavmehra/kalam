import { useRef } from 'react';
import { Platform } from 'react-native';

import { textDirection } from '@/i18n/direction';

import { useKalamTheme } from '../theme';
import { rovingAction, type Orientation } from './logic';

export interface RovingOptions {
  count: number;
  /** Which arrows move focus. Tabs: horizontal. Radio groups: both. */
  orientation?: Orientation;
  /** Index that holds the one tab stop (the selected tab or radio, or the first enabled one). */
  current: number;
  isDisabled?: (index: number) => boolean;
  /** Runs after focus moved to `index`. Select it for radios and automatic-activation tabs. */
  onMove?: (index: number) => void;
  /** Space on item `index`. Set it instead of also spreading `spaceToggles`: both would own `onKeyDown`. */
  onActivate?: (index: number) => void;
}

interface KeyEvent { key: string; repeat?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault(): void }
type Focusable = { focus?: () => void } | null;

/**
 * Roving tabindex and arrow keys for tablists and radio groups (docs/02 §10.7). Spread `itemProps(i)` onto each
 * item: `<Pressable role="tab" {...roving.itemProps(i)} />`. Web only: native screen readers and system focus
 * already move between items, so it returns `{}` there.
 */
export function useRovingFocus(o: RovingOptions) {
  const refs = useRef<Focusable[]>([]);
  const rtl = textDirection(useKalamTheme().uiLanguage) === 'rtl';
  return {
    itemProps(index: number): object {
      if (Platform.OS !== 'web') return {};
      return {
        ref: (el: Focusable) => { refs.current[index] = el; },
        tabIndex: index === o.current ? 0 : -1,
        onKeyDown: (e: KeyEvent) => {
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          const a = rovingAction(e.key, index, o.count, {
            orientation: o.orientation, rtl, isDisabled: o.isDisabled, activate: !!o.onActivate,
          });
          if (!a) return;
          e.preventDefault(); // no page scroll on Space or arrows
          if (a.kind === 'activate') {
            if (!e.repeat) o.onActivate?.(index);
            return;
          }
          if (a.to === index) return;
          refs.current[a.to]?.focus?.();
          o.onMove?.(a.to);
        },
      };
    },
  };
}
