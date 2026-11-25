import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react-native';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { useBreakpoint, useKalamTheme } from './theme';
import type { KalamColors } from './tokens';

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

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View
        pointerEvents="box-none"
        aria-live="polite"
        accessibilityLiveRegion="polite"
        style={{
          position: 'absolute', left: 16, right: 16,
          // Clear the phone tab bar (64) + safe area.
          bottom: hasRail ? 24 : insets.bottom + 80,
          alignItems: hasRail ? 'flex-start' : 'center',
          paddingLeft: hasRail ? 96 : 0,
          gap: 8,
        }}
      >
        {toasts.map((t) => {
          const tone = TONE[t.tone ?? 'neutral'];
          const Icon = t.icon ?? tone.icon;
          return (
            <Animated.View
              key={t.id}
              entering={reduced ? FadeIn.duration(120) : FadeInDown.duration(220)}
              exiting={FadeOut.duration(140)}
              role="status"
              style={[
                {
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  maxWidth: 440, minHeight: 48,
                  paddingLeft: 16, paddingRight: t.action ? 6 : 16, paddingVertical: 8,
                  backgroundColor: theme.scheme === 'dark' ? theme.colors.surfaceElevated : theme.colors.text,
                  borderRadius: theme.radius.md,
                },
                theme.scheme === 'light' ? theme.elevation[2] : null,
              ]}
            >
              {Icon ? <Icon size={18} color={theme.scheme === 'dark' ? theme.colors[tone.color] : theme.colors.background} /> : null}
              <Text style={{ flexShrink: 1, color: theme.scheme === 'dark' ? theme.colors.text : theme.colors.background }}>{t.message}</Text>
              {t.action ? (
                <Pressable
                  role="button"
                  onPress={() => { t.action?.onPress(); dismiss(t.id); }}
                  style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: theme.radius.sm }}
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
