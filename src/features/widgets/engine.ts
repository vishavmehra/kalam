/**
 * The app's own formatting and list rules, handed to the widget core (`WidgetEngine`). A widget goes through the same
 * functions the app's screens use, so a stat on the home screen reads the same as on its screen (docs/14 §18.5).
 */
import type { WidgetEngine } from '@/core/widgets';
import { statCurrency } from '@/core/spec/v11';
import { evaluate, formatFieldValue, formatStat, queryList } from '@/runtime/engine/data';
import { collectionFieldDefs } from '@/runtime/engine/fields';

export const widgetEngine: WidgetEngine = {
  statText: (spec, stat, ctx) => formatStat(stat, evaluate(stat.expr, ctx, spec.lang), spec.lang, statCurrency(spec, stat)),
  listRows: (list, records, ctx, lang) => queryList(list, [...records], ctx, lang).rows,
  fieldText: (spec, collectionId, fieldId, value, lang) => formatFieldValue(collectionFieldDefs(spec, collectionId)?.[fieldId], value, lang),
};
