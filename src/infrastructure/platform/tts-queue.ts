/**
 * Speech queue (docs/10 §4.4 "Announcement priority", docs/03 §19.5). Every spoken line in Kalam,
 * from read-aloud to the voice agent, goes through one queue so that:
 *  - lines never overlap,
 *  - a higher priority line (an error) can cut in front of a lower one (a screen title),
 *  - identical lines and rapid low-priority lines are coalesced instead of flooding the listener,
 *  - the person can stop everything, or hear the last line again.
 *
 * Pure TypeScript. The adapter does the actual talking.
 */
import { normalizeSpeechText, type SpeakOptions, type TextToSpeechAdapter } from './tts.shared';

/** docs/10 §4.4 priorities, 1 = most urgent. */
export const SPEECH_PRIORITY = { critical: 1, completion: 2, result: 3, navigation: 4, info: 5 } as const;
export type SpeechPriorityName = keyof typeof SPEECH_PRIORITY;

export interface SpeakRequest extends Omit<SpeakOptions, 'interrupt'> {
  text: string;
  /** Default 'result'. */
  priority?: SpeechPriorityName;
  /** Stop whatever is playing and drop everything waiting, then speak this. */
  interrupt?: boolean;
  /**
   * Latest wins: a waiting line with the same key is replaced, and a line with the same key that is
   * playing right now is cut off (it is out of date).
   */
  key?: string;
}

export interface SpeechQueue {
  /** Returns false when the line was dropped (empty, or a repeat of something just said). */
  say(request: SpeakRequest): boolean;
  stop(): void;
  /** Says the most recent line again. Returns false when nothing has been said yet. */
  repeatLast(): boolean;
  isSpeaking(): boolean;
  pendingCount(): number;
  lastText(): string | undefined;
  subscribe(listener: (speaking: boolean) => void): () => void;
}

export interface SpeechQueueOptions {
  adapter: TextToSpeechAdapter;
  now?: () => number;
  /** An identical line within this window is treated as a double fire and dropped. */
  coalesceMs?: number;
  /** Most lines waiting at once; the least urgent, oldest line is dropped first. */
  maxPending?: number;
}

interface Item {
  text: string;
  rank: number;
  seq: number;
  key?: string;
  request: SpeakRequest;
}

export function createSpeechQueue(opts: SpeechQueueOptions): SpeechQueue {
  const { adapter } = opts;
  const now = opts.now ?? (() => Date.now());
  const coalesceMs = opts.coalesceMs ?? 2000;
  const maxPending = opts.maxPending ?? 3;

  let pending: Item[] = [];
  let current: Item | undefined;
  let generation = 0;
  let seq = 0;
  let finished: { text: string; at: number } | undefined;
  let last: Item | undefined;
  const listeners = new Set<(speaking: boolean) => void>();

  const notify = () => {
    const speaking = current !== undefined;
    listeners.forEach((l) => l(speaking));
  };

  function cancelCurrent() {
    if (!current) return;
    generation += 1;
    current = undefined;
    void adapter.stop().catch(() => undefined);
  }

  function pump() {
    if (current || pending.length === 0) return;
    let bestAt = 0;
    pending.forEach((p, i) => {
      const b = pending[bestAt]!;
      if (p.rank < b.rank || (p.rank === b.rank && p.seq < b.seq)) bestAt = i;
    });
    const [item] = pending.splice(bestAt, 1);
    if (!item) return;
    current = item;
    last = item;
    const gen = ++generation;
    notify();
    const { text, request } = item;
    const speakOpts: SpeakOptions = { language: request.language, voiceId: request.voiceId, rate: request.rate };
    // A missing or failing voice must never stall the queue or break the app (docs/10 §4.4).
    void adapter.speak(text, speakOpts).catch(() => undefined).then(() => {
      if (gen !== generation) return;
      current = undefined;
      finished = { text, at: now() };
      notify();
      pump();
    });
  }

  const queue: SpeechQueue = {
    say(request) {
      const text = normalizeSpeechText(request.text);
      if (!text) return false;
      const rank = SPEECH_PRIORITY[request.priority ?? 'result'];
      const key = request.key;
      const item: Item = { text, rank, seq: ++seq, key, request: { ...request, text } };

      if (!request.interrupt) {
        // Double fires (a toast and a follow-up both saying "Saved") are spoken once.
        if (current?.text === text || pending.some((p) => p.text === text)) return false;
        if (finished && finished.text === text && now() - finished.at < coalesceMs) return false;
      }

      if (request.interrupt) {
        cancelCurrent();
        pending = [];
      } else if (current) {
        if (key !== undefined && current.key === key) {
          cancelCurrent();
        } else if (rank < current.rank) {
          // A more urgent line cuts in; stale less urgent lines waiting behind it are dropped.
          cancelCurrent();
          pending = pending.filter((p) => p.rank <= rank);
        }
      }

      if (key !== undefined) pending = pending.filter((p) => p.key !== key);
      // Rapid navigation and info lines: only the newest one is still worth hearing.
      if (rank >= SPEECH_PRIORITY.navigation) pending = pending.filter((p) => p.rank < SPEECH_PRIORITY.navigation);

      pending.push(item);
      while (pending.length > maxPending) {
        let worst = 0;
        pending.forEach((p, i) => {
          const w = pending[worst]!;
          if (p.rank > w.rank || (p.rank === w.rank && p.seq < w.seq)) worst = i;
        });
        pending.splice(worst, 1);
      }
      pump();
      return true;
    },

    stop() {
      pending = [];
      const wasSpeaking = current !== undefined;
      cancelCurrent();
      if (wasSpeaking) notify();
    },

    repeatLast() {
      if (!last) return false;
      return queue.say({ ...last.request, interrupt: true });
    },

    isSpeaking: () => current !== undefined,
    pendingCount: () => pending.length,
    lastText: () => last?.text,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return queue;
}
