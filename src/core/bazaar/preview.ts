/**
 * Synthetic demo records for the Bazaar preview (docs/12 §8.1, §8.3). Made only from the spec's
 * field definitions, never from anyone's real data, so totals and lists have something to show.
 */
import type { KalamRecord, RecordValue } from '../contracts';
import type { KalamField, KalamSpec } from '../spec/schema';

const SAMPLES_PER_COLLECTION = 3;

function sampleValue(field: KalamField, i: number, today: Date): RecordValue {
  switch (field.type) {
    case 'text': return `${field.label} ${i + 1}`.slice(0, field.maxLength ?? 120);
    case 'number': {
      const v = (i + 1) * 10;
      return Math.min(field.max ?? v, Math.max(field.min ?? v, v));
    }
    case 'date': {
      const d = new Date(today.getTime() - i * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    case 'boolean': return i % 2 === 0;
    case 'enum': return field.options[i % field.options.length] ?? null;
    case 'image': return null; // a preview never invents a photo
  }
}

export function sampleRecords(spec: KalamSpec, appId: string, now: number): Record<string, KalamRecord[]> {
  const today = new Date(now);
  return Object.fromEntries(
    Object.entries(spec.collections).map(([collectionId, collection]) => [
      collectionId,
      Array.from({ length: SAMPLES_PER_COLLECTION }, (_, i): KalamRecord => ({
        id: `sample_${collectionId}_${i + 1}`,
        appId,
        collectionId,
        createdAt: now - i * 60_000,
        updatedAt: now - i * 60_000,
        values: Object.fromEntries(Object.entries(collection.fields).map(([fieldId, f]) => [fieldId, sampleValue(f, i, today)])),
      })),
    ]),
  );
}
