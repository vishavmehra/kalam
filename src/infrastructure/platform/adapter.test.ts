/**
 * The PlatformAdapter must supply every member on web and on Android. The web adapter uses the real
 * browser modules (they have no native imports). The Android adapter is loaded with every native
 * module mocked, because Node cannot load them; only the wiring is checked, not the device calls.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ADAPTER_MEMBERS, describeCapabilities, platformNameFor, type PlatformAdapter, type PlatformName } from './adapter.shared';

vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).fill(7),
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));
vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));
vi.mock('expo-speech', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({}));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
vi.mock('expo-video-thumbnails', () => ({}));
vi.mock('@shopify/react-native-skia', () => ({ AlphaType: {}, ColorType: {}, Skia: {} }));
vi.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove() {} }),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));
vi.mock('react-native', () => ({ Linking: {}, Platform: { OS: 'android' } }));


const loaders: Array<[PlatformName, () => Promise<{ getPlatformAdapter(): PlatformAdapter }>]> = [
  ['web', () => import('./adapter.web')],
  ['android', () => import('./adapter.native')],
];

describe.each(loaders)('PlatformAdapter on %s', (platform, load) => {
  let adapter: PlatformAdapter;
  // The first import transforms the whole module tree, which can take longer than a test's default time.
  beforeAll(async () => {
    adapter = (await load()).getPlatformAdapter();
  }, 60_000);

  it('reports its platform and returns one shared adapter', async () => {
    expect(adapter.getPlatform()).toBe(platform);
    expect((await load()).getPlatformAdapter()).toBe(adapter);
  });

  it('has every group and every member as a function', () => {
    for (const [group, members] of Object.entries(ADAPTER_MEMBERS)) {
      const section = (adapter as unknown as Record<string, Record<string, unknown>>)[group];
      expect(section, `group ${group}`).toBeDefined();
      for (const member of members as string[]) expect(typeof section[member], `${group}.${member}`).toBe('function');
    }
  });

  it('has no group or member that the list does not name', () => {
    const all = adapter as unknown as Record<string, unknown>;
    expect(Object.keys(all).sort()).toEqual(['capabilities', 'getPlatform', ...Object.keys(ADAPTER_MEMBERS)].sort());
    for (const [group, members] of Object.entries(ADAPTER_MEMBERS)) {
      expect(Object.keys(all[group] as object).sort(), group).toEqual([...(members as string[])].sort());
    }
  });

  it('reports what the platform can do, with every field filled in and never rejecting', async () => {
    const capabilities = await adapter.capabilities();
    expect(capabilities.platform).toBe(platform);
    expect(typeof capabilities.speechToText).toBe('boolean');
    expect(['available', 'downloadable', 'downloading', 'unavailable', 'unknown']).toContain(capabilities.speechOnDevice);
    expect(typeof capabilities.textToSpeech).toBe('boolean');
    expect(['system', 'while_open', 'none']).toContain(capabilities.reminders);
  });

  it('gives secure random bytes of the length asked and a uuid', () => {
    const bytes = adapter.random.bytes(16);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(16);
    expect(adapter.random.uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('applies the keep-or-delete rule for recordings through the adapter', async () => {
    const discard = vi.fn(async () => true);
    expect(await adapter.audio.settleRecording('file:///a.m4a', false, discard)).toBeUndefined();
    expect(discard).toHaveBeenCalledOnce();
    expect(await adapter.audio.settleRecording('file:///a.m4a', true, discard)).toBe('file:///a.m4a');
    expect(discard).toHaveBeenCalledOnce();
  });
});

describe('PlatformAdapter on web', () => {
  it('reads online state from the browser monitor', async () => {
    const { getPlatformAdapter } = await import('./adapter.web');
    expect(typeof getPlatformAdapter().network.getMonitor().online()).toBe('boolean');
  });
});

describe('describeCapabilities', () => {
  const stub = (over: { speech?: (lang: string) => Promise<unknown>; tts?: () => Promise<boolean>; notify?: () => Promise<unknown> } = {}) => ({
    getPlatform: () => 'android' as const,
    speech: { getCapability: over.speech ?? (async () => ({ supported: true, onDevice: 'available', locale: 'en-IN' })) },
    tts: { getAdapter: () => ({ isAvailable: over.tts ?? (async () => true) }) },
    notifications: { getAdapter: () => ({ capability: over.notify ?? (async () => ({ delivery: 'system' })) }) },
  }) as unknown as Parameters<typeof describeCapabilities>[0];

  it('puts each answer in its field', async () => {
    expect(await describeCapabilities(stub())).toEqual({
      platform: 'android', speechToText: true, speechOnDevice: 'available', textToSpeech: true, reminders: 'system',
    });
    expect(await describeCapabilities(stub({
      speech: async () => ({ supported: false, onDevice: 'unavailable', locale: 'en' }),
      tts: async () => false,
      notify: async () => ({ delivery: 'while_open' }),
    }))).toEqual({
      platform: 'android', speechToText: false, speechOnDevice: 'unavailable', textToSpeech: false, reminders: 'while_open',
    });
  });

  it('says unsupported, not an error, when a platform check fails', async () => {
    const boom = async (): Promise<never> => { throw new Error('module missing'); };
    expect(await describeCapabilities(stub({ speech: boom, tts: boom, notify: boom }))).toEqual({
      platform: 'android', speechToText: false, speechOnDevice: 'unknown', textToSpeech: false, reminders: 'none',
    });
  });

  it('asks speech for the language it was given', async () => {
    const asked: string[] = [];
    await describeCapabilities(stub({ speech: async (lang) => { asked.push(lang); return { supported: true, onDevice: 'unknown', locale: lang }; } }), 'hi-IN');
    await describeCapabilities(stub({ speech: async (lang) => { asked.push(lang); return { supported: true, onDevice: 'unknown', locale: lang }; } }));
    expect(asked).toEqual(['hi-IN', 'en']);
  });
});

describe('platformNameFor', () => {
  it('names web, iOS and Android from Platform.OS', () => {
    expect(platformNameFor('web')).toBe('web');
    expect(platformNameFor('ios')).toBe('ios');
    expect(platformNameFor('android')).toBe('android');
    expect(platformNameFor('windows')).toBe('android');
  });
});
