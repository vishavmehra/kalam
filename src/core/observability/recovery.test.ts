import { describe, expect, it } from 'vitest';
import { describeAIError, type RecoveryAction } from '../ai/errors';
import { createRecoveryLog, RECOVERY_ACTIONS, RECOVERY_OUTCOMES } from './recovery';
import { createTimingLog, TIMING_NAMES } from './timing';

describe('recovery log', () => {
  it('keeps only a known code, a listed action, a listed outcome and a time', () => {
    const log = createRecoveryLog(5, () => 42);
    const kept = log.note({
      code: 'timeout', outcome: 'applied', action: 'retry',
      // Anything else a caller adds is not copied.
      ...({ message: 'Asha clinic prompt', appId: 'app_secret', note: 'SENTINEL' } as object),
    });
    expect(kept).toEqual({ code: 'timeout', outcome: 'applied', action: 'retry', at: 42 });
    expect(JSON.stringify(log.recent())).not.toMatch(/Asha|app_secret|SENTINEL/);
  });

  it('turns an unknown code into other, drops an unknown action and refuses an unknown outcome', () => {
    const log = createRecoveryLog();
    expect(log.note({ code: 'Error: could not read Asha.pdf', outcome: 'shown', action: 'wipe_everything' })).toMatchObject({ code: 'other' });
    expect(log.recent()[0]).not.toHaveProperty('action');
    expect(log.note({ code: 'offline', outcome: 'whatever' })).toBeUndefined();
    expect(log.note(undefined as never)).toBeUndefined();
    expect(log.recent()).toHaveLength(1);
  });

  it('lists newest first, stays within its capacity, notifies and clears', () => {
    let t = 0;
    const log = createRecoveryLog(2, () => ++t);
    const seen: number[] = [];
    const off = log.subscribe(() => seen.push(log.version()));
    log.note({ code: 'offline', outcome: 'shown' });
    log.note({ code: 'quota', outcome: 'shown' });
    log.note({ code: 'timeout', outcome: 'dismissed' });
    expect(log.recent().map((e) => e.code)).toEqual(['timeout', 'quota']);
    expect(seen).toEqual([1, 2, 3]);
    off();
    log.clear();
    expect(log.recent()).toEqual([]);
    expect(seen).toHaveLength(3);
  });

  it('covers every recovery step the AI layer can offer', () => {
    // core/ai/errors.ts RecoveryAction (minus "none") must be a typed action here too.
    const ai: Array<Exclude<RecoveryAction, 'none'>> = ['retry', 'retry_later', 'retry_when_online', 'turn_on_cloud', 'prepare_on_device', 'change_input'];
    for (const step of ai) expect(RECOVERY_ACTIONS).toContain(step);
    for (const code of ['offline', 'timeout', 'quota', 'consent_denied', 'model_unavailable', 'bad_request'] as const) {
      const step = describeAIError(code).recovery;
      if (step !== 'none') expect(RECOVERY_ACTIONS).toContain(step);
    }
    expect(RECOVERY_OUTCOMES).toEqual(['shown', 'applied', 'dismissed', 'failed']);
  });
});

describe('timing of local media steps', () => {
  it('names the steps of docs/06 §17.3 and keeps the earlier order', () => {
    expect(TIMING_NAMES.slice(0, 3)).toEqual(['app_open', 'spec_validate', 'record_write']);
    for (const name of [
      'attachment_intake', 'media_validate', 'media_preprocess', 'thumbnail', 'audio_transcribe', 'video_frames', 'drawing_export',
      'context_assemble', 'request_prepare',
    ]) expect(TIMING_NAMES).toContain(name);
  });

  it('marks a step that reports failure as a value, and one that throws', async () => {
    let t = 0;
    const log = createTimingLog({ clock: () => (t += 10) });
    expect(await log.time('audio_transcribe', async () => ({ ok: false }), (r) => r.ok)).toEqual({ ok: false });
    expect(await log.time('audio_transcribe', async () => ({ ok: true }), (r) => r.ok)).toEqual({ ok: true });
    expect(log.time('media_validate', () => 5, (n) => n > 9)).toBe(5);
    await expect(log.time('video_frames', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(log.events().map((e) => [e.name, e.ok])).toEqual([
      ['audio_transcribe', false], ['audio_transcribe', true], ['media_validate', false], ['video_frames', false],
    ]);
    expect(log.summarize().find((s) => s.name === 'audio_transcribe')).toMatchObject({ runs: 2, failed: 1 });
  });

  it('does not carry what was processed: an event has only a name, a duration, a time, a flag and a count', () => {
    const log = createTimingLog();
    log.record('thumbnail', 3, { count: 2, ...({ file: 'Asha-aadhaar.jpg' } as object) });
    expect(Object.keys(log.events()[0]!).sort()).toEqual(['at', 'count', 'name', 'ms', 'ok'].sort());
  });
});
