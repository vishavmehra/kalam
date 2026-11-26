/**
 * Live build progress (docs/03 §12.2, DIRECTION §6 "Build progress"). The person's own inputs sit on the
 * left as their material tiles; on the right the steps grow one by one as numbered ledger rows, with a nib
 * writing on the step that is running. Only steps that really started appear. The route stamp changes as
 * the route changes. Under reduced motion the nib and the rows stand still.
 */
import { Check, Cloud, LayoutTemplate, PenLine, Smartphone, Sparkles, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, View } from 'react-native';

import { announce, Button, slipNumber, Stamp, Text, useBreakpoint, useKalamTheme, useReducedMotion } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';

import { MaterialTile, useTrayItems } from './InputTray';
import { liveRoute, routeFromSteps, STEP_KEY, verifyCount, type RouteBadge } from './stages';

const ROUTE: Record<Exclude<RouteBadge, 'Checking'>, { kind: 'template' | 'device' | 'cloud'; label: TranslationKey; icon: typeof Cloud }> = {
  Template: { kind: 'template', label: 'stamp.template', icon: LayoutTemplate },
  'On-device': { kind: 'device', label: 'stamp.device', icon: Smartphone },
  Cloud: { kind: 'cloud', label: 'stamp.cloud', icon: Cloud },
  Specialist: { kind: 'cloud', label: 'source.specialist', icon: Sparkles },
};

const useNative = Platform.OS !== 'web';

/** A nib that writes a short line, at constant speed (writing is linear, DIRECTION §5). Still under reduced motion. */
function Nib() {
  const theme = useKalamTheme();
  const reduced = useReducedMotion();
  const [p] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) { p.setValue(1); return undefined; }
    const loop = Animated.loop(Animated.timing(p, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: useNative }));
    loop.start();
    return () => loop.stop();
  }, [p, reduced]);
  const W = 28;
  return (
    <View aria-hidden style={{ width: W + 16, height: 22, justifyContent: 'flex-end' }}>
      <Animated.View
        style={{ position: 'absolute', left: 0, bottom: 3, width: W, height: 2, borderRadius: 1, backgroundColor: theme.colors.primary, transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [-W / 2, 0] }) }, { scaleX: p }] }}
      />
      <Animated.View style={{ position: 'absolute', bottom: 2, left: 0, transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, W] }) }] }}>
        <PenLine size={16} color={theme.colors.primary} strokeWidth={2.2} />
      </Animated.View>
    </View>
  );
}

/** A row that eases in once when its step starts. */
function RowIn({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [v] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (!reduced) Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: useNative }).start();
  }, [v, reduced]);
  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>{children}</Animated.View>;
}

export function CreationProgress({ onCancel }: { onCancel: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { colors, space, radius } = theme;
  const { isPhone } = useBreakpoint();
  const run = useCreationStore((s) => s.run);
  const { items } = useTrayItems();
  const badge = liveRoute(run.stage, run.stageDetail) ?? routeFromSteps(run.steps);
  const route = badge && badge !== 'Checking' ? ROUTE[badge] : undefined;
  // Announce each new step once instead of re-reading the whole card (docs/10 §7.4).
  const active = run.steps.find((st) => st.status === 'active');
  const activeLabel = active ? t(STEP_KEY[active.id]) : undefined;
  useEffect(() => { if (activeLabel) announce(activeLabel); }, [activeLabel]);

  const inputs = items.length ? (
    <View key="inputs" style={{ gap: space[3], width: isPhone ? '100%' : 312 }}>
      <Text variant="bodySmall" weight="semibold" tone="secondary">{t('create.build.yourInputs')}</Text>
      <View role="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {items.map((it) => <MaterialTile key={it.key} item={it} readOnly compact />)}
      </View>
    </View>
  ) : null;

  const steps = (
    <View key="steps" style={{ flex: isPhone ? undefined : 1, gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Text variant="h2" accessibilityRole="header">{t('create.progress.title')}</Text>
        <Text tone="secondary">{t('create.build.reading')}</Text>
      </View>
      {route ? <Stamp kind={route.kind} label={t(route.label)} icon={route.icon} accessibilityLabel={t('create.build.routeNow', { route: t(route.label) })} /> : null}
      <View role="list" style={{ gap: 6 }}>
        {run.steps.length === 0 ? (
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center', minHeight: 44 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text tone="secondary">{t('create.progress.preparing')}</Text>
          </View>
        ) : run.steps.map((step, i) => {
          const on = step.status === 'active';
          const label = t(STEP_KEY[step.id]);
          const count = step.id === 'verify_ai' ? verifyCount(step.detail) : undefined;
          const detail = count ? t('create.build.verifyCount', count) : undefined;
          return (
            <RowIn key={step.id}>
              <View
                role="listitem"
                accessible
                accessibilityLabel={t(on ? 'create.build.rowActive' : 'create.build.rowDone', { n: i + 1, label: detail ? `${label}. ${detail}` : label })}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 48, paddingHorizontal: space[3], paddingVertical: 6,
                  borderRadius: radius.paper, backgroundColor: on ? theme.tints.haldi : 'transparent',
                }}
              >
                <Text mono variant="caption" style={{ color: colors.markInk, minWidth: Math.round(52 * theme.fontScale), flexShrink: 0 }}>{slipNumber(i + 1, 2, t('slip.no'))}</Text>
                <View style={{ flex: 1 }}>
                  <Text weight={on ? 'semibold' : 'regular'} tone={on ? 'default' : 'secondary'}>{label}</Text>
                  {detail ? <Text variant="caption" tone="muted" numeric>{detail}</Text> : null}
                </View>
                {on ? <Nib /> : <Check size={18} color={colors.success} strokeWidth={2.4} />}
              </View>
            </RowIn>
          );
        })}
      </View>
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row' }}>
          <Button label={t('common.cancel')} variant="outline" icon={X} onPress={onCancel} />
        </View>
        {/* Only when the cloud really has the request: stopping here cannot call it back (docs/03 §12.3). */}
        {route?.kind === 'cloud' ? <Text variant="bodySmall" tone="secondary">{t('create.progress.background')}</Text> : null}
      </View>
    </View>
  );

  return (
    <View
      style={{
        borderRadius: radius.xl, backgroundColor: colors.surface, padding: isPhone ? space[5] : space[8],
        ...theme.elevation[1], borderWidth: theme.scheme === 'dark' ? 1 : 0, borderColor: colors.border,
      }}
    >
      {/* Reading order is the visual order: steps first on phones, the inputs first beside them on wider screens. */}
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? space[6] : space[10] }}>
        {isPhone ? [steps, inputs] : [inputs, steps]}
      </View>
    </View>
  );
}
