/**
 * What the template preview shows (docs/14 §12.5 "preview it with synthetic sample data"), as plain data the
 * components draw. It uses the same list, total and field formatting code the real runtime uses, so the preview
 * says what the installed app would say, and every number comes from the made-up entries of the template.
 * Pure TypeScript: tested without rendering.
 */
import type { FormulaContext, KalamRecord, RecordValue } from '@/core/contracts';
import type { KalamComponent, KalamSpec } from '@/core/spec/schema';
import { resolveSample, type CatalogEntry } from '@/core/templates/catalog';
import { collectionValues, evaluate, formatFieldValue, formatStat, formulaContext, queryList } from '@/runtime/engine/data';
import { collectionFieldDefs } from '@/runtime/engine/fields';
import { importanceOf } from '@/core/spec';
import { statCurrency, v11FieldText } from '@/runtime/engine/v11';

export const PREVIEW_ROWS = 4;

export type PreviewBlock =
  | { kind: 'stat'; id: string; label: string; value: string; secondary: boolean }
  | { kind: 'list'; id: string; label: string; rows: PreviewRow[]; more: number; empty: string }
  | { kind: 'note'; id: string; label: string; heading: boolean }
  | { kind: 'fields'; id: string; labels: string[] }
  | { kind: 'buttons'; id: string; labels: string[] }
  | { kind: 'other'; id: string; label: string };

export interface PreviewRow { primary: string; secondary?: string; checked?: boolean }
export interface PreviewScreen { id: string; title: string; blocks: PreviewBlock[] }
export interface TemplatePreview {
  entryId: string;
  title: string;
  screens: PreviewScreen[];
  /** Number of made-up entries behind the numbers. */
  entries: number;
}

const OTHER_NOUN: Partial<Record<KalamComponent['type'], string>> = {
  chart: 'Chart', reminder: 'Reminder', photo: 'Photo', timer: 'Timer', signature: 'Signature', counter: 'Counter',
};
const INPUTS = new Set<string>(['number', 'textInput', 'date', 'choice', 'toggle']);

/** Components of one screen as blocks: runs of inputs and of buttons are folded into one line each. */
function blocksOf(
  spec: KalamSpec, screenIndex: number, records: Record<string, KalamRecord[]>, state: Record<string, RecordValue>,
  ctx: FormulaContext, lang: string,
): PreviewBlock[] {
  const screen = spec.screens[screenIndex]!;
  const out: PreviewBlock[] = [];
  const push = (b: PreviewBlock) => {
    const last = out[out.length - 1];
    if (b.kind === 'fields' && last?.kind === 'fields') last.labels.push(...b.labels);
    else if (b.kind === 'buttons' && last?.kind === 'buttons') last.labels.push(...b.labels);
    else out.push(b);
  };
  for (const c of screen.children) {
    if (c.visible === false) continue;
    if (INPUTS.has(c.type)) { push({ kind: 'fields', id: c.id, labels: ['label' in c && c.label ? c.label : c.id] }); continue; }
    switch (c.type) {
      case 'stat':
        out.push({ kind: 'stat', id: c.id, label: c.label, value: formatStat(c, evaluate(c.expr, ctx, lang), lang, statCurrency(spec, c)), secondary: importanceOf(c) === 'secondary' });
        break;
      case 'list': {
        const defs = collectionFieldDefs(spec, c.source) ?? {};
        const text = (r: KalamRecord, field: string | undefined): string | undefined => {
          if (!field) return undefined;
          const linked = v11FieldText(spec, c.source, field, r.values[field], records);
          return (linked ?? formatFieldValue(defs[field], r.values[field], lang)) || undefined;
        };
        const rows = queryList(c, records[c.source] ?? [], ctx, lang).rows;
        out.push({
          kind: 'list', id: c.id, label: c.label ?? spec.collections[c.source]?.label ?? c.source, more: Math.max(0, rows.length - PREVIEW_ROWS),
          empty: c.emptyText ?? '',
          rows: rows.slice(0, PREVIEW_ROWS).map((r) => ({
            primary: text(r, c.primary) ?? '',
            ...(text(r, c.secondary) ? { secondary: text(r, c.secondary) } : {}),
            ...(c.toggleField ? { checked: r.values[c.toggleField] === true } : {}),
          })),
        });
        break;
      }
      case 'bigButton': push({ kind: 'buttons', id: c.id, labels: [c.label] }); break;
      case 'text': case 'heading': out.push({ kind: 'note', id: c.id, label: c.label, heading: c.type === 'heading' }); break;
      default: {
        const noun = OTHER_NOUN[c.type] ?? c.type;
        const value = c.type === 'counter' && !c.field ? `${c.label}: ${String(state[c.id] ?? 0)}` : `${noun}: ${c.label}`;
        out.push({ kind: 'other', id: c.id, label: value });
      }
    }
  }
  return out;
}

/** The preview of one template on the day `now`. Same day, same preview. */
export function buildPreview(entry: CatalogEntry, now: Date, lang: string = entry.lang): TemplatePreview {
  const spec = entry.build({ appId: 'app_preview', now: now.getTime(), lang: entry.lang });
  const sample = resolveSample(entry, spec, now);
  const values = collectionValues(spec, sample.records);
  const screens = spec.screens.map<PreviewScreen>((s, i) => {
    // A page about one entry (a customer's page) is shown for the first made-up entry of its list.
    const opened = s.form ? sample.records[s.form]?.[0]?.id ?? null : null;
    const ctx = { ...formulaContext(values, sample.form, sample.state, now), selected: opened };
    return { id: s.id, title: s.title, blocks: blocksOf(spec, i, sample.records, sample.state, ctx, lang) };
  });
  return { entryId: entry.id, title: spec.name, screens, entries: Object.values(sample.records).reduce((n, rows) => n + rows.length, 0) };
}
