/**
 * On-device (Gemini Nano) status and preparation tests (docs/17 §5.1 to §5.2, §13.1). The Chrome
 * Prompt API is faked, so these prove how Kalam reads and drives it. They do not prove that Nano runs:
 * the real Chrome 157 runs are recorded in docs and src/core/ai/capabilities.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type Session = { destroy: ReturnType<typeof vi.fn> };
type CreateOptions = { expectedInputs?: unknown[]; expectedOutputs?: unknown[]; monitor?: (m: EventTarget) => void };
type FakeModel = { availability: unknown; create: unknown };

const fakeModel = () => (globalThis as { LanguageModel?: FakeModel }).LanguageModel as FakeModel;

/** Installs a fake Chrome Prompt API and returns a fresh copy of the module (module state is per test). */
async function setup(initial: Availability | string | undefined = 'available', createMs = 0) {
  vi.resetModules();
  let current: string | undefined = initial;
  const sessions: Session[] = [];
  const availability = vi.fn(async (_options?: unknown) => current);
  const create = vi.fn(async (_options?: CreateOptions) => {
    await new Promise((r) => setTimeout(r, createMs));
    const session: Session = { destroy: vi.fn() };
    sessions.push(session);
    return session;
  });
  (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability, create };
  const mod = await import('./on-device.web');
  return { mod, create, availability, sessions, setAvailability: (v: string | undefined) => { current = v; } };
}

const progressEvent = (loaded: number) => Object.assign(new Event('downloadprogress'), { loaded });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

// ─── Availability mapping ─────────────────────────────────────────────────────
describe('onDeviceStatus (web Prompt API): availability mapping', () => {
  it('reports an available model, not yet loaded into memory', async () => {
    const { mod } = await setup('available');
    expect(await mod.onDeviceStatus()).toEqual({ platform: 'web', apiExposed: true, availability: 'available', progress: undefined, warm: false });
  });

  it('reports a downloadable model with no warm flag (nothing to be warm yet)', async () => {
    const { mod } = await setup('downloadable');
    const status = await mod.onDeviceStatus();
    expect(status).toMatchObject({ platform: 'web', apiExposed: true, availability: 'downloadable' });
    expect(status).not.toHaveProperty('warm');
  });

  it('reports a download in progress, with no progress value before the first event', async () => {
    const { mod } = await setup('downloading');
    const status = await mod.onDeviceStatus();
    expect(status).toMatchObject({ availability: 'downloading', apiExposed: true });
    expect(status.progress).toBeUndefined();
  });

  it('reports an exposed API whose model cannot run as unavailable', async () => {
    const { mod } = await setup('unavailable');
    expect(await mod.onDeviceStatus()).toMatchObject({ apiExposed: true, availability: 'unavailable' });
  });

  it.each(['after-download', 'ready', ''])('maps an unexpected availability value %j to unknown', async (value) => {
    const { mod } = await setup(value);
    expect(await mod.onDeviceStatus()).toMatchObject({ apiExposed: true, availability: 'unknown' });
  });

  it('maps a missing availability value to unknown', async () => {
    const { mod, availability } = await setup('available');
    availability.mockResolvedValueOnce(undefined);
    expect(await mod.onDeviceStatus()).toMatchObject({ apiExposed: true, availability: 'unknown' });
  });

  it('reports unknown with the error text when the availability check throws', async () => {
    const { mod, availability } = await setup('available');
    availability.mockRejectedValueOnce(new Error('NotAllowedError: blocked by policy'));
    expect(await mod.onDeviceStatus()).toMatchObject({
      apiExposed: true, availability: 'unknown', detail: 'NotAllowedError: blocked by policy',
    });
    availability.mockRejectedValueOnce('plain string failure');
    expect(await mod.onDeviceStatus()).toMatchObject({ availability: 'unknown', detail: 'plain string failure' });
  });

  it('asks for the same English text expectations the provider uses', async () => {
    const { mod, availability } = await setup('available');
    await mod.onDeviceStatus();
    expect(availability).toHaveBeenCalledWith(mod.TEXT_IO);
    expect(mod.TEXT_IO).toEqual({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
  });

  it('reports no Prompt API as unavailable with a clear reason, without throwing', async () => {
    vi.resetModules();
    const mod = await import('./on-device.web');
    expect(mod.getLanguageModel()).toBeUndefined();
    const status = await mod.onDeviceStatus();
    expect(status).toMatchObject({ platform: 'web', apiExposed: false, availability: 'unavailable' });
    expect(status.detail).toMatch(/Prompt API/);
    expect(status).not.toHaveProperty('warm');
  });

  it('reads the Prompt API from the global each time (so a later install is noticed)', async () => {
    vi.resetModules();
    const mod = await import('./on-device.web');
    expect(mod.getLanguageModel()).toBeUndefined();
    const lm = { availability: async () => 'available', create: async () => ({ destroy() {} }) };
    (globalThis as { LanguageModel?: unknown }).LanguageModel = lm;
    expect(mod.getLanguageModel()).toBe(lm);
  });
});

// ─── prepareOnDevice: download progress ───────────────────────────────────────
describe('prepareOnDevice (web Prompt API)', () => {
  it('forwards download progress events in order and ends warm and available', async () => {
    const { mod, setAvailability } = await setup('downloadable');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const session: Session = { destroy: vi.fn() };
    fakeModel().create = vi.fn(async (options?: CreateOptions) => {
      setAvailability('downloading');
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      monitor.dispatchEvent(progressEvent(0.25));
      monitor.dispatchEvent(progressEvent(0.5));
      await gate;
      monitor.dispatchEvent(progressEvent(1));
      setAvailability('available');
      return session;
    });

    const seen: number[] = [];
    const pending = mod.prepareOnDevice((p) => seen.push(p));
    await tick();
    expect(seen).toEqual([0.25, 0.5]);
    // Status read while the download runs shows the latest progress.
    expect(await mod.onDeviceStatus()).toMatchObject({ availability: 'downloading', progress: 0.5 });

    release();
    const done = await pending;
    expect(seen).toEqual([0.25, 0.5, 1]);
    expect(done).toMatchObject({ availability: 'available', warm: true });
    expect(done.progress).toBeUndefined();
  });

  it('passes the text expectations and a download monitor to create()', async () => {
    const { mod, create } = await setup('downloadable');
    await mod.prepareOnDevice();
    const options = create.mock.calls[0]?.[0] as CreateOptions;
    expect(options.expectedInputs).toEqual(mod.TEXT_IO.expectedInputs);
    expect(options.expectedOutputs).toEqual(mod.TEXT_IO.expectedOutputs);
    expect(typeof options.monitor).toBe('function');
  });

  it('works without a progress callback and still records progress for status reads', async () => {
    const { mod, setAvailability } = await setup('downloadable');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fakeModel().create = vi.fn(async (options?: CreateOptions) => {
      setAvailability('downloading');
      const monitor = new EventTarget();
      options?.monitor?.(monitor);
      monitor.dispatchEvent(progressEvent(0.75));
      await gate;
      setAvailability('available');
      return { destroy: vi.fn() };
    });
    const pending = mod.prepareOnDevice();
    await tick();
    expect(await mod.onDeviceStatus()).toMatchObject({ availability: 'downloading', progress: 0.75 });
    release();
    expect(await pending).toMatchObject({ availability: 'available', warm: true });
  });

  it('keeps the new session warm and destroys the one it replaces', async () => {
    const { mod, sessions } = await setup('available');
    await mod.prepareOnDevice();
    await mod.prepareOnDevice();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(sessions[1]?.destroy).not.toHaveBeenCalled();
  });

  it('returns the status with the error text when create() fails (for example no user gesture)', async () => {
    const { mod, create, sessions } = await setup('downloadable');
    create.mockRejectedValueOnce(Object.assign(new Error('Requires a user gesture to start the download.'), { name: 'NotAllowedError' }));
    const status = await mod.prepareOnDevice();
    expect(status).toMatchObject({ availability: 'downloadable', detail: 'Requires a user gesture to start the download.' });
    expect(status).not.toHaveProperty('warm');
    expect(sessions).toHaveLength(0);
  });

  it('is not marked warm after a failed attempt on an available model', async () => {
    const { mod, create } = await setup('available');
    create.mockRejectedValueOnce(new Error('out of memory'));
    expect(await mod.prepareOnDevice()).toMatchObject({ availability: 'available', warm: false, detail: 'out of memory' });
  });

  it('returns the no-API status without calling anything when the Prompt API is missing', async () => {
    vi.resetModules();
    const mod = await import('./on-device.web');
    const onProgress = vi.fn();
    expect(await mod.prepareOnDevice(onProgress)).toMatchObject({ apiExposed: false, availability: 'unavailable' });
    expect(onProgress).not.toHaveBeenCalled();
  });
});

// ─── Warm-up and cold start ───────────────────────────────────────────────────
describe('warmUpOnDevice (web Prompt API)', () => {
  it('loads an available model once, shares concurrent calls, then reports warm', async () => {
    const { mod, create } = await setup('available', 20);
    expect((await mod.onDeviceStatus()).warm).toBe(false);
    const [a, b] = await Promise.all([mod.warmUpOnDevice(), mod.warmUpOnDevice()]);
    expect(a).toMatchObject({ availability: 'available', warm: true });
    expect(b).toMatchObject({ warm: true });
    expect(create).toHaveBeenCalledTimes(1);
    await mod.warmUpOnDevice();
    expect(create).toHaveBeenCalledTimes(1);
    expect((await mod.onDeviceStatus()).warm).toBe(true);
  });

  it('never creates a session (so never starts a download) unless the model is available', async () => {
    for (const a of ['downloadable', 'downloading', 'unavailable'] as const) {
      const { mod, create } = await setup(a);
      expect((await mod.warmUpOnDevice()).availability).toBe(a);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('does not create a session when the availability check itself failed', async () => {
    const { mod, create, availability } = await setup('available');
    availability.mockRejectedValueOnce(new Error('probe failed'));
    expect(await mod.warmUpOnDevice()).toMatchObject({ availability: 'unknown' });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports no Prompt API without throwing', async () => {
    vi.resetModules();
    const mod = await import('./on-device.web');
    expect(await mod.warmUpOnDevice()).toMatchObject({ apiExposed: false, availability: 'unavailable' });
  });

  it('does not load a second session when prepareOnDevice already left one warm', async () => {
    const { mod, create } = await setup('available');
    await mod.prepareOnDevice();
    expect(await mod.warmUpOnDevice()).toMatchObject({ availability: 'available', warm: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('survives a slow first load (about 40 s on Chrome 157): status stays available and not warm until it finishes', async () => {
    const { mod, create } = await setup('available', 40_000);
    vi.useFakeTimers();
    const warming = mod.warmUpOnDevice();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await mod.onDeviceStatus()).toMatchObject({ availability: 'available', warm: false });
    // A second caller during the load joins it instead of starting another 40 s load.
    const joined = mod.warmUpOnDevice();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await warming).toMatchObject({ availability: 'available', warm: true });
    expect(await joined).toMatchObject({ warm: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await mod.onDeviceStatus()).warm).toBe(true);
  });

  it('reports a failed load as not warm with the reason, and a later call can try again', async () => {
    const { mod, create, sessions } = await setup('available');
    create.mockRejectedValueOnce(new Error('model load failed'));
    expect(await mod.warmUpOnDevice()).toMatchObject({ availability: 'available', warm: false, detail: 'model load failed' });
    expect((await mod.onDeviceStatus()).warm).toBe(false);
    expect(await mod.warmUpOnDevice()).toMatchObject({ warm: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(sessions).toHaveLength(1);
  });
});

// ─── Android ──────────────────────────────────────────────────────────────────
// Without the kalam-nano native module (Expo Go, unit tests). With the module: on-device.native.test.ts.
describe('on-device (Android, no native module)', () => {
  it('reports Gemini Nano as unavailable and names the missing kalam-nano module', async () => {
    const mod = await import('./on-device.native');
    const expected = { platform: 'android', apiExposed: false, availability: 'unavailable' };
    expect(await mod.onDeviceStatus()).toMatchObject(expected);
    expect((await mod.onDeviceStatus()).detail).toMatch(/kalam-nano/);
    expect(await mod.prepareOnDevice()).toMatchObject(expected);
    expect(await mod.warmUpOnDevice()).toMatchObject(expected);
  });

  it('never exposes a LanguageModel, even if a global one exists, so only_on_device cannot silently use it', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => 'available', create: async () => ({ destroy() {} }) };
    const mod = await import('./on-device.native');
    expect(mod.getLanguageModel()).toBeUndefined();
  });

  it('does not report download progress and shares the text expectations with web', async () => {
    const mod = await import('./on-device.native');
    const web = await import('./on-device.web');
    const onProgress = vi.fn();
    await mod.prepareOnDevice(onProgress);
    expect(onProgress).not.toHaveBeenCalled();
    expect(mod.TEXT_IO).toBe(web.TEXT_IO);
  });
});
