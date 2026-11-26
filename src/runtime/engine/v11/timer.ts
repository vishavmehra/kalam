/**
 * Timer component logic (KalamSpec 1.1). Time is kept as timestamps, not ticks, so a timer stays
 * right when the screen sleeps or the tab is in the background. Pure: `now` is always passed in.
 */
import type { ComponentOf } from '@/core/spec/schema';
import { v11Words } from './copy';

export interface TimerState {
  running: boolean;
  /** Epoch ms of the last start or resume. */
  startedAt?: number;
  /** Time already counted before the last start. */
  accumulatedMs: number;
}

export const TIMER_IDLE: TimerState = { running: false, accumulatedMs: 0 };

export function elapsedMs(s: TimerState, now: number): number {
  return s.accumulatedMs + (s.running && s.startedAt !== undefined ? Math.max(0, now - s.startedAt) : 0);
}

export function startTimer(s: TimerState, now: number): TimerState {
  return s.running ? s : { running: true, startedAt: now, accumulatedMs: s.accumulatedMs };
}

export function pauseTimer(s: TimerState, now: number): TimerState {
  return s.running ? { running: false, accumulatedMs: elapsedMs(s, now) } : s;
}

export const resetTimer = (): TimerState => TIMER_IDLE;

/** Countdown only: time left, never below zero. */
export function remainingMs(c: ComponentOf<'timer'>, s: TimerState, now: number): number | undefined {
  if (c.mode !== 'countdown' || c.durationSec === undefined) return undefined;
  return Math.max(0, c.durationSec * 1000 - elapsedMs(s, now));
}

export function isFinished(c: ComponentOf<'timer'>, s: TimerState, now: number): boolean {
  return remainingMs(c, s, now) === 0;
}

/** Stops a countdown at exactly its length (call on each tick). */
export function settle(c: ComponentOf<'timer'>, s: TimerState, now: number): TimerState {
  if (!s.running || !isFinished(c, s, now)) return s;
  return { running: false, accumulatedMs: (c.durationSec ?? 0) * 1000 };
}

/** 75_000 → "1:15", 3_725_000 → "1:02:05". Countdowns round up so 0:00 means done. */
export function formatClock(ms: number, roundUp = false): string {
  const total = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "2 minutes 5 seconds" for screen readers and Read-aloud. */
export function spokenDuration(ms: number, lang?: string | null): string {
  const words = v11Words(lang);
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const parts = [h ? words.hours(h) : '', m ? words.minutes(m) : '', sec || (!h && !m) ? words.seconds(sec) : ''];
  return parts.filter(Boolean).join(' ');
}

/** Value written to the bound field: time actually run, in the timer's unit (minutes to 0.1). */
export function timerFieldValue(c: ComponentOf<'timer'>, s: TimerState, now: number): number {
  const ms = c.mode === 'countdown' && c.durationSec !== undefined ? Math.min(elapsedMs(s, now), c.durationSec * 1000) : elapsedMs(s, now);
  return c.unit === 'minutes' ? Math.round(ms / 6000) / 10 : Math.round(ms / 1000);
}
