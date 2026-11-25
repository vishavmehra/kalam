import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import { irToSpec } from '../compiler/convert';
import { compilerIRSchema } from '../compiler/ir';
import { createVoiceService } from './voice-service';

const ir = compilerIRSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/compiler/tailor-shop.ir.json', import.meta.url), 'utf8')));
const spec = irToSpec(ir, { appId: 'app_tailor01', now: 1 });
/** No Nano and no network: only deterministic intents can answer. */
const offlineDevice = () => createFakeAI({ onDevice: 'unavailable', online: false });

describe('voice service — deterministic intents', () => {
  it.each([
    ['save', 'new_order', 'save_order'],
    ['Rakh do', 'new_order', 'save_order'],
    ['सेव करो', 'new_order', 'save_order'],
    ['naya order', 'home', 'go_new_order'],
    ['New order please', 'home', 'go_new_order'],
    ['open customers', 'home', 'go_customers'],
  ])('"%s" on %s → %s', async (transcript, screen, action) => {
    const ai = offlineDevice();
    const r = await createVoiceService({ ai }).interpret(spec, screen, transcript);
    expect(r).toMatchObject({ action, confidence: 'high', source: 'deterministic' });
    expect(ai.calls).toHaveLength(0);
  });

  it('extracts "label value" fields and enum options alongside the action', async () => {
    const r = await createVoiceService({ ai: offlineDevice() }).interpret(spec, 'new_order', "Customer Raju chest 40 waist 36.5 kurta, save");
    expect(r.action).toBe('save_order');
    expect(r.fields).toEqual({ customer: 'Raju', chest: 40, waist: 36.5, garment: 'Kurta' });
  });

  it('rejects values that do not fit the field', async () => {
    const r = await createVoiceService({ ai: offlineDevice() }).interpret(spec, 'new_order', 'chest 400');
    expect(r.fields).toEqual({});
  });

  it('marks fuzzy destructive matches low confidence', async () => {
    const r = await createVoiceService({ ai: offlineDevice() }).interpret(spec, 'order_detail', 'delet ordr');
    expect(r).toMatchObject({ action: 'delete_order', confidence: 'low' });
  });

  it('returns nothing for empty speech', async () => {
    expect(await createVoiceService({ ai: offlineDevice() }).interpret(spec, 'home', ' ... ')).toEqual({
      action: null, fields: {}, confidence: 'low', source: 'deterministic',
    });
  });
});

describe('voice service: one Firebase cloud fallback (lead decision 2)', () => {
  const reply = () => ({ raw: { action: 'save_order', fields: { customer: 'Raju' }, confidence: 'high' } });

  it('asks Firebase cloud once when Nano is missing but cloud is allowed', async () => {
    const ai = createFakeAI({ onDevice: 'unavailable', respond: reply });
    const r = await createVoiceService({ ai }).interpret(spec, 'new_order', 'put this in the book for Raju');
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].req.mode).toBe('prefer_on_device');
    expect(r).toMatchObject({ action: 'save_order', source: 'cloud' });
  });

  it('stays deterministic offline without Nano (no call at all)', async () => {
    const ai = offlineDevice();
    const r = await createVoiceService({ ai }).interpret(spec, 'new_order', 'put this in the book for Raju');
    expect(ai.calls).toHaveLength(0);
    expect(r.source).toBe('deterministic');
  });
});

describe('voice service — Gemini Nano fallback', () => {
  it('lets Nano pick among the app actions with typed fields', async () => {
    const ai = createFakeAI({
      onDevice: 'available',
      respond: () => ({ raw: { action: 'save_order', fields: { customer: 'Raju', chest: '41', bogus: 1 }, confidence: 'high' } }),
    });
    const r = await createVoiceService({ ai }).interpret(spec, 'new_order', 'put this in the book for Raju, 41 round the chest');
    expect(ai.calls[0].req).toMatchObject({ taskType: 'voice_action', mode: 'prefer_on_device', role: 'voice' });
    const schema = ai.calls[0].req.jsonSchema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual([...Object.keys(spec.actions), 'none']);
    expect(r).toEqual({ action: 'save_order', fields: { customer: 'Raju', chest: 41 }, confidence: 'high', source: 'on_device' });
  });

  it('rejects unknown actions from the model', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { action: 'drop_all_tables', fields: {}, confidence: 'high' } }) });
    const r = await createVoiceService({ ai }).interpret(spec, 'new_order', 'do the thing');
    expect(r).toMatchObject({ action: null, confidence: 'low' });
  });

  it('never reports a model-chosen destructive action as high confidence', async () => {
    const ai = createFakeAI({ onDevice: 'available', respond: () => ({ raw: { action: 'delete_order', fields: {}, confidence: 'high' } }) });
    const r = await createVoiceService({ ai }).interpret(spec, 'order_detail', 'get rid of it');
    expect(r).toMatchObject({ action: 'delete_order', confidence: 'low', source: 'on_device' });
  });
});
