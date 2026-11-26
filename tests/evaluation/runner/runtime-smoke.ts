/**
 * Runtime success check (docs/15 §11.3): a built app's formulas and list filters must run through the real
 * runtime engine without error, first on empty data and then on one sample record per collection. This is a
 * headless smoke test of the same code the screens use; it does not render anything.
 * Kept out of runner/index.ts because it pulls in the runtime engine.
 */
import type { KalamRecord, RecordValue } from '@/core/contracts';
import type { KalamField, KalamSpec } from '@/core/spec/schema';
import { collectionValues, defaultForm, evaluate, formulaContext, queryList } from '@/runtime/engine';
import type { RuntimeSmoke } from './evaluate';

const NOW = new Date('2026-01-15T10:00:00Z');

function sampleValue(f: KalamField): RecordValue {
  switch (f.type) {
    case 'text':
      return 'Sample';
    case 'number':
      return f.min !== undefined && f.min > 1 ? f.min : 1;
    case 'date':
      return '2026-01-15';
    case 'boolean':
      return false;
    case 'enum':
      return f.options[0] ?? '';
    case 'image':
      return null;
  }
}

export function sampleRecords(spec: KalamSpec): Record<string, KalamRecord[]> {
  const out: Record<string, KalamRecord[]> = {};
  for (const [id, c] of Object.entries(spec.collections)) {
    const values: Record<string, RecordValue> = {};
    for (const [fid, f] of Object.entries(c.fields)) values[fid] = sampleValue(f);
    out[id] = [{ id: `rec_${id}`, appId: spec.id, collectionId: id, createdAt: 1, updatedAt: 1, values }];
  }
  return out;
}

export function runtimeSmoke(spec: KalamSpec): RuntimeSmoke {
  const failed: string[] = [];
  let evaluated = 0;
  const datasets: Array<[string, Record<string, KalamRecord[]>]> = [
    ['empty data', {}],
    ['sample data', sampleRecords(spec)],
  ];
  for (const [label, records] of datasets) {
    const ctxFor = (form: Record<string, RecordValue>) =>
      formulaContext(collectionValues(spec, records), form, {}, NOW);
    for (const screen of spec.screens) {
      const ctx = ctxFor(defaultForm(spec, screen, NOW));
      for (const c of screen.children) {
        try {
          if (c.type === 'stat') {
            evaluated += 1;
            const r = evaluate(c.expr, ctx);
            if (!r.ok) failed.push(`${screen.id}.${c.id} on ${label}: ${r.error}`);
          } else if (c.type === 'list') {
            evaluated += 1;
            const q = queryList(c, records[c.source] ?? [], ctx);
            if (q.filterError) failed.push(`${screen.id}.${c.id} filter on ${label}: ${q.filterError}`);
          }
        } catch (e) {
          failed.push(`${screen.id}.${c.id} on ${label} threw: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    }
  }
  return { ok: failed.length === 0, evaluated, failed };
}
