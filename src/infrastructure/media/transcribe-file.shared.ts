/** Result of turning an attached recording into text (docs/06 §8.3-8.4). */
import type { DetectedLanguage } from '@/core/media/language';
import type { TranscriptSegment } from '@/core/media/types';
import type { SpeechPolicyInput } from '@/infrastructure/platform/speech-policy';

export type TranscribeOutcome =
  | {
      ok: true;
      text: string;
      segments: TranscriptSegment[];
      /** Where recognition really ran (shown to the person). */
      location: 'on_device' | 'cloud_service';
      language?: DetectedLanguage;
      partial: boolean;
    }
  | { ok: false; reason: 'unsupported' | 'android_too_old' | 'format' | 'needs_consent' | 'blocked' | 'failed' | 'cancelled'; message: string };

export interface TranscribeFileOptions {
  uri: string;
  /** Speech language (BCP-47 or app code). */
  lang: string;
  /** First bytes of the file (sample rate and channels for Android). */
  head: Uint8Array;
  /**
   * Same rules as every other voice feature (speech-policy.ts, docs/10 §16.4): on-device recognition
   * always; the platform's online speech service only in hybrid mode with cloud allowed AND the
   * person's OK for this session (`consent`).
   */
  policy: SpeechPolicyInput;
  /** The file is a video (only iOS can read the sound of a video file). */
  isVideo?: boolean;
  signal?: AbortSignal;
}
