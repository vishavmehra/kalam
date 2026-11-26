import { Pause, Play, RotateCcw, WifiOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { type LayoutChangeEvent, Platform, View, type ViewStyle } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { IconButton, Stamp, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

/** Where the story is: which of the four steps is lit, and whether the route stamps and offline note show. */
export interface StoryStatus {
  step: 0 | 1 | 2 | 3;
  route: boolean;
  offline: boolean;
}

/** The finished story: what the still frame and the end of the animation show. */
export const DONE: StoryStatus = { step: 3, route: true, offline: true };

export type PlayState = 'playing' | 'paused' | 'done';

const EDGE = 'M4.2 0 C1.4 9 5.6 15.5 2.6 24 C0 32 4.4 39 1.6 48.5 C-.6 57 3.8 64 1.2 73 C-.6 82 3 90 1.8 100 L100 100 L100 0 Z';

/** Web: re-colour the focus ring (global-css.web.ts `--k-focus`) for controls inside this wrapper. */
const FIELD_FOCUS = (color: string): ViewStyle | undefined => (Platform.OS === 'web' ? ({ '--k-focus': color } as ViewStyle) : undefined);

export interface HeroFieldProps {
  /** Side column with a hand-inked left edge (wide screens), or a full-width band. */
  wide: boolean;
  status: StoryStatus;
  /** Pause, play or replay; omit when nothing moves (reduced motion, no WebGL). */
  control?: { state: PlayState; onPress: () => void };
  onAreaLayout?: (size: { width: number; height: number }) => void;
  /** The paper and the phone. */
  children: ReactNode;
}

/**
 * The royal ink field the story happens on (DIRECTION §4): a top bar with the offline note and the play
 * control, the stage area, and a bottom bar with the four steps and the honest route stamps. Bars sit in the
 * flow, never over the stage, so nothing covers the phone (owner, 2026-11-25). Text on the field uses the
 * on-field tokens (8:1 or better).
 */
export function HeroField({ wide, status, control, onAreaLayout, children }: HeroFieldProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const c = theme.colors;
  const steps = [t('landing.stage.read'), t('landing.stage.build'), t('landing.stage.check'), t('landing.stage.keep')];
  const controlLabel = control?.state === 'playing' ? t('landing.stage.pause') : control?.state === 'paused' ? t('landing.stage.play') : t('landing.stage.replay');
  const ControlIcon = control?.state === 'playing' ? Pause : control?.state === 'paused' ? Play : RotateCcw;
  const show = (on: boolean) => ({ opacity: on ? 1 : 0 });
  return (
    <View style={{ flex: 1, position: 'relative', paddingStart: wide ? 44 : 0 }}>
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="kfieldpool" cx="72%" cy="38%" r="78%">
              <Stop offset="0" stopColor={c.field} stopOpacity={0} />
              <Stop offset="1" stopColor={c.fieldDeep} stopOpacity={0.9} />
            </RadialGradient>
          </Defs>
          {wide ? (
            <>
              <Path d={EDGE} fill={c.field} />
              <Path d={EDGE} fill="url(#kfieldpool)" />
            </>
          ) : (
            <>
              <Rect x={0} y={0} width={100} height={100} fill={c.field} />
              <Rect x={0} y={0} width={100} height={100} fill="url(#kfieldpool)" />
            </>
          )}
        </Svg>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: wide ? 20 : 12, paddingHorizontal: wide ? 20 : 16, minHeight: 56 }}>
        <View aria-hidden style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }, show(status.offline)]}>
          <WifiOff size={18} color={c.accent} strokeWidth={2.2} />
          <Text weight="semibold" style={{ color: c.onField, flexShrink: 1 }}>{t('landing.stage.offline')}</Text>
        </View>
        {control ? (
          // The sindoor ring is too faint on the royal field (1.7:1), so controls here ring in haldi (4.9:1 or better).
          <View style={FIELD_FOCUS(c.accent)}>
            <IconButton icon={ControlIcon} label={controlLabel} color={c.onField} onPress={control.onPress} testID="hero-control" />
          </View>
        ) : null}
      </View>

      <View
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
        onLayout={onAreaLayout ? (e: LayoutChangeEvent) => onAreaLayout(e.nativeEvent.layout) : undefined}
      >
        {children}
      </View>

      <View
        aria-hidden
        style={{
          flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12,
          paddingHorizontal: wide ? 20 : 16, paddingTop: 8, paddingBottom: wide ? 22 : 16,
        }}
      >
        {/* Beside the page the four steps read as a list down the field (the comp); stacked they sit two by two. */}
        <View style={wide ? { gap: 12 } : { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 16, maxWidth: 460, flexShrink: 1 }}>
          {steps.map((label, i) => {
            const on = i === status.step;
            const past = i < status.step;
            return (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: wide ? undefined : theme.compact ? '46%' : 200 }}>
                <View
                  style={{
                    width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? c.accent : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: past ? c.onField : c.onField2,
                  }}
                >
                  <Text mono variant="caption" style={{ color: on ? c.onAccent : c.onField }}>{i + 1}</Text>
                </View>
                <Text variant="bodySmall" weight="semibold" numberOfLines={2} style={{ flexShrink: 1, color: on || past ? c.onField : c.onField2 }}>{label}</Text>
              </View>
            );
          })}
        </View>
        {/* The honest route: stacked under the phone beside the page, side by side when the band is narrow. */}
        <View style={[wide ? { gap: 8, alignItems: 'flex-end' } : { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', flexShrink: 1 }, show(status.route)]}>
          <Stamp kind="cloud" label={t('landing.stage.routeCloud')} wash={c.surface} />
          <Stamp kind="device" label={t('landing.stage.routeDevice')} wash={c.surface} />
        </View>
      </View>
    </View>
  );
}
