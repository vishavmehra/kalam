import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { migrateSpec, migrateSpecWith, validateSpec, type SpecMigration } from './index';

describe('migrateSpec', () => {
  it('passes the current version through as an independent copy', () => {
    const input = loadFixture('valid', 'gst-calculator');
    const before = JSON.stringify(input);
    const r = migrateSpec(input);
    expect(r.ok).toBe(true);
    expect(r.migratedFrom).toBeUndefined();
    expect(r.spec).toEqual(input);
    expect(r.spec).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(validateSpec(r.spec).ok).toBe(true);
  });

  it('accepts JSON text', () => {
    expect(migrateSpec(JSON.stringify(loadFixture('valid', 'gst-calculator'))).ok).toBe(true);
    expect(migrateSpec('{nope').error).toMatch(/not valid JSON/);
  });

  it('rejects newer majors, missing versions and non-objects', () => {
    expect(migrateSpec({ ...loadFixture('valid', 'gst-calculator'), schemaVersion: '2.1.0' }).error).toMatch(/newer version of Kalam/);
    expect(migrateSpec({ name: 'x' }).ok).toBe(false);
    expect(migrateSpec([]).ok).toBe(false);
  });

  it('rejects old versions with no upgrade path', () => {
    const r = migrateSpec({ ...loadFixture('valid', 'gst-calculator'), schemaVersion: '0.9.0' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No upgrade path from format 0\.9\.0/);
  });

  it('runs a migration chain without mutating the input', () => {
    const migrations: SpecMigration[] = [
      { fromVersion: '0.8.0', toVersion: '0.9.0', migrate: (d) => ({ ...d, screens: d.pages, pages: undefined }) },
      { fromVersion: '0.9.0', toVersion: '1.0.0', migrate: (d) => { const { pages: _drop, ...rest } = d; return rest; } },
    ];
    const current = loadFixture('valid', 'gst-calculator');
    const old: Record<string, unknown> = { ...current, schemaVersion: '0.8.0', pages: current.screens };
    delete old.screens;
    const before = JSON.stringify(old);
    const r = migrateSpecWith(old, migrations, '1.0.0');
    expect(r).toMatchObject({ ok: true, migratedFrom: '0.8.0' });
    expect(validateSpec(r.spec).ok).toBe(true);
    expect(JSON.stringify(old)).toBe(before);
  });

  it('detects migration cycles', () => {
    const loop: SpecMigration[] = [
      { fromVersion: '0.1.0', toVersion: '0.2.0', migrate: (d) => d },
      { fromVersion: '0.2.0', toVersion: '0.1.0', migrate: (d) => d },
    ];
    expect(migrateSpecWith({ schemaVersion: '0.1.0' }, loop, '1.0.0').ok).toBe(false);
  });
});
