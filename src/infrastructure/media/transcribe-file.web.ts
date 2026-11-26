/**
 * Web: browsers' speech recognition only listens to a microphone; it cannot read a file. Kalam says
 * so instead of pretending (docs/06 §1.2.12) and the person types the transcript. So on the web build
 * (the judging build) an attached audio file is a manual-transcript input: it can be played, but its
 * text is typed by the person. Sending the file to Firebase cloud AI needs an audio media type in the
 * AI contract (CONTRACT CHANGE REQUEST in the report).
 */
import { audioCopy } from '@/core/media/copy';
import type { TranscribeFileOptions, TranscribeOutcome } from './transcribe-file.shared';

export * from './transcribe-file.shared';

export const canTranscribeFiles = (_isVideo = false) => false;

export async function transcribeFile(_opts: TranscribeFileOptions): Promise<TranscribeOutcome> {
  return { ok: false, reason: 'unsupported', message: audioCopy.webUnsupported };
}
