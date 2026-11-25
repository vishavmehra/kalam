import { X } from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from './Button';
import { usePresence } from './presence';
import { Text } from './Text';
import { useBreakpoint, useKalamTheme } from './theme';

export interface SheetProps {
  visible: boolean;
  /** Called on scrim press, close button, Android back and Escape (web). */
  onClose: () => void;
  /** Required dialog title (docs/02 §10.4). */
  title: string;
  description?: string;
  children?: ReactNode;
  /** Action row; stacked on phones, right-aligned on desktop. */
  footer?: ReactNode;
  /** Desktop dialog width. Default 480. */
  maxWidth?: number;
  /** Set false while a blocking action runs. */
  dismissible?: boolean;
  testID?: string;
}

/**
 * Bottom sheet on phones and tablets, centred dialog at ≥1024px. Modal, focus-trapped on web,
 * closes on Escape / Android back. Reduced motion → fade only.
 */
export function Sheet({ visible, onClose, title, description, children, footer, maxWidth = 480, dismissible = true, testID }: SheetProps) {
  const theme = useKalamTheme();
  const { isDesktop, height } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const reduced = theme.reducedMotion;
  const { mounted, progress } = usePresence(visible, reduced ? 120 : isDesktop ? 220 : 280, reduced ? 100 : 180);
  const sheetH = useSharedValue(480);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: progress.value };
    if (isDesktop) return { opacity: progress.value, transform: [{ scale: 0.96 + 0.04 * progress.value }] };
    return { transform: [{ translateY: (1 - progress.value) * sheetH.value }] };
  });

  const close = () => { if (dismissible) onClose(); };

  // Web: return focus to whatever opened the sheet once it has fully closed (docs/02 §10.4).
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (mounted) {
      if (!returnTo.current) returnTo.current = document.activeElement as HTMLElement | null;
      return;
    }
    const el = returnTo.current;
    returnTo.current = null;
    if (el && el.isConnected) requestAnimationFrame(() => el.focus());
  }, [mounted]);

  return (
    <Modal transparent visible={mounted} onRequestClose={close} animationType="none" statusBarTranslucent navigationBarTranslucent>
      {/* iOS: lift the sheet above the keyboard (Android resizes the window itself). */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: isDesktop ? 'center' : 'flex-end', alignItems: 'center' }} testID={testID}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.scrim }, scrimStyle]}>
          <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" role="button" tabIndex={-1} />
        </Animated.View>
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={title}
          accessibilityViewIsModal
          onLayout={(e) => { sheetH.value = e.nativeEvent.layout.height; }}
          style={[
            {
              width: '100%',
              maxWidth: isDesktop ? maxWidth : 720,
              maxHeight: isDesktop ? height * 0.86 : height * 0.92,
              backgroundColor: theme.colors.surfaceElevated,
              borderRadius: theme.radius.xl,
              borderBottomLeftRadius: isDesktop ? theme.radius.xl : 0,
              borderBottomRightRadius: isDesktop ? theme.radius.xl : 0,
              paddingTop: isDesktop ? 24 : 12,
              paddingBottom: isDesktop ? 24 : Math.max(insets.bottom, 16) + 8,
              borderWidth: theme.accessModes.highContrast ? 2 : 0,
              borderColor: theme.colors.border,
            },
            theme.scheme === 'light' ? theme.elevation[3] : null,
            panelStyle,
          ]}
        >
          {isDesktop ? null : (
            <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.borderStrong, marginBottom: 8 }} />
          )}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingLeft: 24, paddingRight: 12 }}>
            <View style={{ flex: 1, gap: 6, paddingTop: 10 }}>
              <Text variant="h3">{title}</Text>
              {description ? <Text tone="secondary">{description}</Text> : null}
            </View>
            {dismissible ? <IconButton icon={X} label="Close" onPress={onClose} /> : null}
          </View>
          {children ? (
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : null}
          {footer ? (
            <View
              style={{
                flexDirection: isDesktop ? 'row' : 'column',
                justifyContent: 'flex-end',
                gap: 10,
                paddingHorizontal: 24,
                paddingTop: 20,
              }}
            >
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  message: string;
  /** Names the action ("Delete app"), never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** May be async; the button shows a spinner and the sheet stays open until it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** Confirmation dialog for destructive or important decisions. */
export function ConfirmSheet({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', destructive, onConfirm, onCancel }: ConfirmSheetProps) {
  const [busy, setBusy] = useState(false);
  const { isDesktop } = useBreakpoint();
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      title={title}
      description={message}
      dismissible={!busy}
      footer={
        <>
          <Button label={cancelLabel} variant="ghost" onPress={onCancel} disabled={busy} fullWidth={!isDesktop} />
          <Button label={confirmLabel} variant={destructive ? 'destructive' : 'primary'} onPress={confirm} loading={busy} fullWidth={!isDesktop} />
        </>
      }
    />
  );
}
