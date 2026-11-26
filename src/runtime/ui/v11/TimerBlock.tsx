/**
 * Timer (KalamSpec 1.1): countdown or stopwatch with Start/Pause and Reset. Updates twice a second
 * from timestamps, never from a tick count. With a bound field, the time run so far is written to
 * the screen form whenever it changes (at most once a second), so Save always stores the shown time.
 * The timer's own state is kept per app and component for the session, so going to another screen
 * and back neither stops nor loses a running timer.
 */
import { Pause, Play, RotateCcw } from 'lucide-react-native';
import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ComponentOf } from '@/core/spec/schema';
import type { RuntimeTheme } from '../../engine/theme';
import {
  elapsedMs, formatClock, pauseTimer, remainingMs, resetTimer, settle, spokenDuration, startTimer, TIMER_IDLE,
  timerFieldValue, type TimerState,
} from '../../engine/v11';
import { useComponentBounds } from '../../layout';
import { useV11Words } from '../../use-app-t';
import { font, Pressy, tabular } from '../kit';

/** Timers of this session, by `${appId}:${componentId}`. Timestamps, so a timer keeps counting while away. */
const kept = new Map<string, TimerState>();
/** For tests. */
export const clearKeptTimers = (): void => kept.clear();

export interface TimerBlockProps {
  c: ComponentOf<'timer'>;
  t: RuntimeTheme;
  /** Keeps the timer apart from the same component id in another app. */
  appId?: string;
  /** Writes the time into the bound form field (only called when the timer has a `field`); null after Reset. */
  onValue?(value: number | null): void;
  /** Spoken and shown when a countdown reaches zero (KalamRuntime passes its announce + toast). */
  onFinish?(message: string): void;
  /** Read-aloud of the component's readAloud / a11yLabel text when the person uses it. */
  onFocus?(): void;
  /** Language of the words. Absent: the running app's own. */
  lang?: string;
}

export const TimerBlock = memo(function TimerBlock({ c, t, appId = '', onValue, onFinish, onFocus, lang }: TimerBlockProps) {
  const bounds = useComponentBounds(c.id);
  const w = useV11Words(lang);
  const wordsRef = useRef(w);
  wordsRef.current = w;
  const key = `${appId}:${c.id}`;
  const [state, setState] = useState<TimerState>(() => kept.get(key) ?? TIMER_IDLE);
  const [now, setNow] = useState(() => Date.now());
  const stateRef = useRef(state);
  stateRef.current = state;
  // Latest callbacks for the interval, which only restarts when `running` changes.
  const cb = useRef({ onValue, onFinish });
  cb.current = { onValue, onFinish };
  const written = useRef<number | null | undefined>(undefined);

  const write = (value: number | null) => {
    if (!c.field || !cb.current.onValue || written.current === value) return;
    written.current = value;
    cb.current.onValue(value);
  };
  const commit = (next: TimerState, at: number) => {
    setState(next);
    setNow(at);
    if (next === TIMER_IDLE) kept.delete(key);
    else kept.set(key, next);
  };

  // Coming back to a timer that ran before: put its time back into the (new) form.
  useEffect(() => {
    if (state.running || state.accumulatedMs > 0) write(timerFieldValue(c, state, Date.now()));
  }, []);

  useEffect(() => {
    if (!state.running) return undefined;
    const tick = () => {
      const at = Date.now();
      const settled = settle(c, stateRef.current, at);
      write(timerFieldValue(c, settled, at));
      if (settled !== stateRef.current) {
        commit(settled, at);
        cb.current.onFinish?.(wordsRef.current.timeUp(c.label));
      } else setNow(at);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [state.running]);

  const countdown = c.mode === 'countdown';
  const shownMs = countdown ? (remainingMs(c, state, now) ?? 0) : elapsedMs(state, now);
  const finished = countdown && !state.running && state.accumulatedMs > 0 && shownMs === 0;
  const started = state.running || state.accumulatedMs > 0;
  const size = Math.max(t.target, 52);
  // A finished countdown starts again from the top, so it says Start, not Resume.
  const primaryLabel = state.running ? w.pause : started && !finished ? w.resume : w.start;
  const spoken = countdown ? w.timerLeft(spokenDuration(shownMs, lang)) : w.timerValue(spokenDuration(shownMs, lang));

  const toggle = () => {
    onFocus?.();
    const at = Date.now();
    const next = state.running ? pauseTimer(state, at) : startTimer(finished ? resetTimer() : state, at);
    commit(next, at);
    write(timerFieldValue(c, next, at));
  };
  const reset = () => {
    onFocus?.();
    commit(resetTimer(), Date.now());
    write(null);
  };
  const controls = [
    <Pressy
      key="go"
      accessibilityRole="button"
      accessibilityLabel={`${primaryLabel} ${c.label}`}
      onPress={toggle}
      style={[styles.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.primary }]}
    >
      {state.running
        ? <Pause size={22 * t.fontScale} color={t.colors.onPrimary} />
        : <Play size={22 * t.fontScale} color={t.colors.onPrimary} />}
    </Pressy>,
    <Pressy
      key="reset"
      accessibilityRole="button"
      accessibilityLabel={`${w.reset} ${c.label}`}
      accessibilityState={{ disabled: !started }}
      disabled={!started}
      onPress={reset}
      style={[styles.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.primarySoft, borderWidth: t.highContrast ? 2 : 0, borderColor: t.colors.text }]}
    >
      <RotateCcw size={20 * t.fontScale} color={t.colors.primaryText} />
    </Pressy>,
  ];
  return (
    <View
      {...bounds}
      style={[styles.box, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: t.borderWidth, borderRadius: t.radius, padding: t.space }]}
    >
      <View
        accessible
        accessibilityRole="timer"
        accessibilityLabel={`${c.a11yLabel ?? c.label}: ${spoken}`}
        accessibilityHint={c.a11yDescription}
        style={{ flex: 1, gap: 2 }}
      >
        <Text style={[font(t, 14, '500'), { color: t.colors.textMuted }]}>{c.label}</Text>
        <Text style={[font(t, 34, '600', 1.1), tabular, { color: t.colors.text }]}>{formatClock(shownMs, countdown)}</Text>
      </View>
      {/* Left-handed: the main control sits on the leading edge. */}
      <View style={styles.row}>{t.mirror ? controls : [controls[1], controls[0]]}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  btn: { alignItems: 'center', justifyContent: 'center' },
});
