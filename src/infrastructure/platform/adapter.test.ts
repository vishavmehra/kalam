/**
 * The PlatformAdapter must supply every member on web and on Android. The web adapter uses the real
 * browser modules (they have no native imports). The Android adapter is loaded with every native
 * module mocked, because Node cannot load them; only the wiring is checked, not the device calls.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ADAPTER_MEMBERS, platformNameFor, type PlatformAdapter, type PlatformName } from './adapter.shared';

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
    expect(Object.keys(all).sort()).toEqual(['getPlatform', ...Object.keys(ADAPTER_MEMBERS)].sort());
    for (const [group, members] of Object.entries(ADAPTER_MEMBERS)) {
      expect(Object.keys(all[group] as object).sort(), group).toEqual([...(members as string[])].sort());
    }
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

describe('platformNameFor', () => {
  it('names web, iOS and Android from Platform.OS', () => {
    expect(platformNameFor('web')).toBe('web');
    expect(platformNameFor('ios')).toBe('ios');
    expect(platformNameFor('android')).toBe('android');
    expect(platformNameFor('windows')).toBe('android');
  });
});
