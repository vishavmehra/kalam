import { describe, expect, it, vi } from 'vitest';
import type { TranscribeService } from '@/core/contracts';
import { transcribeFile } from './transcribe-file.web';

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 16, 0, 0, 0, 1, 0, 1, 0, 0x44, 0xac, 0, 0]);
const uri = 'data:audio/wav;base64,' + Buffer.from(wav).toString('base64');
const base = { uri, lang: 'en', head: wav, policy: { aiMode: 'hybrid' as const, allowCloud: true, consent: false } };

describe('web audio file transcription', () => {
  it('sends the file to the cloud service and returns its text', async () => {
    const transcribe = vi.fn(async () => ({ ok: true as const, text: 'two chai', source: 'cloud' as never }));
    const out = await transcribeFile(base, { transcribe } as TranscribeService);
    expect(out).toMatchObject({ ok: true, text: 'two chai', location: 'cloud_service', partial: false });
    expect(transcribe.mock.calls[0]![0].mimeType).toBe('audio/wav');
  });
  it('does not call the cloud when Offline only is on or Online AI is off', async () => {
    const transcribe = vi.fn();
    const a = await transcribeFile({ ...base, policy: { ...base.policy, aiMode: 'offline_only' } }, { transcribe } as never);
    const b = await transcribeFile({ ...base, policy: { ...base.policy, allowCloud: false } }, { transcribe } as never);
    expect(a).toMatchObject({ ok: false, reason: 'blocked' });
    expect(b).toMatchObject({ ok: false, reason: 'blocked' });
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('refuses video and unknown bytes, and reports a failed call', async () => {
    const transcribe = vi.fn(async () => ({ ok: false as const, code: 'provider_error' as never, message: 'Try again.' }));
    expect(await transcribeFile({ ...base, isVideo: true }, { transcribe } as never)).toMatchObject({ reason: 'unsupported' });
    expect(await transcribeFile({ ...base, head: new Uint8Array(8) }, { transcribe } as never)).toMatchObject({ reason: 'format' });
    expect(await transcribeFile(base, { transcribe } as never)).toMatchObject({ ok: false, reason: 'failed', message: 'Try again.' });
  });
});
