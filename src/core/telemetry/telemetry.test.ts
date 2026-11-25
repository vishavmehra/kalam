import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorLog } from '../observability';
import {
  createTelemetry, inputKindFor, installTelemetry, parseState, reportError, TELEMETRY_VOCAB, track,
  type TelemetryStore,
} from './index';

function memoryStore(initial: string | null = null) {
  let saved = initial;
  const writes: string[] = [];
  const store: TelemetryStore = {
    read: async () => saved,
    write: async (json) => {
      writes.push(json);
      saved = json;
    },
  };
  return { store, writes, get saved() { return saved; } };
}

afterEach(() => {
  installTelemetry(undefined);
  errorLog.clear();
  vi.restoreAllMocks();
});

describe('telemetry is off by default', () => {
  it('counts nothing and writes nothing until the person turns it on', async () => {
    const mem = memoryStore();
    const t = createTelemetry(mem.store);
    await t.ready;
    expect(t.isEnabled()).toBe(false);
    await t.count('apps_created', 'text');
    await t.count('ai_source', 'cloud');
    await t.count('error', 'timeout');
    expect(t.snapshot().total).toBe(0);
    expect(mem.writes).toEqual([]);
  });

  it('track() and reportError() do nothing while off, or before it is installed', async () => {
    const mem = memoryStore();
    track('app_opened', 'offline');
    const t = createTelemetry(mem.store);
    installTelemetry(t);
    track('app_opened', 'offline');
    reportError('timeout');
    await t.ready;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.snapshot().total).toBe(0);
    expect(mem.writes).toEqual([]);
    // The in-memory recent-errors log still notes the code, because it never leaves memory.
    expect(errorLog.recent().map((e) => e.code)).toEqual(['timeout']);
  });
});

describe('counting after opt-in', () => {
  it('counts by event and value, and stores locally', async () => {
    const mem = memoryStore();
    const t = createTelemetry(mem.store, () => Date.parse('2026-11-18T10:00:00Z'));
    await t.setEnabled(true);
    await t.count('apps_created', 'text');
    await t.count('apps_created', 'text');
    await t.count('apps_created', 'drawing');
    await t.count('ai_source', 'on_device');
    await t.count('app_opened', 'offline');
    await t.count('error', 'quota');
    const s = t.snapshot();
    expect(s.enabled).toBe(true);
    expect(s.since).toBe('2026-11-18T10:00:00.000Z');
    expect(s.counts.apps_created).toEqual({ text: 2, drawing: 1 });
    expect(s.counts.ai_source).toEqual({ on_device: 1 });
    expect(s.counts.app_opened).toEqual({ offline: 1 });
    expect(s.counts.error).toEqual({ quota: 1 });
    expect(s.total).toBe(6);
    expect(mem.saved).toContain('apps_created:text');
  });

  it('survives a restart: a new instance reads the saved counts and the opt-in', async () => {
    const mem = memoryStore();
    const first = createTelemetry(mem.store);
    await first.setEnabled(true);
    await first.count('app_opened', 'online');
    const second = createTelemetry(mem.store);
    await second.ready;
    expect(second.isEnabled()).toBe(true);
    expect(second.snapshot().counts.app_opened).toEqual({ online: 1 });
  });

  it('drops values that are not on the list, and files other errors under other', async () => {
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    await t.count('apps_created', 'a clinic app for Asha Verma');
    await t.count('ai_source', 'claude');
    await t.count('app_opened', undefined);
    await t.count('error', 'Could not save the order for Asha Verma');
    await t.count('error', new Error('prompt: build a clinic app'));
    expect(t.snapshot().counts).toEqual({ apps_created: {}, ai_source: {}, app_opened: {}, error: { other: 2 }, feature_used: {}, bazaar: {} });
  });

  it('turning it off stops counting and keeps what was counted; reset clears it', async () => {
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    await t.count('app_opened', 'online');
    await t.setEnabled(false);
    await t.count('app_opened', 'online');
    expect(t.snapshot().counts.app_opened).toEqual({ online: 1 });
    expect(t.isEnabled()).toBe(false);
    await t.reset();
    expect(t.snapshot().total).toBe(0);
    expect(t.snapshot().since).toBeNull();
  });

  it('reset leaves counting on and restarts the clock', async () => {
    let clock = Date.parse('2026-11-18T00:00:00Z');
    const t = createTelemetry(memoryStore().store, () => clock);
    await t.setEnabled(true);
    await t.count('ai_source', 'cloud');
    clock = Date.parse('2026-11-19T00:00:00Z');
    await t.reset();
    expect(t.isEnabled()).toBe(true);
    expect(t.snapshot().total).toBe(0);
    expect(t.snapshot().since).toBe('2026-11-19T00:00:00.000Z');
    await t.count('ai_source', 'cloud');
    expect(t.snapshot().total).toBe(1);
  });

  it('keeps counting in memory when storage fails, and never rejects', async () => {
    const t = createTelemetry({ read: async () => { throw new Error('no storage'); }, write: async () => { throw new Error('full'); } });
    await expect(t.setEnabled(true)).resolves.toBeUndefined();
    await expect(t.count('app_opened', 'online')).resolves.toBeUndefined();
    expect(t.snapshot().counts.app_opened).toEqual({ online: 1 });
  });

  it('serialises writes so the last write has the final counts', async () => {
    const mem = memoryStore();
    const t = createTelemetry(mem.store);
    await t.setEnabled(true);
    await Promise.all([1, 2, 3, 4, 5].map(() => t.count('ai_source', 'deterministic')));
    expect(JSON.parse(mem.saved ?? '{}').counts['ai_source:deterministic']).toBe(5);
  });

  it('track() and reportError() count once it is installed and on', async () => {
    const mem = memoryStore();
    const t = createTelemetry(mem.store);
    installTelemetry(t);
    await t.setEnabled(true);
    track('apps_created', 'image');
    expect(reportError(Object.assign(new Error('x'), { code: 'offline' }))).toBe('offline');
    await t.ready;
    await vi.waitFor(() => expect(t.snapshot().total).toBe(2));
    expect(t.snapshot().counts.error).toEqual({ offline: 1 });
  });
});

describe('nothing leaves the device', () => {
  it('makes no network request while counting, exporting or resetting', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    await t.count('ai_source', 'cloud');
    t.exportJson();
    await t.reset();
    vi.unstubAllGlobals();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('export', () => {
  it('is JSON with a format tag, the opt-in state and only counts', async () => {
    const t = createTelemetry(memoryStore().store, () => Date.parse('2026-11-18T10:00:00Z'));
    await t.setEnabled(true);
    await t.count('apps_created', 'audio');
    const out = JSON.parse(t.exportJson());
    expect(out).toEqual({
      format: 'kalam-usage-counts',
      version: 1,
      exportedAt: '2026-11-18T10:00:00.000Z',
      enabled: true,
      since: '2026-11-18T10:00:00.000Z',
      counts: { apps_created: { audio: 1 }, ai_source: {}, app_opened: {}, error: {}, feature_used: {}, bazaar: {} },
    });
  });

  it('holds only vocabulary keys, whatever was thrown at it', async () => {
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    const junk = ['Asha Verma owes 4,500', 'make me a clinic app', 'passport-scan.jpg', '__proto__', 'constructor', ''];
    for (const j of junk) {
      for (const e of Object.keys(TELEMETRY_VOCAB) as Array<keyof typeof TELEMETRY_VOCAB>) await t.count(e, j);
    }
    await t.count('constructor' as never, 'text');
    const text = t.exportJson();
    for (const secret of ['Asha', 'clinic', 'passport', '4,500']) expect(text).not.toContain(secret);
    const { counts } = JSON.parse(text) as { counts: Record<string, Record<string, number>> };
    for (const [event, rows] of Object.entries(counts)) {
      expect(Object.hasOwn(TELEMETRY_VOCAB, event)).toBe(true);
      for (const dimension of Object.keys(rows)) expect(TELEMETRY_VOCAB[event as keyof typeof TELEMETRY_VOCAB]).toContain(dimension);
    }
  });
});

describe('feature and Bazaar counts', () => {
  it('counts a feature use and a Bazaar action once on, and never counts a made-up one', async () => {
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    await t.count('feature_used', 'report');
    await t.count('feature_used', 'report');
    await t.count('feature_used', 'diary_entry');
    await t.count('bazaar', 'installed');
    await t.count('bazaar', 'purchased');
    expect(t.snapshot().counts.feature_used).toEqual({ report: 2 });
    expect(t.snapshot().counts.bazaar).toEqual({ installed: 1 });
  });

  it('track() takes only values on the list at compile time and counts them at run time', async () => {
    const t = createTelemetry(memoryStore().store);
    installTelemetry(t);
    await t.setEnabled(true);
    track('feature_used', 'visual_edit');
    track('bazaar', 'published');
    await vi.waitFor(() => expect(t.snapshot().total).toBe(2));
  });
});

describe('saved data is untrusted', () => {
  it('keeps known keys with sane numbers and drops the rest', () => {
    const raw = JSON.stringify({
      enabled: true,
      since: 1_700_000_000_000,
      counts: {
        'apps_created:text': 3,
        'apps_created:Asha': 9,
        'secret:text': 4,
        'ai_source:cloud': -2,
        'ai_source:on_device': 1.5,
        'app_opened:online': 5_000_000_000,
        'error:timeout': 'lots',
      },
    });
    const state = parseState(raw);
    expect(state.enabled).toBe(true);
    expect(state.counts).toEqual({ 'apps_created:text': 3, 'app_opened:online': 1_000_000_000 });
  });

  it('falls back to off and empty for junk', () => {
    for (const raw of [null, '', 'not json', '[]', '42', '{"enabled":"yes","counts":7}']) {
      expect(parseState(raw)).toEqual({ enabled: false, since: null, counts: {} });
    }
  });
});

describe('inputKindFor', () => {
  it('names the single input, mixed, or template', () => {
    expect(inputKindFor(['text'])).toBe('text');
    expect(inputKindFor(['drawing'])).toBe('drawing');
    expect(inputKindFor(['text', 'text'])).toBe('text');
    expect(inputKindFor(['text', 'image'])).toBe('mixed');
    expect(inputKindFor([], { template: true })).toBe('template');
    expect(inputKindFor(['whatever'])).toBe('text');
  });
});
