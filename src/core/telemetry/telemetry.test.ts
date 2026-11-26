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
    expect(t.snapshot().counts).toEqual({ apps_created: {}, ai_source: {}, app_opened: {}, error: { other: 2 }, feature_used: {}, feature_failed: {}, flow: {}, bazaar: {} });
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
    await expect(t.setEnabled(true)).resolves.toBe(false);
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
      counts: { apps_created: { audio: 1 }, ai_source: {}, app_opened: {}, error: {}, feature_used: {}, feature_failed: {}, flow: {}, bazaar: {} },
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
        'apps_created:Asha Verma': 9,
        'Secret:text': 4,
        'ai_source:cloud': -2,
        'ai_source:on_device': 1.5,
        'app_opened:online': 5_000_000_000,
        'error:timeout': 'lots',
        '__proto__:x': 5,
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

  it('ignores a start time that no date can hold, so reading it never throws', async () => {
    for (const since of [1e20, -1e20, Number.MAX_SAFE_INTEGER * 1e3]) {
      expect(parseState(JSON.stringify({ enabled: true, since, counts: {} })).since).toBeNull();
    }
    const t = createTelemetry(memoryStore(JSON.stringify({ enabled: true, since: 1e20, counts: { 'app_opened:online': 2 } })).store);
    await t.ready;
    expect(t.snapshot().since).toBeNull();
    expect(JSON.parse(t.exportJson()).since).toBeNull();
    expect(t.snapshot().counts.app_opened).toEqual({ online: 2 });
    // A bad clock cannot make the export throw either.
    const odd = createTelemetry(memoryStore().store, () => Number.NaN);
    await odd.setEnabled(true);
    expect(() => odd.exportJson()).not.toThrow();
  });
});

describe('saved shape', () => {
  it('writes a version number', async () => {
    const mem = memoryStore();
    const t = createTelemetry(mem.store);
    await t.setEnabled(true);
    expect(JSON.parse(mem.saved ?? '{}').version).toBe(1);
  });

  it('keeps well-shaped keys this build does not know through a save, and never shows or exports them', async () => {
    const mem = memoryStore(JSON.stringify({
      version: 2, enabled: true, since: 1_700_000_000_000,
      counts: { 'gesture_used:pinch': 4, 'apps_created:text': 1, 'Not A Key': 3, 'x:': 1 },
    }));
    const t = createTelemetry(mem.store);
    await t.ready;
    await t.count('apps_created', 'text');
    const saved = JSON.parse(mem.saved ?? '{}');
    expect(saved.counts).toEqual({ 'gesture_used:pinch': 4, 'apps_created:text': 2 });
    expect(t.snapshot().total).toBe(2);
    expect(t.exportJson()).not.toContain('gesture_used');
    await t.reset();
    expect(JSON.parse(mem.saved ?? '{}').counts).toEqual({});
  });

  it('keeps at most 100 foreign keys', () => {
    const counts = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`future_event:v${i}`, 1]));
    expect(Object.keys(parseState(JSON.stringify({ counts })).counts)).toHaveLength(100);
  });
});

describe('two copies of the app (browser tabs)', () => {
  /** One saved value shared by several store views. A write wakes the other views, as a `storage` event does. */
  function sharedStorage() {
    let saved: string | null = null;
    const views: Array<{ wake: () => void }> = [];
    return {
      view(): TelemetryStore {
        const mine: { wake: () => void } = { wake: () => undefined };
        views.push(mine);
        return {
          read: async () => saved,
          write: async (json) => {
            saved = json;
            for (const v of views) if (v !== mine) v.wake();
          },
          subscribe(listener) {
            mine.wake = listener;
            return () => { mine.wake = () => undefined; };
          },
        };
      },
    };
  }

  it('does not turn counting back on in a tab that was open before the person turned it off', async () => {
    const shared = sharedStorage();
    const a = createTelemetry(shared.view());
    const b = createTelemetry(shared.view());
    await Promise.all([a.ready, b.ready]);
    await a.setEnabled(true);
    await vi.waitFor(() => expect(b.isEnabled()).toBe(true));
    await a.setEnabled(false);
    await vi.waitFor(() => expect(b.isEnabled()).toBe(false));
    await b.count('app_opened', 'online');
    expect(b.snapshot().total).toBe(0);
    const c = createTelemetry(shared.view());
    await c.ready;
    expect(c.isEnabled()).toBe(false);
    expect(c.snapshot().total).toBe(0);
  });

  it('keeps the counts both tabs made, one after the other', async () => {
    const shared = sharedStorage();
    const a = createTelemetry(shared.view());
    const b = createTelemetry(shared.view());
    await Promise.all([a.ready, b.ready]);
    await a.setEnabled(true);
    await vi.waitFor(() => expect(b.isEnabled()).toBe(true));
    await a.count('app_opened', 'online');
    await vi.waitFor(() => expect(b.snapshot().counts.app_opened).toEqual({ online: 1 }));
    await b.count('app_opened', 'online');
    await vi.waitFor(() => expect(a.snapshot().counts.app_opened).toEqual({ online: 2 }));
    expect(b.snapshot().counts.app_opened).toEqual({ online: 2 });
  });
});

describe('what can be counted', () => {
  it('counts a feature attempt and a failed attempt separately, so a success rate can be worked out', async () => {
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    for (const f of ['time_machine', 'backup', 'access_mode', 'template'] as const) await t.count('feature_used', f);
    await t.count('feature_used', 'backup');
    await t.count('feature_failed', 'backup');
    await t.count('feature_failed', 'diary');
    const { counts } = t.snapshot();
    expect(counts.feature_used).toEqual({ time_machine: 1, backup: 2, access_mode: 1, template: 1 });
    expect(counts.feature_failed).toEqual({ backup: 1 });
  });

  it('counts the flow steps from docs/01 and nothing else', async () => {
    const t = createTelemetry(memoryStore().store);
    await t.setEnabled(true);
    for (const step of ['onboarding_completed', 'creation_started', 'compilation_failed', 'record_created', 'offline_operation_completed']) {
      await t.count('flow', step);
    }
    await t.count('flow', 'preview_opened');
    expect(t.snapshot().total).toBe(5);
  });
});

describe('a subscriber that throws', () => {
  it('does not break counting, saving or the failure report', async () => {
    const t = createTelemetry(memoryStore().store);
    t.subscribe(() => { throw new Error('bad subscriber'); });
    await expect(t.setEnabled(true)).resolves.toBe(true);
    await expect(t.count('app_opened', 'online')).resolves.toBeUndefined();
    expect(t.snapshot().total).toBe(1);
    installTelemetry(t);
    expect(() => reportError('timeout')).not.toThrow();
  });
});

describe('reportError', () => {
  it('keeps the code for a typed error that has no code of its own, by class name only', () => {
    class InvalidSpecError extends Error {
      constructor() {
        super('App design failed validation: screens[0] Asha Verma');
        this.name = 'InvalidSpecError';
      }
    }
    expect(reportError(new InvalidSpecError())).toBe('invalid_spec');
    expect(errorLog.recent()[0].code).toBe('invalid_spec');
    expect(JSON.stringify(errorLog.recent())).not.toContain('Asha');
  });

  it('does not list or count the persons own choices as errors', async () => {
    const t = createTelemetry(memoryStore().store);
    installTelemetry(t);
    await t.setEnabled(true);
    expect(reportError('cancelled')).toBe('cancelled');
    expect(reportError({ code: 'consent_denied' })).toBe('consent_denied');
    expect(reportError('timeout')).toBe('timeout');
    await vi.waitFor(() => expect(t.snapshot().counts.error).toEqual({ timeout: 1 }));
    expect(errorLog.recent().map((e) => e.code)).toEqual(['timeout']);
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
