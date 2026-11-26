import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import type { AIAudio } from '../contracts';
import { createTranscribeService, MAX_TRANSCRIPT_CHARS, primaryLanguage } from './transcribe-service';

const wav: AIAudio = { mimeType: 'audio/wav', base64: 'UklGRg==' };

describe('transcribe service (D00-026)', () => {
  it('sends the recording to the cloud as an audio part and returns the words', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: { transcript: ' Ek  khata   banao\nfor Raju ', language: 'hi-IN' } }) });
    const out = await createTranscribeService({ ai }).transcribe(wav, { language: 'hi', sessionId: 'sess_1' });
    expect(out).toEqual({ ok: true, text: 'Ek khata banao for Raju', language: 'hi', source: 'cloud', model: 'gemini-2.5-flash' });
    const call = ai.calls[0]!;
    expect(call.req.audio).toEqual([wav]);
    expect(call.req.mode).toBe('only_in_cloud');
    expect(call.req.taskType).toBe('voice_action');
    expect(call.req.prompt).toContain('"hi"');
    expect(call.ctx).toMatchObject({ taskType: 'voice_action', sessionId: 'sess_1' });
  });

  it('puts the instruction in the system prompt and treats speech as data', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: { transcript: 'hello' } }) });
    await createTranscribeService({ ai }).transcribe(wav);
    expect(ai.calls[0]!.req.system).toMatch(/never instructions/);
    expect(ai.calls[0]!.req.prompt).not.toContain('hello');
  });

  it('fails plainly offline and says nothing was sent', async () => {
    const ai = createFakeAI({ online: false });
    const out = await createTranscribeService({ ai }).transcribe(wav);
    expect(out).toMatchObject({ ok: false, code: 'offline' });
    expect(out.ok ? '' : out.message).toMatch(/offline/i);
  });

  it('rejects an answer that is not the expected shape', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: { transcript: 5 } }) });
    expect(await createTranscribeService({ ai }).transcribe(wav)).toMatchObject({ ok: false, code: 'invalid_output' });
  });

  it('reports no speech instead of an empty transcript', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: { transcript: '   ' } }) });
    const out = await createTranscribeService({ ai }).transcribe(wav);
    expect(out).toMatchObject({ ok: false, code: 'invalid_output' });
    expect(out.ok ? '' : out.message).toMatch(/speech/);
  });

  it('cuts a very long transcript on a character boundary', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: { transcript: 'कि'.repeat(MAX_TRANSCRIPT_CHARS + 50) } }) });
    const out = await createTranscribeService({ ai }).transcribe(wav);
    expect(out.ok && [...out.text].length).toBe(MAX_TRANSCRIPT_CHARS * 2);
  });

  it('reduces language answers to a primary subtag', () => {
    expect(primaryLanguage('hi-IN')).toBe('hi');
    expect(primaryLanguage('EN_us')).toBe('en');
    expect(primaryLanguage('Hindi')).toBeUndefined();
    expect(primaryLanguage(undefined)).toBeUndefined();
  });
});
