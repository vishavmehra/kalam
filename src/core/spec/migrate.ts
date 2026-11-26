/**
 * Schema migrations (docs/05 §16). Deterministic, pure, never mutate their input. A migrated
 * document still has to pass `validateSpec` before use; this module only changes its shape.
 */
import { SCHEMA_VERSION } from './schema';

export interface SpecMigration {
  fromVersion: string;
  toVersion: string;
  migrate(input: Readonly<Record<string, unknown>>): Record<string, unknown>;
}
export interface MigrationResult {
  ok: boolean;
  spec?: unknown;
  /** Set when at least one migration ran. */
  migratedFrom?: string;
  error?: string;
}

/**
 * Registry. 1.0.0 → 1.1.0 is additive (docs/05 §15.2): every 1.0 document is already a valid 1.1
 * document, so only the format number changes. Older minors are migrated (ADR-024).
 */
export const SPEC_MIGRATIONS: readonly SpecMigration[] = [
  { fromVersion: '1.0.0', toVersion: '1.1.0', migrate: (doc) => ({ ...doc }) },
];

const parseVersion = (v: string): [number, number, number] | undefined => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Migration with an explicit registry (exported for tests). */
export function migrateSpecWith(
  input: unknown,
  migrations: readonly SpecMigration[],
  current: string = SCHEMA_VERSION,
): MigrationResult {
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { ok: false, error: 'This file is not valid JSON.' }; }
  }
  if (!isObject(raw)) return { ok: false, error: 'This is not a Kalam app.' };
  const from = raw.schemaVersion;
  if (typeof from !== 'string' || !parseVersion(from)) return { ok: false, error: 'This app has no format version.' };
  const [major] = parseVersion(from) as [number, number, number];
  const [curMajor] = parseVersion(current) as [number, number, number];
  if (major > curMajor) {
    return { ok: false, error: `This app needs a newer version of Kalam (format ${from}). Update Kalam to open it.` };
  }

  let doc: Record<string, unknown> = clone(raw);
  let version = from;
  const seen = new Set<string>();
  // Same major: newer or equal minor/patch passes through unchanged (validateSpec decides).
  while (parseVersion(version)?.[0] !== curMajor || (version !== current && migrations.some((m) => m.fromVersion === version))) {
    const step = migrations.find((m) => m.fromVersion === version);
    if (!step || seen.has(version)) return { ok: false, error: `No upgrade path from format ${version} to ${current}.` };
    seen.add(version);
    doc = step.migrate(doc);
    doc.schemaVersion = step.toVersion;
    version = step.toVersion;
  }
  return version === from ? { ok: true, spec: doc } : { ok: true, spec: doc, migratedFrom: from };
}

/** Brings a stored/imported document up to the current schema version (or explains why not). */
export function migrateSpec(input: unknown): MigrationResult {
  return migrateSpecWith(input, SPEC_MIGRATIONS);
}
