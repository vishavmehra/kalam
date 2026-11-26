import { describe, expect, it } from 'vitest';
import type { MediaAttachment } from '@/core/media';
import { addAttachment, createSession, setTranscript } from '@/core/session';
import type { CreationDraft } from '@/features/input/normalize';
import { buildNormalizedInput } from '@/features/input/normalize';
import { createBlocker, createBlockerKey, draftWithSession } from './create-bridge';

const empty: CreationDraft = { text: '', photos: [], preferences: { language: 'en' } };
const audio: MediaAttachment = { id: 'a1', type: 'audio', mimeType: 'audio/mp4', sizeBytes: 100, status: 'ready', createdAt: 1, updatedAt: 1 };

function withRecording(text: string) {
  const s = addAttachment(createSession('s_1', 1), audio, 2).session;
  return setTranscript(s, { attachmentId: 'a1', text, original: text, source: 'device', status: 'complete' }, 3);
}

describe('the create button counts the media session too', () => {
  it('is blocked with nothing at all', () => {
    expect(createBlockerKey(empty, undefined)).toBe('create.ws.blockEmpty');
    expect(createBlockerKey(empty, createSession('s_1', 1))).toBe('create.ws.blockEmpty');
    expect(createBlocker(empty, undefined)).toBeTruthy();
  });

  it('is open when an attached recording has words, with no typed text', () => {
    expect(createBlockerKey(empty, withRecording('track my daily milk sales'))).toBeUndefined();
    expect(createBlocker(empty, withRecording('track my daily milk sales'))).toBeUndefined();
  });

  it('stays blocked for a recording that produced no words', () => {
    expect(createBlockerKey(empty, withRecording('   '))).toBe('create.ws.blockEmpty');
  });

  it('still reports a too-long description whatever the session holds', () => {
    const long = { ...empty, text: 'x'.repeat(4001) };
    expect(createBlockerKey(long, withRecording('words'))).toBe('create.ws.blockLong');
  });
});

describe('a build queued offline freezes what "Create app" would send now', () => {
  it('returns the draft itself when there is no session', () => {
    const d: CreationDraft = { ...empty, text: 'milk sales' };
    expect(draftWithSession(d, undefined)).toBe(d);
  });

  it('folds the words of an attached recording into the spoken text, so the queued build hears them too', () => {
    const d: CreationDraft = { ...empty, text: 'milk sales' };
    const frozen = draftWithSession(d, withRecording('track my daily milk sales'));
    expect(frozen.voice?.transcript).toContain('track my daily milk sales');
    expect(buildNormalizedInput(frozen).audioTranscript).toContain('track my daily milk sales');
    expect(frozen.text).toBe('milk sales');
  });

  it('keeps a draft with nothing to add exactly as it is', () => {
    const d: CreationDraft = { ...empty, text: 'milk sales' };
    expect(draftWithSession(d, createSession('s_1', 1))).toEqual(d);
  });
});
