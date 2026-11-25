/** Runtime overlays: toast feedback and the AI review sheet (review before applying). */
import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { KalamSpec } from '@/core/spec/schema';
import { formatFieldValue } from '../engine/data';
import { collectionFieldDefs, screenFieldDefs } from '../engine/fields';
import { findScreen } from '../engine/state';
import type { RuntimeTheme } from '../engine/theme';
import type { AIProposal, ToastTone } from '../engine/types';
import { EASE_OUT, font, NATIVE_DRIVER, Pressy, SourceBadge } from './kit';

export interface ToastMessage { id: number; message: string; tone: ToastTone }

const ICON = { success: Check, info: Info, warning: TriangleAlert, error: CircleAlert } as const;

/** Bottom toast. Enters with a short rise (fade only under reduced motion); exits faster than it enters. */
export function Toast({ toast, t, reduced }: { toast: ToastMessage | null; t: RuntimeTheme; reduced: boolean }) {
  const [shown, setShown] = useState<ToastMessage | null>(toast);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast) {
      setShown(toast);
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 200, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 140, easing: EASE_OUT, useNativeDriver: NATIVE_DRIVER }).start(({ finished }) => {
        if (finished) setShown(null);
      });
    }
  }, [toast, anim]);

  if (!shown) return null;
  const Icon = ICON[shown.tone];
  const translateY = reduced ? 0 : anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <Animated.View
        accessibilityLiveRegion="polite"
        role="status"
        style={[
          styles.toast,
          { backgroundColor: t.colors.text, borderRadius: Math.min(t.radius + 4, 24), opacity: anim, transform: [{ translateY }] },
        ]}
      >
        <Icon size={18 * t.fontScale} color={t.colors.surface} strokeWidth={2.5} />
        <Text style={[font(t, 15, '500'), { color: t.colors.surface, flexShrink: 1 }]}>{shown.message}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * Shows exactly what the AI proposes, where it ran, and what was rejected. Nothing reaches the
 * form until the person taps "Fill in" (docs/09 §12.2 steps 9–10).
 */
export function AIReviewSheet({ proposal, spec, t, wide, onAccept, onDiscard }: {
  proposal: AIProposal | null; spec: KalamSpec; t: RuntimeTheme; wide: boolean; onAccept(): void; onDiscard(): void;
}) {
  if (!proposal) return null;
  const block = spec.aiBlocks[proposal.blockId];
  const screen = findScreen(spec, proposal.screenId);
  const defs = {
    ...(block?.kind === 'extractFromPhoto' ? collectionFieldDefs(spec, block.target) : undefined),
    ...(screen ? screenFieldDefs(spec, screen) : undefined),
  };
  const entries = Object.entries(proposal.values);
  const accept = (
    <Pressy
      key="accept"
      accessibilityRole="button"
      onPress={onAccept}
      style={[styles.sheetBtn, { flex: 1, minHeight: Math.max(t.target, 52), borderRadius: t.radius, backgroundColor: t.colors.primary }]}
    >
      <Text style={[font(t, 16, '600'), { color: t.colors.onPrimary }]}>
        Fill in {entries.length} field{entries.length === 1 ? '' : 's'}
      </Text>
    </Pressy>
  );
  const discard = (
    <Pressy
      key="discard"
      accessibilityRole="button"
      onPress={onDiscard}
      style={[styles.sheetBtn, { flex: 1, minHeight: Math.max(t.target, 52), borderRadius: t.radius, borderWidth: Math.max(1, t.borderWidth), borderColor: t.colors.border }]}
    >
      <Text style={[font(t, 16, '600'), { color: t.colors.text }]}>Discard</Text>
    </Pressy>
  );

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDiscard} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: t.colors.scrim, justifyContent: wide ? 'center' : 'flex-end' }]}>
        <Pressable accessibilityLabel="Discard suggestions" style={StyleSheet.absoluteFill} onPress={onDiscard} />
        <View
          accessibilityViewIsModal
          role="dialog"
          aria-label="Check the AI suggestions"
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              borderRadius: wide ? t.radius + 6 : 0,
              borderTopLeftRadius: t.radius + 6,
              borderTopRightRadius: t.radius + 6,
              padding: t.space * 1.25,
              maxWidth: wide ? 480 : undefined,
            },
          ]}
        >
          <Text accessibilityRole="header" style={[font(t, 20, '600', 1.3), { color: t.colors.text }]}>
            Check before filling in
          </Text>
          <SourceBadge t={t} source={proposal.source} detail={`${Math.round(proposal.latencyMs)} ms`} />
          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 2 }}>
            {entries.map(([field, value]) => (
              <View key={field} style={[styles.kv, { borderBottomColor: t.colors.border }]}>
                <Text style={[font(t, 14), { color: t.colors.textMuted, flex: 1 }]}>{defs[field]?.label ?? field}</Text>
                <Text style={[font(t, 16, '600'), { color: t.colors.text, flex: 1.4, textAlign: 'right' }]}>
                  {formatFieldValue(defs[field], value, spec.lang) || 'Empty'}
                </Text>
              </View>
            ))}
            {proposal.rejected.map((r) => (
              <Text key={r.field} style={[font(t, 13), { color: t.colors.textMuted, paddingTop: 6 }]}>
                Not used: {r.reason}.
              </Text>
            ))}
          </ScrollView>
          {/* Left-handed: the confirming action sits on the leading edge. */}
          <View style={{ flexDirection: 'row', gap: 10 }}>{t.mirror ? [accept, discard] : [discard, accept]}</View>
        </View>
      </View>
    </Modal>
  );
}

export interface ConfirmRequest { message: string; resolve(ok: boolean): void }

/**
 * In-app confirmation in the app's own theme (docs/02 §19: never the browser's native confirm).
 * Used for deleting records and other actions the app's spec marks as needing confirmation.
 */
export function ConfirmSheet({ request, t, wide }: { request: ConfirmRequest | null; t: RuntimeTheme; wide: boolean }) {
  if (!request) return null;
  const answer = (ok: boolean) => request.resolve(ok);
  const yes = (
    <Pressy
      key="yes"
      accessibilityRole="button"
      onPress={() => answer(true)}
      style={[styles.sheetBtn, { flex: 1, minHeight: Math.max(t.target, 52), borderRadius: t.radius, backgroundColor: t.colors.danger }]}
    >
      <Text style={[font(t, 16, '600'), { color: t.colors.onDanger }]}>Yes, do it</Text>
    </Pressy>
  );
  const no = (
    <Pressy
      key="no"
      accessibilityRole="button"
      onPress={() => answer(false)}
      style={[styles.sheetBtn, { flex: 1, minHeight: Math.max(t.target, 52), borderRadius: t.radius, borderWidth: Math.max(1, t.borderWidth), borderColor: t.colors.border }]}
    >
      <Text style={[font(t, 16, '600'), { color: t.colors.text }]}>Cancel</Text>
    </Pressy>
  );
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => answer(false)} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: t.colors.scrim, justifyContent: wide ? 'center' : 'flex-end' }]}>
        <Pressable accessibilityLabel="Cancel" style={StyleSheet.absoluteFill} onPress={() => answer(false)} />
        <View
          accessibilityViewIsModal
          role="alertdialog"
          aria-label={request.message}
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              borderRadius: wide ? t.radius + 6 : 0,
              borderTopLeftRadius: t.radius + 6,
              borderTopRightRadius: t.radius + 6,
              padding: t.space * 1.25,
              maxWidth: wide ? 420 : undefined,
            },
          ]}
        >
          <Text accessibilityRole="header" style={[font(t, 18, '600', 1.35), { color: t.colors.text }]}>{request.message}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>{t.mirror ? [yes, no] : [no, yes]}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 24, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 480 },
  scrim: { flex: 1, alignItems: 'center' },
  sheet: { width: '100%', gap: 14 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
});
