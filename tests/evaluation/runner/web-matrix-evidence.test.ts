/**
 * Guards the recorded Chrome matrix (docs/17 §12.1; D17-003, D17-010, D17-044, D13-025). The run itself is real and billed
 * (`node scripts/record-evidence.mjs web-matrix`); this test only keeps the recorded file honest: every scenario is there, passed, and
 * says the source the screen would show (device for a real Nano answer, cloud otherwise), with no secret in it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', '..', '..', 'docs', 'evidence');
const file = readdirSync(DIR)
  .filter((f) => /^web-matrix-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
  .at(-1);

interface Scenario {
  id: string;
  pass: boolean;
  how: string;
  failures: string[];
  observed: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}
const text = file ? readFileSync(join(DIR, file), 'utf8') : '';
const evidence = file
  ? (JSON.parse(text) as {
      exitCode: number;
      environment: Record<string, unknown>;
      result: { ok: boolean; scenarios: Scenario[] };
    })
  : undefined;
const by = (id: string): Scenario => evidence!.result.scenarios.find((s) => s.id === id)!;

describe.skipIf(!file)('recorded Chrome matrix', () => {
  it('has all nine scenarios, each passed, from a run that exited cleanly', () => {
    expect(evidence!.exitCode).toBe(0);
    expect(evidence!.result.ok).toBe(true);
    expect(evidence!.result.scenarios.map((s) => s.id).sort()).toEqual(['A', 'B', 'C', 'C2', 'D', 'E', 'F', 'G', 'H']);
    for (const s of evidence!.result.scenarios) {
      expect(s.failures, s.id).toEqual([]);
      expect(s.pass, s.id).toBe(true);
      expect(s.how.length, `${s.id} says what was done to the page`).toBeGreaterThan(20);
    }
    expect(evidence!.environment).toMatchObject({ sdk: expect.objectContaining({ firebase: expect.any(String) }) });
  });

  it('shows a real Nano answer as on_device and every other answer as cloud (the source indicator, FAI-10)', () => {
    expect(by('A').observed).toMatchObject({ availability: 'available', source: 'on_device', model: 'gemini-nano' });
    expect(by('A').events.at(-1)).toMatchObject({
      source: 'on_device',
      provider: 'firebase',
      ok: true,
      fallback: false,
    });
    for (const id of ['B', 'C2', 'D', 'E']) expect(by(id).observed, id).toMatchObject({ source: 'cloud' });
    expect(by('B').observed).toMatchObject({ apiExposed: false });
    expect(by('C2').observed).toMatchObject({ apiExposed: true });
    expect(['downloadable', 'downloading']).toContain(by('C2').observed.availability);
    // No event claims a source its route contradicts.
    for (const s of evidence!.result.scenarios) {
      for (const e of s.events.filter((x) => x.ok === true)) {
        if (e.source === 'on_device') expect(e.route, `${s.id}`).toBe('on_device');
        if (e.source === 'cloud') expect(e.route, `${s.id}`).toBe('cloud');
      }
    }
  });

  it('shows the fallback, App Check and offline behaviour', () => {
    expect(by('D').observed).toMatchObject({ source: 'cloud', fallbackUsed: true, cloudRequests: 1 });
    expect(by('D').events[0]).toMatchObject({ source: 'on_device', ok: false });
    expect(by('E').observed).toMatchObject({ appCheck: 'debug', allWithAppCheckHeader: true });
    expect(by('F').observed).toMatchObject({
      online: false,
      localSource: 'on_device',
      cloudSuccess: false,
      cloudErrorCode: 'offline',
      requestsSentWhileOffline: 0,
    });
    expect(String(by('F').observed.cloudMessage)).toMatch(/online/i);
    // The AI-step check (CP7): the cloud wrote the cases, Nano ran the step.
    expect(by('H').observed).toMatchObject({ device: expect.objectContaining({ availability: 'available' }) });
    expect(by('H').events.some((e) => e.source === 'cloud' && e.ok === true)).toBe(true);
    expect(by('H').events.some((e) => e.source === 'on_device' && e.ok === true)).toBe(true);
    // The reconnect: the first cloud-only request after the network returns goes through.
    expect(by('G').observed).toMatchObject({ online: true, success: true, source: 'cloud', cloudRequests: 1 });
  });

  it('holds no key, token or id of the project', () => {
    expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/\b[A-Za-z0-9_-]{40,}\b/);
    expect(text).not.toMatch(/X-Firebase-AppCheck["':\s]+\S{8,}/i);
  });
});
