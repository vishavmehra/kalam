import { describe, expect, it } from 'vitest';
import { createOfflineAI } from './offline-ai';

describe('createOfflineAI', () => {
  it('reports no model anywhere and fails every run with the offline code', async () => {
    const ai = createOfflineAI();
    expect(await ai.status()).toEqual({
      onDevice: { platform: 'other', apiExposed: false, availability: 'unavailable' },
      cloudConfigured: false,
      online: false,
      specialistConfigured: false,
    });
    expect(ai.runCalls()).toBe(0);
    const res = await ai.run(
      {
        taskType: 'create_app',
        prompt: 'x',
        jsonSchema: {},
        parse: () => ({ success: true, data: 1 }),
        mode: 'only_in_cloud',
        role: 'compiler',
      } as never,
      { taskType: 'create_app' },
    );
    expect(res).toMatchObject({ success: false, errorCode: 'offline', provider: 'none' });
    expect(ai.runCalls()).toBe(1);
  });
});
