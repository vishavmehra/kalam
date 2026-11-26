import { describe, expect, it } from 'vitest';
import type { NormalizedInput } from '@/core/contracts';
import { draftWorkflow, frameArtifacts, type ContextConflict, type MediaAttachment } from '@/core/media';
import {
  addAttachment, addTextInput, applyEvent, applySession, createSession, imageBudget, nextStatus, parseSession, prepareHandoff,
  reconcileWithDraft, recoverStatus, removeAttachment, replaceAttachment, sessionAddsInput, setConflicts, setFrames, setNote,
  setTranscript, setWorkflow, storedState, updateAttachment, SESSION_STATUSES, type SessionEvent,
} from './index';

const att = (id: string, over: Partial<MediaAttachment> = {}): MediaAttachment => ({
  id, type: 'image', mimeType: 'image/jpeg', sizeBytes: 100, status: 'ready', createdAt: 1, updatedAt: 1, ...over,
});

describe('session state machine', () => {
  it('follows the documented lifecycle', () => {
    const path: SessionEvent[] = ['input_added', 'processing_started', 'processing_finished', 'review_requested', 'compile_started', 'compile_succeeded', 'accepted'];
    let s = createSession('s_1', 1);
    const seen = [s.status as string];
    for (const e of path) { s = applyEvent(s, e, 2); seen.push(s.status); }
    expect(seen).toEqual(['draft', 'collecting', 'preprocessing', 'collecting', 'ready_for_review', 'compiling', 'understanding_review', 'completed']);
  });

  it('keeps every failure recoverable and rejects impossible moves', () => {
    expect(nextStatus('compiling', 'compile_failed')).toBe('compilation_failed');
    expect(nextStatus('compilation_failed', 'compile_started')).toBe('compiling');
    expect(nextStatus('compilation_failed', 'input_added')).toBe('collecting');
    expect(nextStatus('preprocessing', 'processing_failed')).toBe('preprocessing_failed');
    expect(nextStatus('preprocessing_failed', 'processing_started')).toBe('preprocessing');
    expect(nextStatus('cancelled', 'compile_started')).toBe('compiling');
    expect(nextStatus('draft', 'compile_succeeded')).toBeUndefined();
    expect(nextStatus('completed', 'input_added')).toBeUndefined();
    expect(nextStatus('collecting', 'accepted')).toBeUndefined();
    expect(applyEvent(createSession('s_1', 1), 'accepted', 5).status).toBe('draft');
  });

  it('marks running work as interrupted after a restart', () => {
    expect(recoverStatus('compiling')).toBe('interrupted');
    expect(recoverStatus('preprocessing')).toBe('interrupted');
    expect(recoverStatus('understanding_review')).toBe('understanding_review');
    for (const s of SESSION_STATUSES) expect(['draft', 'compiling', 'review', 'saved', 'failed']).toContain(storedState(s));
  });
});

describe('attachments', () => {
  it('tracks status per attachment; one failure leaves the rest usable', () => {
    let s = addAttachment(createSession('s_1', 1), att('a1', { status: 'validating' }), 2).session;
    expect(s.status).toBe('preprocessing');
    s = addAttachment(s, att('a2', { status: 'ready', contentHash: 'h2' }), 3).session;
    s = updateAttachment(s, 'a1', { status: 'failed', error: { code: 'FILE_CORRUPTED', message: 'x' } }, 4);
    expect(s.status).toBe('attachment_failed');
    expect(s.attachments.find((a) => a.id === 'a2')?.status).toBe('ready');
    s = removeAttachment(s, 'a1', 5).session;
    expect(s.status).toBe('collecting');
    s = updateAttachment(s, 'a2', { status: 'ready' }, 6);
    expect(s.attachments).toHaveLength(1);
  });

  it('refuses duplicates by content hash', () => {
    let s = addAttachment(createSession('s_1', 1), att('a1', { contentHash: 'same' }), 2).session;
    const again = addAttachment(s, att('a2', { contentHash: 'same' }), 3);
    expect(again.added).toBe(false);
    expect(!again.added && again.duplicateOf?.id).toBe('a1');
    s = again.session;
    expect(s.attachments).toHaveLength(1);
    const swap = replaceAttachment(s, 'a1', att('a3', { contentHash: 'same' }), 4);
    expect(swap.session.attachments.map((a) => a.id)).toEqual(['a3']); // replacing with the same file is allowed
  });

  it('removes and replaces with everything derived from the attachment', () => {
    let s = createSession('s_1', 1);
    s = addAttachment(s, att('img', { originalAssetId: 's_1.img.orig', previewAssetId: 's_1.img.thumb' }), 2).session;
    s = addAttachment(s, att('vid', { type: 'video', mimeType: 'video/mp4' }), 2).session;
    const frames = frameArtifacts('vid', [{ id: 'f1', width: 2, height: 2 }], [1000]);
    s = setFrames(s, 'vid', frames, 3);
    s = setWorkflow(s, draftWorkflow('vid', frames, 3), 3);
    s = setNote(s, 'img', 'the paper register', 4);
    s = addTextInput(s, 'about this photo', 'additional_requirement', 4, { sourceAttachmentId: 'img' });
    const r = removeAttachment(s, 'img', 5);
    expect(r.removedAssetIds).toEqual(['s_1.img.orig', 's_1.img.thumb']);
    expect(r.session.textInputs).toHaveLength(0);
    expect(r.session.frames).toHaveLength(1);
    const rep = replaceAttachment(r.session, 'vid', att('vid2', { type: 'video', mimeType: 'video/mp4' }), 6);
    expect(rep.session.frames).toHaveLength(0);
    expect(rep.session.workflows).toHaveLength(0);
    expect(rep.session.derived).toHaveLength(0);
    expect(removeAttachment(rep.session, 'vid2', 7).session.status).toBe('draft');
  });

  it('keeps corrections as new items and replaces an earlier answer to the same conflict', () => {
    let s = addTextInput(createSession('s_1', 1), 'Use 3 fields.', 'correction', 2, { conflictId: 'cf_field_count' });
    s = addTextInput(s, 'Use 5 fields.', 'correction', 3, { conflictId: 'cf_field_count' });
    s = addTextInput(s, 'Big buttons.', 'preference', 4);
    expect(s.textInputs.map((t) => t.text)).toEqual(['Use 5 fields.', 'Big buttons.']);
  });
});

describe('recovery', () => {
  it('restores a valid session and marks unfinished files as failed with a way out', () => {
    let s = addAttachment(createSession('s_1', 1), att('a1', { status: 'processing_local' }), 2).session;
    s = setTranscript(s, { attachmentId: 'a1', text: 'x', original: 'x', source: 'device', status: 'complete' }, 3);
    const back = parseSession(JSON.parse(JSON.stringify(s)), 9);
    expect(back?.status).toBe('interrupted');
    expect(back?.attachments[0]).toMatchObject({ status: 'failed', error: { code: 'PROCESSING_INTERRUPTED' } });
    expect(back?.attachments[0]!.error?.message).toMatch(/Replace it or remove it/);
    expect(parseSession({ ...s, id: 'bad id!' })).toBeUndefined();
    expect(parseSession({ ...s, v: 2 })).toBeUndefined();
    expect(parseSession(null)).toBeUndefined();
  });
});

describe('compiler handoff', () => {
  const img = (id: string, source: 'photo' | 'video_frame' | 'drawing', label?: string) => ({
    id, mimeType: 'image/jpeg' as const, base64: 'AA', width: 2, height: 2, source, ...(label ? { label } : {}),
  });

  it('adds the workflow with times, timed frame labels and notes, keeping the typed text first', () => {
    let s = createSession('s_1', 1);
    s = addAttachment(s, att('p1'), 2).session;
    s = addAttachment(s, att('v1', { type: 'video', mimeType: 'video/mp4', note: 'how I update credit' }), 2).session;
    const frames = frameArtifacts('v1', [{ id: 'vf_a', width: 2, height: 2 }, { id: 'vf_b', width: 2, height: 2 }], [2500, 7000]);
    s = setFrames(s, 'v1', frames, 3);
    s = setWorkflow(s, draftWorkflow('v1', frames, 3), 3);
    s = setNote(s, 'p1', 'my paper register', 4);
    s = addTextInput(s, 'Use 5 fields, as in your drawing.', 'correction', 5);
    const input: NormalizedInput = {
      text: 'A credit book', modalities: ['text', 'image', 'video'], images: [img('p1', 'photo')],
      video: { durationSec: 9, frames: [img('vf_a', 'video_frame', 'Frame at 0:02'), img('vf_b', 'video_frame', 'Frame at 0:07')] },
    };
    const out = applySession(input, s);
    expect(out.text.startsWith('A credit book\n\n')).toBe(true);
    expect(out.text).toContain('- Photo 1: my paper register');
    expect(out.text).toContain('- Use 5 fields, as in your drawing.');
    expect(out.video?.frames.map((f) => f.label)).toEqual(['Video frame 1 at 0:02', 'Video frame 2 at 0:07']);
    expect(out.video?.summary).toBe('The person says: how I update credit\nWorkflow: What the video shows\n1. [0:02] Step at 0:02\n2. [0:07] Step at 0:07');
    expect(input.text).toBe('A credit book'); // not mutated
  });

  it('sends attached recordings as text with their source, next to the dictation', () => {
    let s = addAttachment(createSession('s_1', 1), att('a1', { type: 'audio', mimeType: 'audio/mp4' }), 2).session;
    s = setTranscript(s, { attachmentId: 'a1', text: 'name and amount', original: 'name amount', source: 'user_edited', status: 'complete' }, 3);
    const out = applySession({ text: '', modalities: ['audio'], images: [], audioTranscript: 'credit book' }, s);
    expect(out.audioTranscript).toBe('credit book\n\nRecording 1: name and amount');
    expect(applySession({ text: 'x', modalities: ['text'], images: [] }, s).modalities).toEqual(['text', 'audio']);
  });

  it('says which pictures do not fit the six-picture budget', () => {
    const input: NormalizedInput = {
      text: '', modalities: ['image', 'video'],
      images: [img('p1', 'photo'), img('p2', 'photo'), img('p3', 'photo'), img('p4', 'photo')],
      video: { durationSec: 9, frames: [img('f1', 'video_frame'), img('f2', 'video_frame'), img('f3', 'video_frame'), img('f4', 'video_frame')] },
    };
    const b = imageBudget(input);
    expect(b.includedIds).toEqual(['p1', 'p2', 'p3', 'p4', 'f1', 'f2']);
    expect(b.excluded.map((e) => e.id)).toEqual(['f3', 'f4']);
    expect(b.notice).toBe('Kalam can send 6 pictures at a time, so these were left out: 2 video frames. Remove some pictures if you want them included.');
    expect(imageBudget({ ...input, video: undefined }).notice).toBeUndefined();
  });
});


describe('review fixes', () => {
  const img = (id: string, source: 'photo' | 'video_frame') => ({ id, mimeType: 'image/jpeg' as const, base64: 'AA', width: 2, height: 2, source });
  const conflict = (resolution: ContextConflict['resolution'], key = 'k1'): ContextConflict => ({
    id: 'cf_field_count', topic: 'field_count', observations: [], resolution, question: 'q', options: [], key,
  });

  it('returns to a calm status when a placeholder is removed (cancel or duplicate)', () => {
    const s = addAttachment(createSession('s_1', 1), att('a1', { status: 'validating' }), 2).session;
    expect(s.status).toBe('preprocessing');
    const back = removeAttachment(s, 'a1', 3).session;
    expect(back.status).toBe('draft');
    expect(applyEvent(back, 'input_added', 4).status).toBe('collecting');
  });

  it('never attaches derived data to a removed attachment', () => {
    const s = createSession('s_1', 1);
    const frames = frameArtifacts('gone', [{ id: 'f1', width: 2, height: 2 }], [1000]);
    expect(setFrames(s, 'gone', frames, 2)).toBe(s);
    expect(setTranscript(s, { attachmentId: 'gone', text: 'x', original: 'x', source: 'device', status: 'complete' }, 2)).toBe(s);
    expect(setWorkflow(s, draftWorkflow('gone', frames, 2), 2)).toBe(s);
  });

  it('drops an answer when its conflict goes away or changes', () => {
    let s = setConflicts(createSession('s_1', 1), [conflict('resolved')], 2);
    s = addTextInput(s, 'Use 5 fields, as in your drawing.', 'correction', 3, { conflictId: 'cf_field_count' });
    s = addTextInput(s, 'Big buttons.', 'preference', 3);
    expect(setConflicts(s, [conflict('resolved')], 4).textInputs).toHaveLength(2);
    const gone = setConflicts(s, [], 4);
    expect(gone.textInputs.map((t) => t.text)).toEqual(['Big buttons.']);
    expect(applySession({ text: 'x', modalities: ['text'], images: [] }, gone).text).toBe('x');
    expect(setConflicts(s, [conflict('needs_user_confirmation', 'k2')], 4).textInputs.map((t) => t.text)).toEqual(['Big buttons.']);
  });

  it('keeps answers near the 4000-character limit and names what was cut', () => {
    let s = addAttachment(createSession('s_1', 1), att('p1'), 2).session;
    s = setNote(s, 'p1', 'my paper register', 3);
    s = setConflicts(s, [conflict('resolved')], 4);
    s = addTextInput(s, 'Use 5 fields, as in your drawing.', 'correction', 5, { conflictId: 'cf_field_count' });
    const typed = 'a'.repeat(3990);
    const out = prepareHandoff({ text: typed, modalities: ['text'], images: [] }, s);
    expect(out.input.text.length).toBeLessThanOrEqual(4000);
    expect(out.input.text).toContain('- Use 5 fields, as in your drawing.');
    expect(out.input.text).not.toContain('my paper register');
    expect(out.notices.join(' ')).toMatch(/shortened/);
    expect(out.notices.join(' ')).toMatch(/1 note about your files was left out/);
    const short = prepareHandoff({ text: 'a'.repeat(3900), modalities: ['text'], images: [] }, s);
    expect(short.input.text).toContain('- Use 5 fields, as in your drawing.');
    expect(short.input.text.startsWith('a'.repeat(3900))).toBe(true);
    expect(short.notices.join(' ')).toMatch(/left out/);
  });

  it('sends the note of a video with no usable frames as text', () => {
    let s = addAttachment(createSession('s_1', 1), att('v1', { type: 'video', mimeType: 'video/mp4', status: 'failed' }), 2).session;
    s = setNote(s, 'v1', 'how I update credit', 3);
    const out = applySession({ text: '', modalities: [], images: [] }, s);
    expect(out.text).toContain('- Video 1: how I update credit');
    expect(out.modalities).toContain('text');
    expect(sessionAddsInput(s)).toBe(true);
  });

  it('lets an attached recording alone be built from', () => {
    let s = addAttachment(createSession('s_1', 1), att('a1', { type: 'audio', mimeType: 'audio/mp4', status: 'partial' }), 2).session;
    expect(sessionAddsInput(s)).toBe(false);
    s = setTranscript(s, { attachmentId: 'a1', text: 'a credit book with name and amount', original: '', source: 'user_edited', status: 'complete' }, 3);
    expect(sessionAddsInput(s)).toBe(true);
    const out = applySession({ text: '', modalities: [], images: [] }, s);
    expect(out.audioTranscript).toBe('Recording 1: a credit book with name and amount');
    expect(out.modalities).toEqual(['audio']);
  });

  it('includes the picture-budget notice with the handoff', () => {
    const input: NormalizedInput = {
      text: '', modalities: ['image', 'video'], images: ['p1', 'p2', 'p3', 'p4'].map((id) => img(id, 'photo')),
      video: { durationSec: 9, frames: ['f1', 'f2', 'f3'].map((id) => img(id, 'video_frame')) },
    };
    expect(prepareHandoff(input, createSession('s_1', 1)).notices).toEqual([imageBudget(input).notice]);
  });

  it('marks pictures and frames the draft could not bring back after a restart', () => {
    let s = addAttachment(createSession('s_1', 1), att('p1', { preparedImageId: 'img_1' }), 2).session;
    s = addAttachment(s, att('p2', { preparedImageId: 'img_2', contentHash: 'h2' }), 2).session;
    s = addAttachment(s, att('v1', { type: 'video', mimeType: 'video/mp4' }), 2).session;
    s = setFrames(s, 'v1', frameArtifacts('v1', [{ id: 'vf_a', width: 2, height: 2 }], [1000]), 3);
    const r = reconcileWithDraft(s, { photoIds: new Set(['img_1']), frameIds: new Set() }, 4);
    expect(r.missing).toBe(2);
    expect(r.session.attachments.map((a) => a.status)).toEqual(['ready', 'failed', 'failed']);
    expect(r.session.attachments[1]!.error?.code).toBe('ATTACHMENT_MISSING');
    expect(r.session.status).toBe('attachment_failed');
    expect(reconcileWithDraft(s, { photoIds: new Set(['img_1', 'img_2']), frameIds: new Set(['vf_a']) }, 4).session).toBe(s);
  });
});
