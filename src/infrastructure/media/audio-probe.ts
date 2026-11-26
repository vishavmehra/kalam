/** Duration of a local recording (docs/06 §8.2), read by expo-audio on web, Android and iOS. */
import { createAudioPlayer } from 'expo-audio';

/** Seconds, or undefined when the player cannot tell within `timeoutMs`. Never throws. */
export function probeAudioDuration(uri: string, timeoutMs = 5000): Promise<number | undefined> {
  return new Promise((resolve) => {
    let player: ReturnType<typeof createAudioPlayer> | undefined;
    let sub: { remove(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (value: number | undefined) => {
      if (timer) clearTimeout(timer);
      sub?.remove();
      try { player?.remove(); } catch { /* already released */ }
      player = undefined;
      resolve(value);
    };
    try {
      player = createAudioPlayer(uri);
      const ready = () => player && player.isLoaded && player.duration > 0;
      if (ready()) return done(player.duration);
      sub = player.addListener('playbackStatusUpdate', (s) => {
        if (s.isLoaded && s.duration > 0) done(s.duration);
      });
      timer = setTimeout(() => done(undefined), timeoutMs);
    } catch {
      done(undefined);
    }
  });
}
