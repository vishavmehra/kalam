import { describe, expect, it } from 'vitest';
import { archivedApps, backupFileName, formatBytes, passphraseStrength } from './helpers';

describe('storage helpers', () => {
  it('formats sizes in plain units', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatBytes(Number.NaN)).toBe('0 bytes');
  });

  it('rates passphrases: length and variety help, common words and runs do not', () => {
    expect(passphraseStrength('short').level).toBe('too_short');
    expect(passphraseStrength('aaaaaaaaaaaa').level).toBe('weak');
    expect(passphraseStrength('password1234').level).toBe('weak');
    expect(passphraseStrength('qwertyuiop12').level).toBe('weak');
    expect(passphraseStrength('blue kettle 42').level).toBe('fair');
    expect(passphraseStrength('mango tea ledger window').level).toBe('strong');
    expect(passphraseStrength('Ration-Card 7 Tulsi!').level).toBe('strong');
    for (const p of ['short', 'password1234', 'mango tea ledger window']) expect(passphraseStrength(p).hint).not.toMatch(/[—–]/);
  });

  it('names backup files by date', () => {
    expect(backupFileName(new Date(2026, 10, 18, 9).getTime())).toBe('kalam-backup-2026-11-18.kalambackup');
  });

  it('lists archived apps, newest change first, and leaves the rest of the shelf out (D11-026)', () => {
    const app = (id: string, name: string, updatedAt: number, archived?: boolean) => ({ id, spec: { name }, updatedAt, ...(archived === undefined ? {} : { archived }) });
    const rows = archivedApps([app('a', 'Rent', 10, true), app('b', 'Milk', 30, true), app('c', 'Fees', 20), app('d', 'Zoo', 5, false), app('e', 'Atta', 30, true)]);
    expect(rows.map((r) => r.id)).toEqual(['e', 'b', 'a']);
    expect(rows[0]).toEqual({ id: 'e', name: 'Atta', changedAt: 30 });
    expect(archivedApps([])).toEqual([]);
  });
});
