/**
 * Plain sentences about a saved widget, for the list in settings and the sheet's summary.
 * They say what the widget shows and what it does, in words a person would use. Never ids, never values.
 */
import type { KalamSpec } from '../spec/schema';
import { joinList, WIDGET_COPY } from './copy';
import type { WidgetDefinition } from './model';
import { resolveSource } from './sources';

/** One line per fact: what it shows, how it refreshes, what happens on a locked device, what a tap does. */
export function describeWidget(spec: KalamSpec | undefined, def: WidgetDefinition): string[] {
  const app = spec?.name ?? 'an app that is gone';
  const r = spec ? resolveSource(spec, def.source) : undefined;
  const lines: string[] = [];
  if (r?.ok) {
    if (r.kind === 'stat') lines.push(WIDGET_COPY.shows.stat(r.stat.label, app));
    else if (r.kind === 'count') lines.push(WIDGET_COPY.shows.count(r.collection.label?.trim() || r.collectionId, app));
    else {
      const rows = def.source.kind === 'list' ? def.source.rows : 1;
      lines.push(WIDGET_COPY.shows.list(rows, r.list.label?.trim() || r.collection.label?.trim() || r.collectionId, app));
      lines.push(`Fields: ${joinList(r.fields.map((f) => f.label))}.`);
    }
  }
  lines.push(WIDGET_COPY.refresh[def.refresh]);
  lines.push(def.hideWhenLocked ? WIDGET_COPY.lock.hidden : WIDGET_COPY.lock.shown);
  if (def.tap.type === 'open_app') lines.push(WIDGET_COPY.tap.open_app);
  else {
    const target = def.tap.screen;
    lines.push(WIDGET_COPY.tap.open_screen(spec?.screens.find((s) => s.id === target)?.title ?? 'a screen'));
  }
  return lines;
}
