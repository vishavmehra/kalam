import { describe, expect, it } from 'vitest';
import { frameArtifacts, draftWorkflow, type MediaAttachment } from '@/core/media';
import { addAttachment, addTextInput, createSession, setFrames, setNote, setTranscript, setWorkflow } from '@/core/session';
import { draftWithSession } from '@/features/media/create-bridge';
import { buildNormalizedInput, type CreationDraft } from '@/features/input/normalize';
import { buildSends, prepareBuild, restoreBuild } from './snapshot';

const frame = (id: string) => ({ id, mimeType: 'image/jpeg' as const, base64: 'AA', width: 2, height: 2, source: 'video_frame' as const });
const att = (id: string, over: Partial<MediaAttachment>): MediaAttachment => ({
  id, type: 'image', mimeType: 'image/jpeg', sizeBytes: 100, status: 'ready', createdAt: 1, updatedAt: 1, ...over,
});

/** The session of someone who typed, described a photo, attached a recording and a video, and answered a question. */
function busySession(videoFrames: boolean) {
  let s = createSession('s_1', 1);
  s = addAttachment(s, att('p1', {}), 2).session;
  s = setNote(s, 'p1', 'my paper register', 3);
  s = addAttachment(s, att('a1', { type: 'audio', mimeType: 'audio/mp4' }), 2).session;
  s = setTranscript(s, { attachmentId: 'a1', text: 'track my daily milk sales', original: 'track my daily milk sales', source: 'device', status: 'complete' }, 3);
  s = addAttachment(s, att('v1', { type: 'video', mimeType: 'video/mp4', note: 'how I update credit' }), 2).session;
  const frames = frameArtifacts('v1', [{ id: 'vf_a', width: 2, height: 2 }, { id: 'vf_b', width: 2, height: 2 }], [2500, 7000]);
  s = setFrames(s, 'v1', videoFrames ? frames : [], 3);
  s = setWorkflow(s, draftWorkflow('v1', frames, 3), 3);
  return addTextInput(s, 'Use 5 fields, as in your drawing.', 'correction', 5, { conflictId: 'c_fields' });
}

const base = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  text: 'A credit book', photos: [], preferences: { language: 'en', targetUser: 'Shopkeepers with no signal', constraints: 'No sign in. Big buttons.' }, ...over,
});

const back = async (d: CreationDraft) => restoreBuild(prepareBuild(d, 'op_1').snapshot, async () => ({ mimeType: 'image/jpeg', base64: 'AA' }));

describe('a build queued offline keeps what the session knew', () => {
  it('carries notes, answers, the recording words and the video steps with their times', async () => {
    const queued = await back(draftWithSession(base({ video: { name: 'clip', durationSec: 9, droppedFrames: 0, frames: [frame('vf_a'), frame('vf_b')] } }), busySession(true)));
    expect(queued?.text.startsWith('A credit book')).toBe(true);
    expect(queued?.text).toContain('Photo 1: my paper register');
    expect(queued?.text).toContain('Use 5 fields, as in your drawing.');
    expect(queued?.voice?.transcript).toContain('track my daily milk sales');
    expect(queued?.video?.summary).toContain('The person says: how I update credit');
    expect(queued?.video?.summary).toMatch(/\[0:02\].*\n.*\[0:07\]/);
    // The queued build says the same to the compiler as "Create app" would have said at that moment.
    const live = buildNormalizedInput(draftWithSession(base({ video: { name: 'clip', durationSec: 9, droppedFrames: 0, frames: [frame('vf_a'), frame('vf_b')] } }), busySession(true)));
    const later = buildNormalizedInput(queued!);
    expect(later.text).toBe(live.text);
    expect(later.audioTranscript).toBe(live.audioTranscript);
    expect(later.video?.summary).toBe(live.video?.summary);
  });

  it('keeps the video steps in the text when no frames could be read', async () => {
    const queued = await back(draftWithSession(base(), busySession(false)));
    expect(queued?.video).toBeUndefined();
    expect(queued?.text).toContain('Workflow: What the video shows');
    expect(queued?.text).toMatch(/\[0:02\]/);
  });

  it('carries who the app is for and what it must do', async () => {
    const queued = await back(base());
    expect(queued?.preferences).toMatchObject({ language: 'en', targetUser: 'Shopkeepers with no signal', constraints: 'No sign in. Big buttons.' });
    expect(buildNormalizedInput(queued!).preferences).toMatchObject({ targetUser: 'Shopkeepers with no signal', constraints: 'No sign in. Big buttons.' });
  });

  it('leaves the notes out when the person wrote none', async () => {
    const queued = await back(base({ preferences: { language: 'en' } }));
    expect(queued?.preferences).toEqual({ language: 'en' });
    expect(buildNormalizedInput(queued!).preferences).toBeUndefined();
  });

  it('can be queued from a recording alone, and says it sends words', () => {
    let s = addAttachment(createSession('s_1', 1), att('a1', { type: 'audio', mimeType: 'audio/mp4' }), 2).session;
    s = setTranscript(s, { attachmentId: 'a1', text: 'milk sales', original: 'milk sales', source: 'device', status: 'complete' }, 3);
    const frozen = draftWithSession(base({ text: '' }), s);
    expect(buildSends(frozen)).toEqual(['voice_text']);
    expect(() => prepareBuild(frozen, 'op_2')).not.toThrow();
  });
});
