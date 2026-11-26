import { Camera, Mic, Type, Video, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, runOnJS, type SharedValue, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect as SvgRect } from 'react-native-svg';

import { useAmbientMotion, useKalamTheme } from '@/design';
import { localeFor } from '@/i18n/languages';
import { useT } from '@/i18n/react';
import { loadScriptFonts } from '@/i18n/use-script-fonts';

import type { HeroStageProps } from './HeroStage';
import { DONE, HeroField, type PlayState, type StoryStatus } from './HeroField';
import { HeroPoster, PAPER_TILT, PaperStamp, PHONE_RADIUS, PHONE_TILT, SKETCH, SKETCH_BLANK } from './HeroPoster';
import { OrderPhone } from './OrderPhone';
import {
  APP_THEME, BALANCE, BEZEL, FIELDS, finalApp, type Hover, hoverSlots, ORDER, PEN_RED, penAt, READ_SCHEDULE, type Rect, type StampPlace,
  stageLayout, stampDate, stepAt, T, type Timed, SCREEN, type WayIn, WRITE_SCHEDULE,
} from './story';

// Positions in this file are artwork coordinates and stay physical: a drawn scene is not mirrored (docs/10 §13.6).
const PAD = 0.025;

/** One handwritten field: the written page shows through a window that opens left to right as the pen moves. */
function WrittenField({ item, page, clock }: { item: Timed; page: Rect; clock: SharedValue<number> }) {
  const b = FIELDS[item.key];
  const left = (b.x - PAD) * page.w;
  const top = (b.y - 0.016) * page.h;
  const full = (b.w + PAD * 2) * page.w;
  const style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (clock.value - item.start) / item.duration));
    return { width: p * full };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left, top, height: (b.h + 0.024) * page.h, overflow: 'hidden' }, style]}>
      <Image source={SKETCH} aria-hidden style={{ position: 'absolute', left: -left, top: -top, width: page.w, height: page.h }} />
    </Animated.View>
  );
}

/** A red-pen underline under a field Kalam has read. */
function ReadLine({ item, page, clock }: { item: Timed; page: Rect; clock: SharedValue<number> }) {
  const b = FIELDS[item.key];
  const style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (clock.value - item.start) / item.duration));
    return { width: p * b.w * page.w };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', left: b.x * page.w, top: (b.y + b.h + 0.004) * page.h, height: Math.max(1.6, page.w * 0.0045), borderRadius: 1, backgroundColor: PEN_RED, opacity: 0.9 }, style]}
    />
  );
}

/** The fountain pen, tip at the bottom left. */
function Pen({ page, clock }: { page: Rect; clock: SharedValue<number> }) {
  const len = page.w * 0.42;
  const style = useAnimatedStyle(() => {
    const pose = penAt(clock.value);
    return {
      opacity: pose.shown,
      transform: [{ translateX: pose.x * page.w }, { translateY: pose.y * page.h - len * 0.55 }, { translateY: pose.down ? 0 : -4 }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: len, height: len * 0.55 }, style]}>
      <Svg width={len} height={len * 0.55} viewBox="0 0 200 110">
        <Path d="M2 108 L30 84 L44 98 Z" fill="#B5AEA4" />
        <Path d="M30 84 L52 62 L66 76 L44 98 Z" fill="#1C1917" />
        <Path d="M52 62 L178 6 Q194 2 192 18 L66 76 Z" fill="#E2583E" />
        <Path d="M120 34 L128 30 L142 44 L134 48 Z" fill="#F2A541" />
      </Svg>
    </Animated.View>
  );
}

const CHIPS: Array<{ key: WayIn; icon: LucideIcon; delay: number }> = [
  { key: 'text', icon: Type, delay: 0 },
  { key: 'photo', icon: Camera, delay: 0.14 },
  { key: 'voice', icon: Mic, delay: 0.28 },
  { key: 'video', icon: Video, delay: 0.42 },
];

/**
 * A way in (typed note, photo, voice, video) that arrives, waits in its slot beside the page (never over the
 * phone or the writing, story.ts hoverSlots), then flies into the phone.
 */
function Chip({ chip, size, slot, phone, clock, index }: { chip: (typeof CHIPS)[number]; size: number; slot: Hover; phone: Rect; clock: SharedValue<number>; index: number }) {
  const theme = useKalamTheme();
  const hx = slot.cx - size / 2, hy = slot.cy - size / 2;
  const px = phone.x + phone.w / 2 - size / 2, py = phone.y + phone.h * 0.4 - size / 2;
  const Icon = chip.icon;
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const arrive = Math.min(1, Math.max(0, (t - T.inputsIn - chip.delay) / 0.8));
    const a = 1 - (1 - arrive) ** 3;
    const pull = Math.min(1, Math.max(0, (t - T.pull - index * 0.1) / 0.6));
    const p = pull * pull;
    const x = hx + (px - hx) * p;
    const y = hy - (1 - a) * 40 + (py - hy) * p;
    return { opacity: a * (1 - Math.min(1, Math.max(0, (pull - 0.6) / 0.4))), transform: [{ translateX: x }, { translateY: y }, { scale: slot.k * (0.7 + 0.3 * a) * (1 - 0.85 * p) }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute', left: 0, top: 0, width: size, height: size, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
        backgroundColor: index === 2 ? '#F2A541' : '#FBFAF5', shadowColor: '#0A0908', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6,
      }, style]}
    >
      <Icon size={size * 0.46} color={index === 2 ? '#1C1917' : theme.colors.field} strokeWidth={2.2} />
    </Animated.View>
  );
}

/**
 * Android and iOS hero: the same story as the web, lighter (owner override 4). Reanimated drives one clock; the
 * pen opens each handwritten field, red underlines read them, the ways in fly into the phone, the app prints in,
 * the Checked stamp drops and the app keeps saving offline. Reduced motion shows the still final frame.
 */
export function HeroStage({ wide }: HeroStageProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const motion = useAmbientMotion();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<StoryStatus>(DONE);
  const [play, setPlay] = useState<PlayState>('playing');
  const clock = useSharedValue(0);
  const onThisPhone = t('landing.stage.onThisPhone');
  const checked = t('stamp.checked');
  const date = stampDate(localeFor(theme.uiLanguage));

  useEffect(() => { void loadScriptFonts(['devanagari']).catch(() => undefined); }, []);

  const run = useCallback(() => {
    const left = Math.max(0, T.end - clock.get());
    clock.set(withTiming(T.end, { duration: left * 1000, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(setPlay)('done');
    }));
  }, [clock]);

  // Plays while the app is in front and the person has not paused it; never under reduced motion.
  useEffect(() => {
    if (theme.reducedMotion) { cancelAnimation(clock); clock.set(T.end); return; }
    if (motion && play === 'playing') run();
    else cancelAnimation(clock);
  }, [motion, play, theme.reducedMotion, clock, run]);

  useAnimatedReaction(
    () => {
      const v = clock.value;
      return stepAt(v) * 4 + (v >= T.route ? 2 : 0) + (v >= T.offline ? 1 : 0);
    },
    (code, prev) => {
      if (code === prev) return;
      runOnJS(setStatus)({ step: Math.floor(code / 4) as StoryStatus['step'], route: (code & 2) > 0, offline: (code & 1) > 0 });
    },
  );

  const control = theme.reducedMotion
    ? undefined
    : {
        state: play,
        onPress: () => {
          if (play === 'done') { clock.set(0); setPlay('playing'); run(); return; }
          setPlay(play === 'playing' ? 'paused' : 'playing');
        },
      };

  const layout = area.width > 0 ? stageLayout(area.width, area.height) : null;
  return (
    <HeroField wide={wide} status={theme.reducedMotion ? DONE : status} control={control} onAreaLayout={setArea}>
      <View accessible role="img" accessibilityLabel={t('landing.stage.label')} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}>
        {!layout ? null : theme.reducedMotion ? (
          <HeroPoster paper={layout.paper} phone={layout.phone} stamp={layout.stamp} app={finalApp(onThisPhone)} stampLabel={checked} stampDate={date} />
        ) : (
          <Story area={area} paper={layout.paper} phone={layout.phone} stamp={layout.stamp} clock={clock} onThisPhone={onThisPhone} checked={checked} date={date} />
        )}
      </View>
    </HeroField>
  );
}

function Story({ area, paper, phone, stamp, clock, onThisPhone, checked, date }: {
  area: { width: number; height: number }; paper: Rect; phone: Rect; stamp: StampPlace; clock: SharedValue<number>; onThisPhone: string; checked: string; date: string;
}) {
  const sw = paper.w * stamp.w;
  const stampStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (clock.value - T.stamp) / 0.26));
    const drop = p * p * p; // the one ease-in: the stamp falls, then lands
    return { opacity: Math.min(1, p * 1.6), transform: [{ scale: 1.5 - 0.5 * drop }, { rotate: `${stamp.rotate + 4}deg` }] };
  });
  const screenStyle = useAnimatedStyle(() => ({ height: Math.min(1, Math.max(0, (clock.value - T.reveal) / 1.0)) * phone.h }));
  const offlineStyle = useAnimatedStyle(() => ({ opacity: clock.value >= T.offline ? 1 : 0 }));
  const built = { name: ORDER.customer, balance: BALANCE, offline: false, saved: false, onThisPhone };
  const bezel = (phone.w * BEZEL) / (SCREEN.w + BEZEL * 2);
  const chipSize = Math.max(40, Math.min(56, area.width * 0.07));
  const sq = { w: chipSize, h: chipSize };
  const slots = hoverSlots(area.width, area.height, { text: sq, photo: sq, voice: sq, video: sq });
  return (
    <>
      <View style={{ position: 'absolute', left: paper.x, top: paper.y, width: paper.w, height: paper.h, transform: [{ rotate: PAPER_TILT }], shadowColor: '#0A0908', shadowOpacity: 0.35, shadowRadius: 22, shadowOffset: { width: 0, height: 16 }, elevation: 8 }}>
        <Image source={SKETCH_BLANK} aria-hidden style={{ width: paper.w, height: paper.h, borderRadius: 3 }} />
        {WRITE_SCHEDULE.map((item) => <WrittenField key={item.key} item={item} page={paper} clock={clock} />)}
        {READ_SCHEDULE.map((item) => <ReadLine key={item.key} item={item} page={paper} clock={clock} />)}
        <Animated.View style={[{ position: 'absolute', left: paper.w * stamp.cx - sw / 2, top: paper.h * stamp.cy - (sw * 0.637) / 2 }, stampStyle]}>
          <PaperStamp label={checked} date={date} width={sw} />
        </Animated.View>
        <Pen page={paper} clock={clock} />
      </View>
      <View style={{ position: 'absolute', left: phone.x, top: phone.y, width: phone.w, height: phone.h, borderRadius: phone.w * PHONE_RADIUS, transform: PHONE_TILT, shadowColor: '#0A0908', shadowOpacity: 0.45, shadowRadius: 26, shadowOffset: { width: -10, height: 20 }, elevation: 12 }}>
        <Svg width={phone.w} height={phone.h}>
          <SvgRect x={0} y={0} width={phone.w} height={phone.h} rx={phone.w * PHONE_RADIUS} fill={APP_THEME.device} />
          {/* The lit, empty screen the app prints onto. */}
          <SvgRect x={bezel} y={bezel} width={phone.w - bezel * 2} height={phone.h - bezel * 2} rx={phone.w * 0.104} fill={APP_THEME.bg} />
        </Svg>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: phone.w, overflow: 'hidden' }, screenStyle]}>
          <OrderPhone width={phone.w} state={built} />
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, offlineStyle]}>
            <OrderPhone width={phone.w} state={finalApp(onThisPhone)} />
          </Animated.View>
        </Animated.View>
      </View>
      {CHIPS.map((chip, i) => <Chip key={chip.key} chip={chip} index={i} size={chipSize} slot={slots[chip.key]} phone={phone} clock={clock} />)}
    </>
  );
}
