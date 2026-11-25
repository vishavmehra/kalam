/**
 * Which speech recognition path a voice feature may use (docs/10 §16.4, docs/06 §2.3).
 *  - on-device recognition keeps the audio in the browser or phone: always allowed,
 *  - the platform's online speech service hears the audio: needs the person's OK, and is not
 *    allowed when Settings say offline only or cloud AI is off.
 * Pure TypeScript.
 */
import type { SpeechCapability } from './speech.shared';

export type SpeechPath =
  | { kind: 'on_device' }
  | { kind: 'needs_consent'; canDownload: boolean }
  | { kind: 'cloud_service' }
  | { kind: 'blocked'; reason: 'offline_only' | 'cloud_off'; canDownload: boolean }
  | { kind: 'unsupported' };

export interface SpeechPolicyInput {
  aiMode: 'hybrid' | 'offline_only';
  allowCloud: boolean;
  /** The person agreed to use the online speech service in this session. */
  consent: boolean;
}

export function chooseSpeechPath(cap: SpeechCapability | undefined, input: SpeechPolicyInput): SpeechPath {
  if (!cap || !cap.supported) return { kind: 'unsupported' };
  if (cap.onDevice === 'available') return { kind: 'on_device' };
  const canDownload = cap.onDevice === 'downloadable' || cap.onDevice === 'downloading';
  if (input.aiMode === 'offline_only') return { kind: 'blocked', reason: 'offline_only', canDownload };
  if (!input.allowCloud) return { kind: 'blocked', reason: 'cloud_off', canDownload };
  return input.consent ? { kind: 'cloud_service' } : { kind: 'needs_consent', canDownload };
}

/** Plain-language reason shown when listening cannot start. */
export function blockedMessage(path: Extract<SpeechPath, { kind: 'blocked' | 'unsupported' }>): string {
  if (path.kind === 'unsupported') {
    return 'Voice is not available on this device. You can type a command instead.';
  }
  return path.reason === 'offline_only'
    ? 'Offline only is on, and this device needs the internet to hear you. You can type a command instead.'
    : 'Online AI is off in Settings, and this device needs the internet to hear you. You can type a command instead.';
}
