import type { WidgetEntryBody } from '@/core/widgets';
import { WIDGET_UI } from './copy';

/**
 * What a screen reader says for a widget card: the app, the name, the figure, each row (with its tick) and the note. One
 * place, so the preview in the form and the card on the shelf say the same thing.
 */
export function widgetSaid(appName: string, title: string, body: WidgetEntryBody): string {
  const row = (r: WidgetEntryBody['rows'][number]) =>
    [r.text, r.detail, r.done === undefined ? undefined : r.done ? WIDGET_UI.preview.done : WIDGET_UI.preview.notDone].filter(Boolean).join(', ');
  return [appName, title, body.headline, ...body.rows.map(row), body.note].filter(Boolean).join('. ');
}
