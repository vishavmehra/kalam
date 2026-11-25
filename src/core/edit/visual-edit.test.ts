import { describe, expect, it, vi } from 'vitest';
import type { EditOutcome, SpecPatchOp } from '../contracts';
import type { KalamSpec } from '../spec/schema';
import { validateSpec } from '../spec/validate';
import { applyPatchOps } from './apply';
import {
  contextualInstruction, describeOps, diffParts, moveOps, partName, planVisualEdit, runVisualEdit, scopeOps,
  type VisualEditRequest, type VisualGesture,
} from './visual-edit';

const raw = {
  id: 'expense_book', schemaVersion: '1.0.0', version: 3, name: 'Expense book', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1, background: '#FFFFFF', text: '#1A1A1A' },
  collections: {
    expenses: {
      label: 'Expenses',
      fields: {
        amount: { type: 'number', label: 'Amount', required: true },
        note: { type: 'text', label: 'Note' },
        paid: { type: 'boolean', label: 'Paid' },
      },
    },
  },
  screens: [
    {
      id: 'add', title: 'Add expense', form: 'expenses', children: [
        { id: 'title', type: 'heading', label: 'New expense' },
        { id: 'amount_in', type: 'number', label: 'Amount', field: 'amount' },
        { id: 'note_in', type: 'textInput', label: 'Note', field: 'note' },
        { id: 'paid_in', type: 'toggle', label: 'Paid', field: 'paid' },
        { id: 'save_btn', type: 'bigButton', label: 'Save', action: 'save_expense' },
        { id: 'total', type: 'stat', label: 'Total spent', expr: 'sum(expenses.amount)', format: 'currency', currency: 'INR' },
      ],
    },
    {
      id: 'all', title: 'All expenses', children: [
        { id: 'expense_list', type: 'list', label: 'Expenses', source: 'expenses', primary: 'note' },
        { id: 'save_btn_2', type: 'bigButton', label: 'Save', action: 'go_add' },
      ],
    },
  ],
  initialScreen: 'add',
  actions: {
    save_expense: { type: 'insert', collection: 'expenses', then: { feedback: 'Saved' } },
    go_add: { type: 'navigate', screen: 'add' },
  },
  aiBlocks: {}, intents: {}, meta: { createdAt: 1_700_000_000_000 },
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}
const checked = validateSpec(raw);
if (!checked.ok || !checked.spec) throw new Error(`fixture invalid: ${JSON.stringify(checked.errors)}`);
const spec: KalamSpec = deepFreeze(checked.spec);
const snapshot = JSON.stringify(spec);

const req = (targets: string[], gesture: VisualGesture, instruction?: string, screenId = 'add'): VisualEditRequest => ({
  appId: spec.id, baseVersion: spec.version, screenId, targets, gesture, instruction, source: 'drawing_overlay',
});
const childIds = (s: KalamSpec | undefined, screen = 'add') => s?.screens.find((x) => x.id === screen)?.children.map((c) => c.id);
const part = (s: KalamSpec | undefined, id: string) => s?.screens.flatMap((x) => x.children).find((c) => c.id === id);

/** A fake edit service that behaves like the real one: applies ops through applyPatchOps. */
function fakeService(reply: Partial<EditOutcome> & { ops?: SpecPatchOp[] }) {
  return {
    applyInstruction: vi.fn(async (s: KalamSpec, _text: string): Promise<EditOutcome> => {
      const base: EditOutcome = { ok: false, editClass: 'small', route: 'on_device', provider: 'firebase', summary: 'x', errors: [], latencyMs: 5 };
      if (!reply.ops || reply.ok === false) return { ...base, ...reply, ok: false };
      const res = applyPatchOps(s, reply.ops);
      return { ...base, ...reply, ok: res.ok, spec: res.spec, errors: res.errors };
    }),
  };
}
const noService = () => ({ applyInstruction: vi.fn(async (): Promise<EditOutcome> => { throw new Error('AI must not be called'); }) });

const NO_DASH = /[–—]/;

describe('runVisualEdit: deterministic marks', () => {
  it('cross removes the picked part, warns about what it did, and leaves the input alone', async () => {
    const edit = noService();
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'remove' }), { edit });
    expect(out.ok).toBe(true);
    expect(out.route).toBe('deterministic');
    expect(childIds(out.spec)).not.toContain('save_btn');
    expect(out.summary).toBe('Removed the "Save" button');
    expect(out.warnings).toEqual(['Without the "Save" button, entries on this screen can\'t be saved.']);
    expect(validateSpec(out.spec).ok).toBe(true);
    expect(JSON.stringify(spec)).toBe(snapshot);
    expect(edit.applyInstruction).not.toHaveBeenCalled();
  });

  it('cross in hide mode hides instead of removing', async () => {
    const out = await runVisualEdit(spec, req(['note_in'], { kind: 'remove', mode: 'hide' }), { edit: noService() });
    expect(part(out.spec, 'note_in')).toMatchObject({ visible: false });
    expect(out.summary).toBe('Hid the "Note" field');
  });

  it('circle + "bigger, green" on a button: app text size and main colour, said plainly', async () => {
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'Bigger, green.'), { edit: noService() });
    expect(out.ok).toBe(true);
    expect(out.ops).toEqual([
      { op: 'setThemeNumber', token: 'fontScale', value: 1.1 },
      { op: 'setThemeToken', token: 'primary', value: '#2E7D32' },
    ]);
    expect(out.appWide).toBe(true);
    expect(out.spec?.theme).toMatchObject({ fontScale: 1.1, primary: '#2E7D32' });
    expect(out.summary).toBe('Made all text and buttons bigger; changed the main colour to green');
    expect(out.notes.join(' ')).toMatch(/one text size/);
    for (const s of [out.summary, ...out.notes]) expect(s).not.toMatch(NO_DASH);
  });

  it('circle + "make it red" on a button changes only that button', async () => {
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'make it red'), { edit: noService() });
    expect(out.ops).toEqual([{ op: 'setComponentProperty', component: 'save_btn', property: 'tone', value: 'danger' }]);
    expect(out.appWide).toBe(false);
    expect(part(out.spec, 'save_btn_2')).not.toHaveProperty('tone');
    expect(out.summary).toBe('Made the "Save" button red');
  });

  it('a green request on a red button also switches that button back to the main colour', async () => {
    const red = (await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'red'), { edit: noService() })).spec as KalamSpec;
    const out = await runVisualEdit(red, req(['save_btn'], { kind: 'select' }, 'green'), { edit: noService() });
    expect(part(out.spec, 'save_btn')).toMatchObject({ tone: 'primary' });
    expect(out.spec?.theme.primary).toBe('#2E7D32');
  });

  it('rename goes to the picked part by id, even when another part has the same label', async () => {
    const out = await runVisualEdit(spec, req(['save_btn_2'], { kind: 'select' }, 'rename to Add more', 'all'), { edit: noService() });
    expect(out.ops).toEqual([{ op: 'renameComponent', component: 'save_btn_2', label: 'Add more' }]);
    expect(part(out.spec, 'save_btn')).toMatchObject({ label: 'Save' });
  });

  it.each([
    ['call it "Pay now"', 'Pay now'],
    ['it should say Pay', 'Pay'],
    ['rename to Tea and Coffee', 'Tea and Coffee'],
    ['naam Jama karo', 'Jama'],
  ])('reads "%s" as a new label', async (words, label) => {
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, words), { edit: noService() });
    expect(out.ops).toEqual([{ op: 'renameComponent', component: 'save_btn', label }]);
  });

  it('splits a rename from a colour when both are asked', async () => {
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'rename to Pay and make it blue'), { edit: noService() });
    expect(out.ops.map((o) => o.op)).toEqual(['renameComponent', 'setThemeToken']);
  });

  it('scribble + words renames; scribble with no words asks for them', async () => {
    const out = await runVisualEdit(spec, req(['title'], { kind: 'relabel' }, '"Today\'s spend"'), { edit: noService() });
    expect(part(out.spec, 'title')).toMatchObject({ label: "Today's spend" });
    const empty = await runVisualEdit(spec, req(['title'], { kind: 'relabel' }), { edit: noService() });
    expect(empty).toMatchObject({ ok: false, needs: 'label' });
    expect(empty.message).toBe('Type the new words for the heading "New expense".');
  });

  it('a one-line text box that should be bigger gets room to write (scoped, not app-wide)', async () => {
    const out = await runVisualEdit(spec, req(['note_in'], { kind: 'select' }, 'bigger'), { edit: noService() });
    expect(out.ops).toEqual([{ op: 'setComponentProperty', component: 'note_in', property: 'multiline', value: true }]);
    expect(out.appWide).toBe(false);
    expect(out.summary).toBe('Gave the "Note" field more room to write');
  });

  it('required / hint on an input stay on that input', async () => {
    const req1 = await runVisualEdit(spec, req(['note_in'], { kind: 'select' }, 'make it required'), { edit: noService() });
    expect(part(req1.spec, 'note_in')).toMatchObject({ required: true });
    const hint = await runVisualEdit(spec, req(['amount_in'], { kind: 'select' }, 'hint: e.g. 250'), { edit: noService() });
    expect(part(hint.spec, 'amount_in')).toMatchObject({ placeholder: 'e.g. 250' });
  });

  it('refuses colours that would make text hard to read', async () => {
    const out = await runVisualEdit(spec, req(['title'], { kind: 'select' }, 'yellow'), { edit: noService() });
    expect(out.ok).toBe(false);
    expect(out.message).toBe('Yellow text would be hard to read on this background. Try a darker colour.');
  });

  it('asks for words, or for one part, when the request is incomplete', async () => {
    expect(await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }), { edit: noService() })).toMatchObject({ ok: false, needs: 'instruction' });
    expect(await runVisualEdit(spec, req(['save_btn', 'title'], { kind: 'select' }, 'rename to Pay'), { edit: noService() }))
      .toMatchObject({ ok: false, needs: 'single_target' });
    expect(await runVisualEdit(spec, req(['ghost'], { kind: 'remove' }), { edit: noService() })).toMatchObject({ ok: false, needs: 'target' });
  });
});

describe('arrows and notes', () => {
  it('moveOps places a part just before another, or at the end', () => {
    const apply = (ops: SpecPatchOp[]) => childIds(applyPatchOps(spec, ops).spec);
    expect(apply(moveOps(spec, 'save_btn', 'amount_in'))).toEqual(['title', 'save_btn', 'amount_in', 'note_in', 'paid_in', 'total']);
    expect(apply(moveOps(spec, 'title', null))).toEqual(['amount_in', 'note_in', 'paid_in', 'save_btn', 'total', 'title']);
    expect(moveOps(spec, 'amount_in', 'note_in')).toEqual([]);
  });

  it('arrow from a part to a gap moves it, with a plain summary', async () => {
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'move', before: 'amount_in' }), { edit: noService() });
    expect(childIds(out.spec)?.slice(0, 3)).toEqual(['title', 'save_btn', 'amount_in']);
    expect(out.summary).toBe('Moved the "Save" button above the "Amount" field');
    const end = await runVisualEdit(spec, req(['title'], { kind: 'move', before: null }), { edit: noService() });
    expect(end.summary).toBe('Moved the heading "New expense" to the end of the screen');
  });

  it('an arrow that ends where the part already is changes nothing', async () => {
    const out = await runVisualEdit(spec, req(['amount_in'], { kind: 'move', before: 'note_in' }), { edit: noService() });
    expect(out).toMatchObject({ ok: false, message: 'It is already there.' });
  });

  it('a text note on empty space becomes text at that spot', async () => {
    const out = await runVisualEdit(spec, req([], { kind: 'note', text: 'Closed on Sundays', before: 'paid_in' }), { edit: noService() });
    expect(out.ok).toBe(true);
    expect(out.ops).toEqual([{ op: 'addComponent', screen: 'add', index: 3, component: { id: 'note_text', type: 'text', label: 'Closed on Sundays' } }]);
    expect(out.summary).toBe('Added the note "Closed on Sundays"');
  });

  it('a note that reads like an instruction goes to the edit service with the spot named', async () => {
    const edit = fakeService({ route: 'cloud', editClass: 'structural', ops: [
      { op: 'updateCollectionField', collection: 'expenses', field: 'phone', definition: { type: 'text', label: 'Phone' } },
      { op: 'addComponent', screen: 'add', index: 3, component: { id: 'phone_in', type: 'textInput', label: 'Phone', field: 'phone' } },
    ] });
    const out = await runVisualEdit(spec, req([], { kind: 'note', text: 'add a phone field here', before: 'paid_in' }), { edit });
    expect(edit.applyInstruction).toHaveBeenCalledTimes(1);
    expect(edit.applyInstruction.mock.calls[0]?.[1]).toContain('just above part paid_in');
    expect(out.ok).toBe(true);
    expect(out.editClass).toBe('structural');
    expect(out.route).toBe('cloud');
    expect(childIds(out.spec)).toContain('phone_in');
  });

  it('a note written on a part is an instruction for that part', async () => {
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'note', text: 'bigger' }), { edit: noService() });
    expect(out.ops).toEqual([{ op: 'setThemeNumber', token: 'fontScale', value: 1.1 }]);
  });
});

describe('runVisualEdit: words Kalam cannot map alone', () => {
  it('sends the words with the picked ids (no labels) and keeps the result to the picked part', async () => {
    const edit = fakeService({ ops: [
      { op: 'setComponentProperty', component: 'save_btn', property: 'tone', value: 'secondary' },
      { op: 'renameComponent', component: 'total', label: 'Sum' },
    ] });
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'make it less loud'), { edit });
    const sent = edit.applyInstruction.mock.calls[0]?.[1] ?? '';
    expect(sent).toContain('make it less loud');
    expect(sent).toContain('bigButton save_btn');
    expect(sent).not.toContain('"Save"');
    expect(out.ok).toBe(true);
    expect(out.route).toBe('on_device');
    expect(out.ops).toEqual([{ op: 'setComponentProperty', component: 'save_btn', property: 'tone', value: 'secondary' }]);
    expect(part(out.spec, 'total')).toMatchObject({ label: 'Total spent' });
    expect(out.notes).toEqual(['Kalam left the other parts of the app as they were.']);
    expect(out.summary).toBe('Made the "Save" button plain');
  });

  it('rejects a suggestion that only touches other parts', async () => {
    const edit = fakeService({ ops: [{ op: 'removeComponent', component: 'total' }] });
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'make it pop'), { edit });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/changed other parts/);
  });

  it('passes on the service message when the change cannot be made (for example offline)', async () => {
    const edit = fakeService({ ok: false, route: 'cloud', provider: 'none', message: "You're offline. This change needs the internet." });
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'make it pop'), { edit });
    expect(out).toMatchObject({ ok: false, route: 'cloud', message: "You're offline. This change needs the internet." });
  });

  it('does not trust a parser result that came from the added context instead of the words', async () => {
    const edit = fakeService({ route: 'deterministic', provider: 'deterministic', ops: [{ op: 'setThemeToken', token: 'primary', value: '#D32F2F' }] });
    const out = await runVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'make it pop'), { edit });
    expect(out.ok).toBe(false);
  });

  it('a cross with other words asks the service, naming what was crossed out', async () => {
    const edit = fakeService({ ops: [{ op: 'renameComponent', component: 'save_btn', label: 'Pay' }] });
    await runVisualEdit(spec, req(['save_btn'], { kind: 'remove' }, 'replace with a pay button'), { edit });
    expect(edit.applyInstruction).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('names parts plainly', () => {
    const names = spec.screens.flatMap((s) => s.children).map(partName);
    expect(names).toEqual([
      'the heading "New expense"', 'the "Amount" field', 'the "Note" field', 'the "Paid" switch', 'the "Save" button',
      'the "Total spent" number', 'the "Expenses" list', 'the "Save" button',
    ]);
  });

  it('scopeOps keeps theme and additive ops, drops other parts and screen removal', () => {
    const { kept, dropped } = scopeOps([
      { op: 'setThemeToken', token: 'primary', value: '#000000' },
      { op: 'renameComponent', component: 'total', label: 'x' },
      { op: 'removeScreen', screen: 'all' },
      { op: 'addComponent', screen: 'add', component: { id: 'new_one', type: 'text', label: 'Hi' } },
      { op: 'moveComponent', component: 'new_one', direction: 'up' },
      { op: 'renameScreen', screen: 'add', title: 'Spend' },
    ], ['save_btn'], 'add');
    expect(kept.map((o) => o.op)).toEqual(['setThemeToken', 'addComponent', 'moveComponent', 'renameScreen']);
    expect(dropped.map((o) => o.op)).toEqual(['renameComponent', 'removeScreen']);
  });

  it('describeOps collapses repeated moves and has no dashes', () => {
    const s = describeOps(spec, moveOps(spec, 'total', 'amount_in'));
    expect(s).toBe('Moved the "Total spent" number up');
    expect(s).not.toMatch(NO_DASH);
  });

  it('diffParts flags just the moved part, plus added, removed and changed parts', () => {
    const moved = applyPatchOps(spec, [...moveOps(spec, 'save_btn', 'title'), { op: 'renameComponent', component: 'total', label: 'Spent' }]).spec as KalamSpec;
    const d = diffParts(spec, moved);
    expect(d.moved).toEqual(['save_btn']);
    expect(d.changed).toEqual(['total']);
    expect(d.appChanged).toBe(false);
    const other = applyPatchOps(spec, [{ op: 'removeComponent', component: 'title' }, { op: 'setThemeNumber', token: 'radius', value: 20 }]).spec as KalamSpec;
    expect(diffParts(spec, other)).toMatchObject({ removed: ['title'], added: [], appChanged: true });
  });

  it('plans without side effects', () => {
    planVisualEdit(spec, req(['save_btn'], { kind: 'select' }, 'bigger and red'));
    expect(contextualInstruction(spec, req(['save_btn', 'total'], { kind: 'select' }), 'x')).toContain('Change only these parts');
    expect(JSON.stringify(spec)).toBe(snapshot);
  });
});
