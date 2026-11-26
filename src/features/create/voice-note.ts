/**
 * Removing the voice note, the same from the tray and from the Voice panel: a kept recording is deleted
 * too, not only forgotten (lead decision 3, docs/11 §7.3). The store never touches `audioUri` itself.
 */
import { discardRecording } from '@/infrastructure/platform/media-audio';
import type { VoiceAttachment } from '@/features/input/normalize';

export function removeVoiceNote(voice: VoiceAttachment | undefined, setVoice: (v: undefined) => void): void {
  if (voice?.audioUri) void discardRecording(voice.audioUri);
  setVoice(undefined);
}
