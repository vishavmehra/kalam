import { describe, expect, it, vi } from 'vitest';
import type { AccessModes, RuntimeServices, VoiceActionResult } from '@/core/contracts';
import { kalamSpecSchema, type KalamSpec } from '@/core/spec/schema';
import {
  buildHelpText, buildScreenAnnouncement, createMemoryStores, createRuntimeState, executeDeleteRecord, executeOpenRecord,
  executeVoiceCommand, interpretConfirmation, matchMetaCommand, parseRecordCommand, planRecordCommand, planVoiceCommand,
  resolveAppTheme, runtimeAnnouncesTitle, sanitizeVoiceFields, screenFieldDefs, speaksResults, spokenActionLabels,
  voiceHints,
  type DataSnapshot, type EngineEnv, type RuntimeState,
} from './index';

const NOW = new Date(2026, 10, 17, 10, 30);
const NORMAL: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const VOICE_ONLY: AccessModes = { ...NORMAL, voiceOnly: true };

const spec: KalamSpec = kalamSpecSchema.parse({
  id: 'app_voice',
  schemaVersion: '1.0.0',
  version: 1,
  name: 'Tailor book',
  lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1, preset: 'calm_green' },
  collections: {
    orders: {
      label: 'Orders',
      fields: {
        customer: { type: 'text', label: 'Customer', required: true },
        chest: { type: 'number', label: 'Chest', min: 10, max: 80, unit: 'in' },
        garment: { type: 'enum', label: 'Garment', options: ['Kurta', 'Shirt', 'Pant'] },
        delivery: { type: 'date', label: 'Delivery' },
        amount: { type: 'number', label: 'Amount', min: 0 },
      },
    },
  },
  screens: [
    {
      id: 'home', title: 'Orders', children: [
        { id: 'new_btn', type: 'bigButton', label: 'New order', action: 'go_new' },
        { id: 'orders_list', type: 'list', source: 'orders', primary: 'customer', detailScreen: 'edit', allowDelete: true },
      ],
    },
    {
      id: 'new', title: 'New order', form: 'orders', children: [
        { id: 'customer_in', type: 'textInput', label: 'Customer', field: 'customer', required: true },
        { id: 'chest_in', type: 'number', label: 'Chest', field: 'chest' },
        { id: 'garment_in', type: 'choice', label: 'Garment', field: 'garment' },
        { id: 'delivery_in', type: 'date', label: 'Delivery', field: 'delivery' },
        { id: 'amount_in', type: 'number', label: 'Amount', field: 'amount' },
        { id: 'save_btn', type: 'bigButton', label: 'Save', action: 'save_order' },
        { id: 'hint_btn', type: 'bigButton', label: 'Say hello', action: 'hello', secondary: true },
        { id: 'clear_btn', type: 'bigButton', label: 'Clear', action: 'clear' },
      ],
    },
    {
      id: 'edit', title: 'Edit order', form: 'orders', children: [
        { id: 'customer_ed', type: 'textInput', label: 'Customer', field: 'customer', required: true },
        { id: 'update_btn', type: 'bigButton', label: 'Save changes', action: 'update_order' },
        { id: 'delete_btn', type: 'bigButton', label: 'Delete', action: 'delete_order', tone: 'danger' },
      ],
    },
    {
      id: 'tea', title: 'Tea', children: [
        { id: 'cups', type: 'counter', label: 'Cups', min: 0, max: 3 },
        { id: 'tea_note', type: 'text', label: 'Count your cups' },
      ],
    },
  ],
  initialScreen: 'home',
  actions: {
    go_new: { type: 'navigate', screen: 'new' },
    save_order: { type: 'insert', collection: 'orders', then: { navigate: 'home', speak: 'Order saved' } },
    update_order: { type: 'update', collection: 'orders', record: 'selected', then: { navigate: 'home' } },
    delete_order: { type: 'delete', collection: 'orders', record: 'selected', confirm: 'Delete this order?' },
    reset_cups: { type: 'reset', target: 'cups' },
    read_slip: { type: 'runAI', aiBlock: 'slip' },
    tag_it: { type: 'runAI', aiBlock: 'tag' },
    tag_local: { type: 'runAI', aiBlock: 'tag_local' },
    hello: { type: 'speak', text: 'Hello' },
    clear: { type: 'clearForm' },
  },
  aiBlocks: {
    slip: { kind: 'extractFromPhoto', prompt: 'Read the slip', verified: 'cloudPreferred', target: 'orders', fields: ['customer', 'chest'] },
    tag: { kind: 'classify', prompt: 'Pick a garment', verified: 'cloudPreferred', labels: ['Kurta', 'Shirt'], inputField: 'customer', outputField: 'garment' },
    tag_local: { kind: 'classify', prompt: 'Pick a garment', verified: 'onDevice', labels: ['Kurta', 'Shirt'], inputField: 'customer', outputField: 'garment' },
  },
  intents: { save_order: ['save', 'done', 'rakh do'], go_new: ['new order', 'naya order'] },
  meta: { createdAt: 0 },
});

const onScreen = (id: string, selection?: RuntimeState['selection']): RuntimeState => ({
  ...createRuntimeState(spec), stack: id === 'home' ? ['home'] : ['home', id], selection: selection ?? null,
});
const heard = (action: string | null, fields: VoiceActionResult['fields'] = {}, confidence: 'high' | 'low' = 'high'): VoiceActionResult => ({
  action, fields, confidence, source: 'deterministic',
});
const plan = (state: RuntimeState, r: VoiceActionResult, modes: AccessModes = NORMAL) =>
  planVoiceCommand(spec, state, r, { modes, now: NOW });
const OPEN_ORDER = { collection: 'orders', recordId: 'r1' };
const rec = (id: string, createdAt: number, customer: string) =>
  ({ id, appId: spec.id, collectionId: 'orders', createdAt, updatedAt: createdAt, values: { customer } });
const RECORDS = [rec('r1', 1, 'Raju'), rec('r2', 2, 'Meena'), rec('r3', 3, 'Raju Sharma')];
const homeData = (records = RECORDS): DataSnapshot => ({ records: { orders: records }, state: {} });
const recordPlan = (cmdText: string, screen = 'home', data = homeData(), modes: AccessModes = NORMAL, s: KalamSpec = spec) => {
  const cmd = parseRecordCommand(cmdText);
  return cmd ? planRecordCommand(s, onScreen(screen), data, NOW, modes, cmd) : undefined;
};
const noDash = (s: string) => expect(s).not.toMatch(/[—–]/);

describe('confirm policy (docs/05 §10.4, docs/10 §4.5)', () => {
  it('refuses an action id the app does not have', () => {
    const p = plan(onScreen('new'), heard('drop_everything'));
    expect(p).toMatchObject({ kind: 'refuse', reason: 'unknown_action' });
    // Prototype keys are not actions either.
    expect(plan(onScreen('new'), heard('__proto__'))).toMatchObject({ kind: 'refuse', reason: 'unknown_action' });
    expect(plan(onScreen('new'), heard('constructor'))).toMatchObject({ kind: 'refuse', reason: 'unknown_action' });
  });

  it('refuses when nothing was understood, and offers real commands', () => {
    const p = plan(onScreen('home'), heard(null));
    expect(p).toMatchObject({ kind: 'refuse', reason: 'not_understood' });
    if (p.kind === 'refuse') {
      expect(p.say).toContain('New order');
      noDash(p.say);
    }
  });

  it('fills the form when only field values were heard', () => {
    const p = plan(onScreen('new'), heard(null, { customer: 'Raju', chest: 40 }, 'low'));
    expect(p).toEqual({ kind: 'fill', fields: { customer: 'Raju', chest: 40 } });
  });

  it('drops unknown fields and values that fail validation', () => {
    const defs = screenFieldDefs(spec, spec.screens[1]!);
    expect(sanitizeVoiceFields(defs, { customer: 'Raju', evil: 'x', chest: 999, garment: 'Cape', amount: 12 }, NOW))
      .toEqual({ customer: 'Raju', amount: 12 });
    expect(plan(onScreen('new'), heard(null, { chest: 999 }))).toMatchObject({ kind: 'refuse', reason: 'not_understood' });
  });

  it('always confirms deleting, even at high confidence, using the app\'s own question', () => {
    const p = plan(onScreen('edit', OPEN_ORDER), heard('delete_order', {}, 'high'));
    expect(p).toMatchObject({ kind: 'confirm', reason: 'destructive', actionId: 'delete_order' });
    if (p.kind === 'confirm') {
      expect(p.prompt).toBe('Delete this order? Say confirm or cancel.');
    }
  });

  it('asks the person to open an item first instead of confirming a delete that cannot work', () => {
    expect(plan(onScreen('edit'), heard('delete_order'))).toMatchObject({ kind: 'refuse', reason: 'needs_selection' });
    expect(plan(onScreen('edit'), heard('update_order'))).toMatchObject({ kind: 'refuse', reason: 'needs_selection' });
    expect(plan(onScreen('edit', OPEN_ORDER), heard('update_order'))).toMatchObject({ kind: 'run' });
  });

  it('confirms reset and clear form', () => {
    const reset = plan(onScreen('tea'), heard('reset_cups'));
    expect(reset).toMatchObject({ kind: 'confirm', reason: 'destructive' });
    if (reset.kind === 'confirm') expect(reset.prompt).toBe('Reset Cups? Say confirm or cancel.');
    const clear = plan(onScreen('new'), heard('clear'));
    expect(clear).toMatchObject({ kind: 'confirm', reason: 'destructive' });
    if (clear.kind === 'confirm') expect(clear.prompt).toContain('Clear what you typed');
  });

  it('runs a clear, high-confidence, low-risk command without asking', () => {
    expect(plan(onScreen('new'), heard('save_order', { customer: 'Raju' }))).toEqual({
      kind: 'run', actionId: 'save_order', fields: { customer: 'Raju' },
    });
    expect(plan(onScreen('home'), heard('go_new'))).toMatchObject({ kind: 'run', actionId: 'go_new' });
  });

  it('reads back and confirms a low-confidence command', () => {
    const p = plan(onScreen('new'), heard('save_order', { customer: 'Raju', chest: 40, garment: 'Kurta' }, 'low'));
    expect(p).toMatchObject({ kind: 'confirm', reason: 'low_confidence', actionId: 'save_order' });
    if (p.kind === 'confirm') {
      expect(p.prompt).toBe('I understood: Customer Raju, Chest 40 in, Garment Kurta. Should I save this to Orders? Say confirm or cancel.');
      noDash(p.prompt);
    }
    const noFields = plan(onScreen('home'), heard('go_new', {}, 'low'));
    expect(noFields).toMatchObject({ kind: 'confirm', reason: 'low_confidence' });
    if (noFields.kind === 'confirm') expect(noFields.prompt).toBe('I think you want to open New order. Say confirm or cancel.');
  });

  it('Voice-only Mode reads back heard values before saving, because the form cannot be seen', () => {
    const modes = VOICE_ONLY;
    const withFields = plan(onScreen('new'), heard('save_order', { customer: 'Raju' }), modes);
    expect(withFields).toMatchObject({ kind: 'confirm', reason: 'readback' });
    expect(plan(onScreen('new'), heard('save_order'), modes)).toMatchObject({ kind: 'run' });
    expect(plan(onScreen('home'), heard('go_new'), modes)).toMatchObject({ kind: 'run' });
    // Sighted use: no extra question.
    expect(plan(onScreen('new'), heard('save_order', { customer: 'Raju' }))).toMatchObject({ kind: 'run' });
  });

  it('treats online AI steps as sharing information and confirms them; photo steps need a tap', () => {
    expect(plan(onScreen('new'), heard('tag_it'))).toMatchObject({ kind: 'confirm', reason: 'external_ai' });
    expect(plan(onScreen('new'), heard('tag_local'))).toMatchObject({ kind: 'run' });
    expect(plan(onScreen('new'), heard('read_slip'))).toMatchObject({ kind: 'refuse', reason: 'needs_photo' });
  });
});

function harness(confirmAnswer = true, seed = false) {
  const stores = createMemoryStores(spec.id, seed ? { records: { orders: RECORDS } } : {});
  const confirm = vi.fn(async () => confirmAnswer);
  const services: RuntimeServices = {
    ...stores, runAIBlock: vi.fn(), pickImage: vi.fn(), confirm, speak: vi.fn(), online: () => true,
  };
  const data: DataSnapshot = { records: { orders: RECORDS }, state: {} };
  const env = (): EngineEnv => ({ spec, appId: spec.id, services, data, now: NOW });
  return { stores, env, confirm };
}

describe('executing a voice command through the engine', () => {
  it('fills the heard values, saves through dispatchAction, and says what happened', async () => {
    const h = harness();
    const run = await executeVoiceCommand(h.env(), onScreen('new'), {
      actionId: 'save_order', fields: { customer: 'Raju', chest: 40, garment: 'Kurta' },
    });
    expect(run.result.ok).toBe(true);
    const saved = (await h.stores.records.list(spec.id, 'orders'))[0];
    expect(saved?.values).toMatchObject({ customer: 'Raju', chest: 40, garment: 'Kurta' });
    expect(run.result.state.stack).toEqual(['home']);
    expect(run.say).toEqual({ text: 'Saved.', priority: 'completion' });
  });

  it('only fills when there is no action, and says what is still needed', async () => {
    const h = harness();
    const r = await executeVoiceCommand(h.env(), onScreen('new'), { fields: { chest: 40 } });
    expect(r.say?.text).toBe('Set Chest 40 in. Still needed: Customer.');
    expect(r.result.state.forms.new?.chest).toBe(40);
    const done = await executeVoiceCommand(h.env(), r.result.state, { fields: { customer: 'Raju' } });
    expect(done.say?.text).toBe('Set Customer Raju.');
    expect(await h.stores.records.list(spec.id, 'orders')).toHaveLength(0);
  });

  it('reads out the engine\'s own validation message as an urgent line', async () => {
    const h = harness();
    const r = await executeVoiceCommand(h.env(), onScreen('new'), { actionId: 'save_order', fields: { chest: 40 } });
    expect(r.result.ok).toBe(false);
    expect(r.say).toEqual({ text: 'Customer is required.', priority: 'critical' });
    // The heard value stays in the form so the person only has to add the missing one.
    expect(r.result.state.forms.new?.chest).toBe(40);
  });

  it('opening a screen says which screen opened', async () => {
    const h = harness();
    const r = await executeVoiceCommand(h.env(), onScreen('home'), { actionId: 'go_new', fields: {} });
    expect(r.say).toEqual({ text: 'Opened New order.', priority: 'completion' });
  });

  it('stays quiet when the runtime already speaks the result', async () => {
    const h = harness();
    const r = await executeVoiceCommand(h.env(), onScreen('new'), { actionId: 'hello', fields: {} });
    expect(r.say).toBeUndefined();
  });

  it('reports a declined delete as cancelled', async () => {
    const h = harness(false);
    const r = await executeVoiceCommand(h.env(), onScreen('edit', OPEN_ORDER), { actionId: 'delete_order', fields: {} });
    expect(r.result.error).toBe('cancelled');
    expect(r.say).toEqual({ text: 'Cancelled.', priority: 'completion' });
  });

  it('says so when no usable value was heard', async () => {
    const h = harness();
    const r = await executeVoiceCommand(h.env(), onScreen('new'), { fields: { chest: 999 } });
    expect(r.say).toEqual({ text: 'I did not hear a value for this screen.', priority: 'critical' });
  });
});

describe('Voice-only announcements built from the spec', () => {
  it('speaks the title and the commands on a screen', () => {
    const a = buildScreenAnnouncement(spec, spec.screens[0]!, VOICE_ONLY);
    expect(a.title).toBe('Orders');
    expect(a.actions).toEqual(['New order']);
    expect(a.text).toBe('Orders. You can say: New order.');
  });

  it('adds the microphone hint on the first screen only', () => {
    const first = buildScreenAnnouncement(spec, spec.screens[0]!, VOICE_ONLY, { first: true });
    expect(first.text).toBe('Orders. Tap the microphone to talk. You can say: New order.');
    expect(buildScreenAnnouncement(spec, spec.screens[0]!, VOICE_ONLY).text).not.toContain('microphone');
  });

  it('lists form fields, and shortens a long list', () => {
    const a = buildScreenAnnouncement(spec, spec.screens[1]!, VOICE_ONLY);
    expect(a.actions).toEqual(['Save', 'Say hello', 'Clear']);
    expect(a.fields).toEqual(['Customer', 'Chest', 'Garment', 'Delivery', 'Amount']);
    expect(a.text).toContain('You can say: Save, Say hello or Clear.');
    expect(a.text).toContain('Fields: Customer, Chest, Garment, Delivery and 1 more.');
    noDash(a.text);
  });

  it('follows Simple Mode: secondary buttons are not announced', () => {
    const simple = { ...VOICE_ONLY, simple: true };
    expect(spokenActionLabels(spec, spec.screens[1]!, simple)).toEqual(['Save', 'Clear']);
  });

  it('says plainly when a screen has no commands', () => {
    const a = buildScreenAnnouncement(spec, spec.screens[3]!, VOICE_ONLY);
    expect(a.text).toBe('Tea. There are no spoken commands on this screen.');
  });

  it('caps the spoken commands and points to help for the rest', () => {
    const many: KalamSpec = {
      ...spec,
      screens: [{
        id: 'many', title: 'Many',
        children: Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, type: 'bigButton' as const, label: `Do ${i}`, action: 'go_new' })),
      }],
      initialScreen: 'many',
    };
    const a = buildScreenAnnouncement(many, many.screens[0]!, VOICE_ONLY);
    expect(a.text).toContain('You can say: Do 0, Do 1, Do 2, Do 3 or Do 4.');
    expect(a.text).toContain('Say help for the rest.');
    const help = buildHelpText(many, many.screens[0]!, VOICE_ONLY);
    expect(help).toContain('Do 6');
    expect(help).toContain('Say repeat');
  });

  it('gives the recogniser the words of the screen', () => {
    const hints = voiceHints(spec, spec.screens[1]!);
    expect(hints).toEqual(expect.arrayContaining(['Save', 'Customer', 'Kurta', 'rakh do', 'naya order']));
    expect(hints.length).toBeLessThanOrEqual(100);
  });

  it('Voice-only takes over the screen title from Read-aloud', () => {
    expect(speaksResults({ ...NORMAL, readAloud: true })).toBe(true);
    expect(speaksResults(VOICE_ONLY)).toBe(true);
    expect(speaksResults(NORMAL)).toBe(false);
    expect(runtimeAnnouncesTitle({ ...NORMAL, readAloud: true })).toBe(true);
    expect(runtimeAnnouncesTitle({ ...VOICE_ONLY, readAloud: true })).toBe(false);
  });

  it('gives the few remaining controls a generous touch target', () => {
    expect(resolveAppTheme(spec.theme, NORMAL).target).toBe(48);
    expect(resolveAppTheme(spec.theme, VOICE_ONLY).target).toBeGreaterThanOrEqual(56);
  });

  it('keeps Large Mode targets at 64px when voice-only is also on', () => {
    expect(resolveAppTheme(spec.theme, { ...VOICE_ONLY, large: true }).target).toBe(64);
    expect(resolveAppTheme(spec.theme, { ...NORMAL, large: true }).target).toBe(64);
  });
});

describe('the agent\'s own commands', () => {
  it('recognises whole-utterance commands in English, Hinglish and Hindi', () => {
    expect(matchMetaCommand('repeat')).toBe('repeat');
    expect(matchMetaCommand('Repeat that, please')).toBe('repeat');
    expect(matchMetaCommand('फिर से')).toBe('repeat');
    expect(matchMetaCommand('dobara')).toBe('repeat');
    expect(matchMetaCommand('stop talking')).toBe('stop');
    expect(matchMetaCommand('What can I say?')).toBe('help');
    expect(matchMetaCommand('go back')).toBe('back');
    expect(matchMetaCommand('never mind')).toBe('cancel');
  });

  it('never mistakes a word inside a name or value for a command', () => {
    expect(matchMetaCommand('customer Stop Sharma')).toBeUndefined();
    expect(matchMetaCommand('save')).toBeUndefined();
    expect(matchMetaCommand('')).toBeUndefined();
  });

  it('reads the answer to "confirm or cancel", with cancel winning any doubt', () => {
    for (const change of ['change details', 'change it', 'edit', 'badlo']) {
      expect(interpretConfirmation(change), change).toBe('change');
    }
    expect(interpretConfirmation('no, change it')).toBe('cancel');
    for (const yes of ['confirm', 'Yes please', 'okay', 'haan', 'हाँ', 'go ahead', 'kar do', 'theek hai']) {
      expect(interpretConfirmation(yes), yes).toBe('confirm');
    }
    for (const no of ['cancel', 'no', 'nahi', 'नहीं', "don't", 'no, do not confirm', 'wait']) {
      expect(interpretConfirmation(no), no).toBe('cancel');
    }
    expect(interpretConfirmation("no, don't confirm")).toBe('cancel');
    expect(interpretConfirmation('maybe later')).toBe('unclear');
    expect(interpretConfirmation('')).toBe('unclear');
  });
});

describe('choosing a record by voice (docs/10 §4.5 "Delete the last record")', () => {
  it('reads position words and names, in English and Hindi', () => {
    expect(parseRecordCommand('delete the last record')).toEqual({ verb: 'delete', ref: { kind: 'last' } });
    expect(parseRecordCommand('Open the first order please')).toEqual({ verb: 'open', ref: { kind: 'first' } });
    expect(parseRecordCommand('kholo pehla')).toEqual({ verb: 'open', ref: { kind: 'first' } });
    expect(parseRecordCommand('edit Raju')).toEqual({ verb: 'open', ref: { kind: 'text', text: 'raju' } });
    expect(parseRecordCommand("delete Raju's order")).toEqual({ verb: 'delete', ref: { kind: 'text', text: 'raju order' } });
  });

  it('ignores anything that is not a record command', () => {
    for (const t of ['open', 'delete', 'save', 'customer Raju', 'the last order', '']) expect(parseRecordCommand(t), t).toBeUndefined();
  });

  it('picks the newest or oldest row by creation time and always confirms a delete', () => {
    const last = recordPlan('delete the last record');
    expect(last).toMatchObject({ kind: 'delete', name: 'Raju Sharma', prompt: 'Delete Raju Sharma? Say confirm or cancel.' });
    if (last?.kind === 'delete') expect(last.record.id).toBe('r3');
    expect(recordPlan('open the first order')).toMatchObject({ kind: 'open', name: 'Raju' });
  });

  it('finds a record by name, never guesses between several, and leaves the app own commands alone', () => {
    expect(recordPlan('open Meena')).toMatchObject({ kind: 'open', name: 'Meena' });
    expect(recordPlan('delete meena order')).toMatchObject({ kind: 'delete', name: 'Meena' });
    expect(recordPlan('open Raju')).toEqual({ kind: 'say', say: 'I found 2 matches. Say more of the name.' });
    expect(recordPlan('open Raju Sharma')).toMatchObject({ kind: 'open', name: 'Raju Sharma' });
    // "open new order" is the app's own navigation command: no record is called "new".
    expect(recordPlan('open new order')).toBeUndefined();
    expect(recordPlan('open orders')).toBeUndefined();
  });

  it('only works on a screen that has a list, and explains when it cannot', () => {
    expect(recordPlan('delete the last record', 'new')).toEqual({ kind: 'say', say: 'Go to the list first, then say which one.' });
    expect(recordPlan('open Meena', 'new')).toBeUndefined();
    expect(recordPlan('delete the last record', 'home', homeData([]))).toEqual({ kind: 'say', say: 'There is nothing in the list yet.' });
    const noDelete: KalamSpec = {
      ...spec,
      screens: spec.screens.map((s) => (s.id === 'home'
        ? { ...s, children: s.children.map((c) => (c.type === 'list' ? { ...c, allowDelete: false } : c)) }
        : s)),
    };
    expect(recordPlan('delete the last record', 'home', homeData(), NORMAL, noDelete)).toEqual({
      kind: 'say', say: 'Open that item first, then say delete.',
    });
  });

  it('opens the record like a tap: selection, detail screen and prefilled form', () => {
    const h = harness(true, true);
    const plan = recordPlan('open meena');
    expect(plan?.kind).toBe('open');
    if (plan?.kind !== 'open') return;
    const r = executeOpenRecord(h.env(), onScreen('home'), plan);
    expect(r.result.state.stack).toEqual(['home', 'edit']);
    expect(r.result.state.selection).toEqual({ collection: 'orders', recordId: 'r2' });
    expect(r.result.state.forms.edit).toMatchObject({ customer: 'Meena' });
    expect(r.say).toEqual({ text: 'Opened Meena.', priority: 'completion' });
  });

  it('deletes through the engine once confirmed, without a second system dialog', async () => {
    const h = harness(false, true);
    const plan = recordPlan('delete the last record');
    expect(plan?.kind).toBe('delete');
    if (plan?.kind !== 'delete') return;
    const env = h.env();
    const done = await executeDeleteRecord({ ...env, services: { ...env.services, confirm: async () => true } }, onScreen('home'), plan);
    expect(done.result.ok).toBe(true);
    expect((await h.stores.records.list(spec.id, 'orders')).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(done.say).toEqual({ text: 'Deleted.', priority: 'completion' });
  });
});
