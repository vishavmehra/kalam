import type { RecordValue } from '../../../contracts';
import { buildTableApp, type TableAppDef } from '../builder';
import type { CatalogCategory, CatalogEntry, SampleRow } from '../types';

export const AUTHOR = 'Kalam';

/** One made-up entry. `key` lets rows of another list link to it with `>key`. */
export const row = (values: Record<string, RecordValue>, key?: string): SampleRow => ({ ...(key ? { key } : {}), values });

/** A catalog entry built by the register-style builder. */
export function tableEntry(
  def: TableAppDef,
  x: { category: CatalogCategory; keywords: string[]; records: Record<string, SampleRow[]> },
): CatalogEntry {
  return {
    id: def.id,
    version: 1,
    title: def.name,
    description: def.description,
    category: x.category,
    lang: 'en',
    glyph: def.glyph,
    theme: def.theme,
    keywords: x.keywords,
    accessibility: def.accessibility,
    requiredAI: [],
    author: def.author,
    sample: { records: x.records },
    build: (opts) => buildTableApp(def, opts),
  };
}

/** Totals most money apps share: this month, in rupees. */
export const rupees = { format: 'currency' } as const;
