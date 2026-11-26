/**
 * Shelf read-aloud with Pause, Resume, Stop and Repeat (docs/10 §4.4). The shelf summary is read one sentence at a
 * time through the shared speech queue, so Pause can stop where the sentence ends and Resume can say that sentence
 * again, which every speech engine can do (not all can pause mid-word). Pure controller: the speech functions are
 * passed in, so it is tested without a device.
 */
export type ReaderStatus = 'idle' | 'reading' | 'paused' | 'done';

export interface ReaderSpeech {
  /** Queues one line. False when the line was dropped (empty, or said a moment ago). */
  say(text: string): boolean;
  stop(): void;
  /** Called with true when a line starts and false when it ends or is stopped. Returns an unsubscribe. */
  subscribe(listener: (speaking: boolean) => void): () => void;
}

export interface ShelfReader {
  start(sentences: readonly string[]): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Says the current sentence again from its start. */
  repeat(): void;
  status(): ReaderStatus;
  /** Position of the sentence being read, 0-based. */
  index(): number;
  onChange(listener: (status: ReaderStatus) => void): () => void;
  dispose(): void;
}

/** The sentences of the shelf summary: the count line, then each app by name (at most `max`, so it stays short). */
export function shelfSentences(countLine: string, names: readonly string[], max = 6): string[] {
  const named = names.map((n) => n.trim()).filter(Boolean).slice(0, max);
  return [countLine, ...named].map((s) => s.trim()).filter(Boolean);
}

export function createShelfReader(speech: ReaderSpeech): ShelfReader {
  let sentences: readonly string[] = [];
  let i = 0;
  let status: ReaderStatus = 'idle';
  /** True once the current sentence has really started: only then does "stopped speaking" mean "finished". */
  let began = false;
  /** Set while this controller stops the speech itself: that "stopped" is not a sentence ending. */
  let muted = false;
  const listeners = new Set<(s: ReaderStatus) => void>();
  const set = (s: ReaderStatus) => {
    if (s === status) return;
    status = s;
    listeners.forEach((l) => l(s));
  };

  const halt = () => {
    muted = true;
    try { speech.stop(); } finally { muted = false; }
  };

  const speakCurrent = () => {
    began = false;
    if (i >= sentences.length) { set('done'); return; }
    // A line the queue refuses (empty text) is skipped, so a blank app name never stalls the reading.
    if (!speech.say(sentences[i]!)) { i += 1; speakCurrent(); }
  };

  const off = speech.subscribe((speaking) => {
    if (status !== 'reading' || muted) return;
    if (speaking) { began = true; return; }
    if (!began) return;
    i += 1;
    speakCurrent();
  });

  return {
    start(next) {
      halt();
      sentences = next;
      i = 0;
      if (!sentences.length) { set('done'); return; }
      set('reading');
      speakCurrent();
    },
    pause() {
      if (status !== 'reading') return;
      set('paused');
      halt();
    },
    resume() {
      if (status !== 'paused') return;
      set('reading');
      speakCurrent();
    },
    stop() {
      if (status === 'idle') return;
      set('idle');
      i = 0;
      halt();
    },
    repeat() {
      if (!sentences.length) return;
      if (status === 'idle' || status === 'done') i = 0;
      set('reading');
      halt();
      speakCurrent();
    },
    status: () => status,
    index: () => i,
    onChange(l) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    dispose() {
      off();
      listeners.clear();
      if (status === 'reading') halt();
    },
  };
}
