import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react-native';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n/react';

import { Text } from './Text';
import { useBreakpoint, useKalamTheme } from './theme';
import { type KalamColors, palette } from './tokens';

export type ToastTone = 'neutral' | 'success' | 'danger' | 'info';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  icon?: LucideIcon;
  /** Optional single action, e.g. Undo. */
  action?: { label: string; onPress: () => void };
  /** ms; default 4000 (6000 with an action). */
  duration?: number;
}

interface ToastItem extends ToastOptions { id: number }

interface ToastApi {
  /** Brief, non-critical feedback (docs/02 §10.6). Announced politely to screen readers. */
  show(options: ToastOptions | string): void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

const TONE: Record<ToastTone, { icon?: LucideIcon; color: keyof KalamColors }> = {
  neutral: { color: 'text' },
  success: { icon: CircleCheck, color: 'success' },
  danger: { icon: CircleAlert, color: 'danger' },
  info: { icon: Info, color: 'info' },
};

/** Renders toasts above the app. Mount once at the root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const theme = useKalamTheme();
  const insets = useSafeAreaInsets();
  const { hasRail } = useBreakpoint();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((o: ToastOptions | string) => {
    const opts = typeof o === 'string' ? { message: o } : o;
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { ...opts, id }]);
    setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : 4000));
  }, [dismiss]);
  const api = useMemo(() => ({ show }), [show]);
  const reduced = theme.reducedMotion;
  const tr = useT(theme.uiLanguage);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View
        pointerEvents="box-none"
        aria-live="polite"
        accessibilityLiveRegion="polite"
        style={{
          position: 'absolute', start: 16, end: 16,
          // DIRECTION §7: the top chrome slot on phones (clear of the tab bar and the thumb), bottom-left on wide screens.
          ...(hasRail ? { bottom: 24 } : { top: insets.top + 8 }),
          alignItems: hasRail ? 'flex-start' : 'center',
          // Bottom-left on wide screens, clear of the rail; a left-handed shell has its rail on the right.
          paddingStart: hasRail && !theme.accessModes.leftHanded ? 84 : 0,
          gap: 8,
        }}
      >
        {toasts.map((t) => {
          const tone = TONE[t.tone ?? 'neutral'];
          const Icon = t.icon ?? tone.icon;
          return (
            <Animated.View
              key={t.id}
              entering={reduced ? FadeIn.duration(120) : (hasRail ? FadeInUp : FadeInDown).duration(220)}
              exiting={FadeOut.duration(140)}
              role="status"
              style={[
                {
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  maxWidth: 440, minHeight: 48,
                  paddingStart: 16, paddingEnd: t.action ? 4 : 16, paddingVertical: t.action ? 0 : 8,
                  backgroundColor: theme.scheme === 'dark' ? theme.colors.surfaceElevated : theme.colors.text,
                  borderRadius: theme.radius.press,
                  borderWidth: theme.scheme === 'dark' ? 1 : 0, borderColor: theme.colors.borderStrong,
                },
                theme.scheme === 'light' ? theme.elevation[2] : null,
              ]}
            >
              {Icon ? <Icon size={18} color={theme.scheme === 'dark' ? theme.colors[tone.color] : t.tone === 'success' ? palette.ink.leaf : theme.colors.background} /> : null}
              {/* Tapping the message dismisses the toast (DIRECTION §7); the action, when there is one, stays separate. */}
              <Pressable role="button" onPress={() => dismiss(t.id)} accessibilityHint={tr('shell.toastDismiss')} style={{ flexShrink: 1, minHeight: 32, justifyContent: 'center' }}>
                <Text style={{ color: theme.scheme === 'dark' ? theme.colors.text : theme.colors.background }}>{t.message}</Text>
              </Pressable>
              {t.action ? (
                <Pressable
                  role="button"
                  onPress={() => { t.action?.onPress(); dismiss(t.id); }}
                  style={{ minHeight: theme.touchTarget, paddingHorizontal: 12, justifyContent: 'center', borderRadius: theme.radius.sm }}
                >
                  <Text weight="semibold" style={{ color: theme.scheme === 'dark' ? theme.colors.primary : theme.colors.accent }}>{t.action.label}</Text>
                </Pressable>
              ) : null}
            </Animated.View>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast.show({ message: 'Saved', tone: 'success' })` */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
