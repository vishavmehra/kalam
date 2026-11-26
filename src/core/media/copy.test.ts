import { describe, expect, it } from 'vitest';
import { setActiveLanguage, td } from '@/i18n/active';
import en from '@/i18n/locales/en.json';
import { copy as templatesCopy } from '@/features/templates/copy';
import {
  attachmentCopy, audioCopy, conflictCopy, handoffCopy, mediaErrorMessage, SESSION_LABEL, sessionCopy, setMediaWords, STATUS_LABEL, videoCopy,
  workflowCopy, KIND_WORD,
} from './copy';
import { MEDIA_EN } from './copy-en';
import type { MediaErrorCode } from './types';

/** Every string value reachable in a copy object, calling the functions with plain sample arguments. */
function strings(value: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (typeof value === 'function') {
    const fn = value as (...a: unknown[]) => unknown;
    const tries: unknown[][] = [[2], ['Ana'], [2, 'Ana'], [2, 'fields', 'Ana'], ['Ana', 'Bo'], [{ n: 2, where: 'A' }, { n: 3, where: 'b' }, 'says'], ['Ana', 'Bo', 'spoke'], [['two photos'], 6], ['drawing', 2], [2, '0:05']];
    for (const args of tries) {
      try {
        const r = fn(...args);
        if (typeof r === 'string' && r.trim()) { out.push([`${path}()`, r]); break; }
      } catch { /* a different sample */ }
    }
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

/** The `media` part of en.json as flat keys, a plural as [one, other]. */
function flatten(o: Record<string, unknown>, path: string, out: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  for (const [k, v] of Object.entries(o)) {
    const p = `${path}.${k}`;
    if (typeof v === 'string') out[p] = v;
    else if (v && typeof v === 'object' && 'other' in v) out[p] = [String((v as Record<string, unknown>).one), String((v as Record<string, unknown>).other)];
    else flatten(v as Record<string, unknown>, p, out);
  }
  return out;
}

describe('the core speaks English until the app gives it a language', () => {
  it('has the same words as the media part of the catalogue, key for key', () => {
    expect(MEDIA_EN).toEqual(flatten(en.media as Record<string, unknown>, 'media'));
  });

  it('says the same thing through the catalogue in English as from its own table', () => {
    const sample = () => [
      mediaErrorMessage('FILE_TOO_LARGE', { type: 'video', durationSec: 200, limitSec: 60 }), mediaErrorMessage('SPEECH_CONSENT_REQUIRED', { type: 'audio', service: 'the speech service' }),
      conflictCopy.fieldCount({ n: 1, where: 'A' }, { n: 5, where: 'b' }, 'shows'), conflictCopy.heading, STATUS_LABEL.processing_local, SESSION_LABEL.compilation_failed,
      workflowCopy.describedBy.on_device, audioCopy.notKept, attachmentCopy.droppedSkipped(3), handoffCopy.notesLeftOut(1), handoffCopy.excludedPart('photo', 2), sessionCopy.restoredMissing(1),
    ];
    setMediaWords(undefined);
    const own = sample();
    setActiveLanguage('en');
    setMediaWords((key, params) => td(key, params));
    try {
      expect(sample()).toEqual(own);
    } finally {
      setMediaWords(undefined);
    }
  });
});

describe('media and template words come from the catalogue', () => {
  it('every getter and function gives real English, never a missing key', () => {
    setActiveLanguage('en');
    const groups: Record<string, unknown> = {
      KIND_WORD, STATUS_LABEL, SESSION_LABEL, conflictCopy, workflowCopy, audioCopy, videoCopy, attachmentCopy, handoffCopy, sessionCopy, templatesCopy,
    };
    const all = Object.entries(groups).flatMap(([name, g]) => strings(g, name));
    expect(all.length).toBeGreaterThan(200);
    for (const [path, text] of all) {
      expect(text.trim(), path).not.toBe('');
      expect(text, path).not.toMatch(/^(media|templates)\.[A-Za-z_.]+$/);
      expect(text, path).not.toMatch(/\{[A-Za-z_]+\}/); // a placeholder nobody filled
    }
  });

  it('gives a plain sentence for every error code', () => {
    const codes: MediaErrorCode[] = [
      'PERMISSION_DENIED', 'FILE_UNSUPPORTED', 'FILE_TOO_LARGE', 'FILE_CORRUPTED', 'IMAGE_DECODE_FAILED', 'AUDIO_RECORDING_FAILED',
      'AUDIO_TRANSCRIPTION_FAILED', 'VIDEO_DECODE_FAILED', 'VIDEO_EXTRACTION_FAILED', 'DRAWING_EXPORT_FAILED', 'ATTACHMENT_STORAGE_FAILED',
      'CONTEXT_BUILD_FAILED', 'COMPILER_INPUT_TOO_LARGE', 'CLOUD_CONSENT_REQUIRED', 'NETWORK_UNAVAILABLE', 'PROCESSING_INTERRUPTED',
      'ATTACHMENT_MISSING', 'SPEECH_CONSENT_REQUIRED', 'SPEECH_BLOCKED',
    ];
    for (const code of codes) {
      const m = mediaErrorMessage(code, { type: 'audio', service: "Android's speech service" });
      expect(m, code).toMatch(/^[A-Z]/);
      expect(m, code).not.toMatch(/[{}]|^media\./);
    }
  });

  it('keeps the wording people already saw', () => {
    setActiveLanguage('en');
    expect(mediaErrorMessage('FILE_TOO_LARGE', { type: 'video', durationSec: 200, limitSec: 60 })).toBe('This video is 3 minutes long. Choose one that is 60 seconds or shorter, or trim it first.');
    expect(mediaErrorMessage('FILE_TOO_LARGE', { type: 'image', sizeBytes: 12 * 1024 * 1024, limitBytes: 10 * 1024 * 1024 })).toBe('This picture is 12 MB. The limit is 10 MB. Compress it, trim it or choose another file.');
    expect(mediaErrorMessage('FILE_UNSUPPORTED', { type: 'image', sniffed: 'audio' })).toBe('This file is a sound recording, not a picture. Choose another file.');
    expect(conflictCopy.fieldCount({ n: 1, where: 'Your description' }, { n: 5, where: 'your drawing' }, 'shows')).toBe('Your description says 1 field, but your drawing shows 5. Which should Kalam use?');
    expect(attachmentCopy.droppedSkipped(1)).toBe('1 file was not a picture and was skipped.');
    expect(handoffCopy.excluded([handoffCopy.excludedPart('video_frame', 1), handoffCopy.excludedPart('photo', 2)], 6)).toBe(
      'Kalam can send 6 pictures at a time, so these were left out: 1 video frame, 2 photos. Remove some pictures if you want them included.',
    );
    expect(sessionCopy.restoredMissing(2)).toBe('Your last session is back. 2 files are no longer on this device.');
    expect(templatesCopy.search.results(1)).toBe('1 template');
    expect(templatesCopy.search.results(5)).toBe('5 templates');
    expect(templatesCopy.packs.modesLine(['large mode', 'simple mode', 'read aloud'])).toContain('large mode, simple mode and read aloud');
  });

  it('keeps what the compiler reads in English whatever the interface language', () => {
    setActiveLanguage('en');
    expect(workflowCopy.defaultName).toBe('What the video shows');
    expect(workflowCopy.summaryHeading('Order')).toBe('Workflow: Order');
    expect(conflictCopy.correctionCount(3, 'fields', 'your drawing')).toBe('Use 3 fields, as in your drawing.');
    expect(handoffCopy.photoName(2)).toBe('Photo 2');
    expect(handoffCopy.frameLabel(1, '0:02')).toBe('Video frame 1 at 0:02');
  });
});
