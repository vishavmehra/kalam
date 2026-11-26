import { describe, expect, it } from 'vitest';
import { WIDGET_UI } from './copy';
import { widgetSaid } from './said';

describe('what a screen reader says for a widget card', () => {
  it('says the app, the name, the figure, each row with its tick, and the note', () => {
    const said = widgetSaid('Chai Shop', 'Due today', {
      headline: '2 cups',
      rows: [{ text: 'Tea', detail: '3', done: true }, { text: 'Coffee', done: false }, { text: 'Lassi' }],
      note: 'Open Kalam to update',
    });
    expect(said).toBe(
      `Chai Shop. Due today. 2 cups. Tea, 3, ${WIDGET_UI.preview.done}. Coffee, ${WIDGET_UI.preview.notDone}. Lassi. Open Kalam to update`,
    );
  });

  it('says only what is there', () => {
    expect(widgetSaid('Chai Shop', 'Cups', { headline: '5 cups', rows: [] })).toBe('Chai Shop. Cups. 5 cups');
    expect(widgetSaid('', 'Cups', { rows: [], note: 'Nothing due today' })).toBe('Cups. Nothing due today');
  });
});
