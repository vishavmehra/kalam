import { describe, expect, it } from 'vitest';
import { newDraft, widgetSources, type WidgetDefinition } from '@/core/widgets';
import { chaiSpec } from '@/core/widgets/test-kit';
import { chooseCandidate, draftFromForm, emptyForm, formFromWidget, formProblems, keyOfSource, toggleField } from './form-model';

const candidates = widgetSources(chaiSpec());
const stat = candidates.find((c) => c.kind === 'stat')!;
const list = candidates.find((c) => c.kind === 'list')!;
const count = candidates.find((c) => c.key === 'count:orders')!;

describe('the New widget form', () => {
  it('starts empty and says what is missing, in order', () => {
    const f = emptyForm();
    expect(formProblems(f, candidates).map((p) => p.field)).toEqual(['key', 'title']);
    expect(draftFromForm('app_chai01', f, candidates)).toBeUndefined();
  });

  it('picking something fills in a name and safe defaults', () => {
    const f = chooseCandidate(emptyForm(), stat);
    expect(f).toMatchObject({ key: 'stat:home:cups', title: 'Cups sold', size: 'small', refresh: 'live', hideWhenLocked: true });
    expect(draftFromForm('app_chai01', f, candidates)).toEqual({
      appId: 'app_chai01', title: 'Cups sold', source: { kind: 'stat', screen: 'home', component: 'cups' },
      size: 'small', refresh: 'live', hideWhenLocked: true, tap: { type: 'open_app' },
    });
  });

  it('keeps a name the person typed when they pick something else', () => {
    const typed = { ...chooseCandidate(emptyForm(), stat), title: 'My cups', titleEdited: true };
    expect(chooseCandidate(typed, count).title).toBe('My cups');
    expect(chooseCandidate(chooseCandidate(emptyForm(), stat), count).title).toBe(count.label);
  });

  it('a list starts on its own fields, a medium size and three rows', () => {
    const f = chooseCandidate(emptyForm(), list);
    expect(f).toMatchObject({ rows: 3, fields: ['name', 'qty', 'paid'], size: 'medium' });
    expect(draftFromForm('app_chai01', f, candidates)?.source).toEqual({ kind: 'list', screen: 'home', component: 'due_today', rows: 3, fields: ['name', 'qty', 'paid'] });
  });

  it('needs at least one field for a list, and lets a field go and come back in the list\'s order', () => {
    let f = chooseCandidate(emptyForm(), list);
    for (const id of ['name', 'qty', 'paid']) f = toggleField(f, list, id);
    expect(f.fields).toEqual([]);
    expect(formProblems(f, candidates).map((p) => p.field)).toEqual(['fields']);
    f = toggleField(toggleField(f, list, 'qty'), list, 'name');
    expect(f.fields).toEqual(['name', 'qty']);
  });

  it('never keeps more than two text fields and one tick: a third text field replaces the oldest', () => {
    let f = { ...chooseCandidate(emptyForm(), list), fields: [] as string[] };
    f = toggleField(toggleField(f, list, 'paid'), list, 'qty');
    expect(f.fields).toEqual(['qty', 'paid']);
    f = toggleField(f, list, 'name');
    expect(f.fields).toEqual(['name', 'qty', 'paid']);
    f = toggleField(f, list, 'due');
    expect(f.fields).toEqual(['qty', 'due', 'paid']);
    expect(toggleField(f, list, 'photo')).toEqual(f);
  });

  it('turns a tap on a screen into a typed action', () => {
    const f = { ...chooseCandidate(emptyForm(), count), tapScreen: 'add', refresh: 'on_open' as const, hideWhenLocked: false };
    expect(draftFromForm('app_chai01', f, candidates)).toMatchObject({ tap: { type: 'open_screen', screen: 'add' }, refresh: 'on_open', hideWhenLocked: false });
  });

  it('edits a saved widget, and starts with nothing chosen when its source is gone', () => {
    const w: WidgetDefinition = { ...newDraft('app_chai01', 'Due', { ...list.ref }), id: 'wgt_a1b2c3d4e5', v: 1, createdAt: 1, updatedAt: 1 };
    expect(formFromWidget(w, candidates)).toMatchObject({ key: keyOfSource(list.ref), title: 'Due', titleEdited: true, rows: 3, fields: ['name', 'qty', 'paid'] });
    const gone: WidgetDefinition = { ...w, source: { kind: 'stat', screen: 'home', component: 'gone' } };
    expect(formFromWidget(gone, candidates).key).toBeUndefined();
  });
});
