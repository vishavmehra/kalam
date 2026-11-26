/**
 * docs/07 §17.1-17.2 (D07-041): what a person stores in an app never reaches a prompt. Every place that
 * builds a model request is driven here with values that must stay home, then every system text, prompt
 * and JSON schema that would be sent is searched for them. A second check lists the source files that
 * build requests and also touch stored records, so a new builder cannot do it unnoticed.
 *
 * The one deliberate exception is the single input of an AI step the person runs: that text is the work
 * itself, and the first-send notice says so ("sends only the fields it works on").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import { createAppAssistant } from '../assistant';
import { buildSafetyRequest } from '../bazaar/publish';
import { buildCompilerPrompt, buildRepairPrompt } from '../compiler/prompt';
import type { KalamRecord, NormalizedInput, RecordRepository, RecordValue, StructuredRequest } from '../contracts';
import { suggestFormula } from '../formula-assist';
import { buildWorkflowRequest } from '../media/workflow';
import { explainReport, runReport, suggestReports } from '../reports';
import { validateSpec } from '../spec';
import type { KalamSpec } from '../spec/schema';
import { createAIBlockService } from '../tasks/ai-block-service';
import { createEditService } from '../tasks/edit-service';
import { createTranslateService } from '../tasks/translate-service';
import { createVoiceService } from '../tasks/voice-service';
import { buildHandwritingRequest } from '../../features/drawing/handwriting-service';

const spec = validateSpec(loadFixture('valid', 'expense-tracker')).spec as KalamSpec;

// Values the person keeps on this device. None of them may be sent.
const NOTE = 'CANARY-note-7731';
const OTHER_FIELD = 'CANARY-other-5520';
const STATE_VALUE = 'CANARY-state-3318';
const AMOUNT = 424242.5;
const SECRETS = [NOTE, OTHER_FIELD, STATE_VALUE, 'CANARY', String(AMOUNT), '424242'];

const STORED: Array<Record<string, RecordValue>> = [
  { amount: AMOUNT, category: 'Food', date: '2026-11-18', note: NOTE },
  { amount: 80, category: 'Travel', date: '2026-11-17', note: `${NOTE} again` },
  { amount: 300, category: 'Food', date: '2026-11-10', note: OTHER_FIELD },
];
const records: Pick<RecordRepository, 'list'> = {
  async list(appId, collectionId): Promise<KalamRecord[]> {
    return STORED.map((values, i) => ({ id: `r${i}`, appId, collectionId, createdAt: i, updatedAt: i, values }));
  },
};
const state = { all: async () => ({ saved: STATE_VALUE }) };
const NOW = new Date('2026-11-20T12:00:00Z');

/** A model that always fails: the request is built and recorded first, which is all this test needs. */
const model = () => createFakeAI({ onDevice: 'available' });
const sentBy = (ai: ReturnType<typeof model>): StructuredRequest<unknown>[] => ai.calls.map((c) => c.req);

const IMAGE = { mimeType: 'image/jpeg' as const, base64: '/9j/AAAA' };
const input: NormalizedInput = {
  text: 'A shop book for my customers', modalities: ['text'], images: [], language: 'en', existingSpec: spec,
};

const builders: Array<[string, () => Promise<StructuredRequest<unknown>[]> | StructuredRequest<unknown>[]]> = [
  ['assistant question', async () => {
    const ai = model();
    await createAppAssistant({ ai, records, state, now: () => NOW }).ask(spec, 'What did I spend on fuel?', { appId: spec.id });
    return sentBy(ai);
  }],
  ['formula helper', async () => {
    const ai = model();
    await suggestFormula(spec, 'who is my best customer', { ai, records, state, appId: spec.id, screenId: 'home', now: NOW });
    return sentBy(ai);
  }],
  ['voice command', async () => {
    const ai = model();
    await createVoiceService({ ai }).interpret(spec, 'home', 'please sort the thing out for me');
    return sentBy(ai);
  }],
  ['edit by words (device, then cloud)', async () => {
    const ai = model();
    await createEditService({ ai }).applyInstruction(spec, 'make it feel softer');
    return sentBy(ai);
  }],
  ['edit by words (structural)', async () => {
    const ai = model();
    await createEditService({ ai }).applyInstruction(spec, 'Add a new screen to keep track of my suppliers with their phone numbers');
    return sentBy(ai);
  }],
  ['translation', async () => {
    const ai = model();
    const cache = { get: async () => undefined, put: async () => {}, listForApp: async () => [], removeForApp: async () => {} };
    await createTranslateService({ ai, cache, onDeviceLanguages: ['en', 'es'] }).translateApp(spec, 'es');
    return sentBy(ai);
  }],
  ['AI step run', async () => {
    const ai = model();
    // The step reads "note"; the other fields on the same screen are not its business.
    const formValues = { note: 'Lunch with the team', amount: AMOUNT, category: OTHER_FIELD, date: '2026-11-18' };
    await createAIBlockService({ ai }).run({ appId: spec.id, blockId: 'categorise', block: spec.aiBlocks.categorise, spec, formValues });
    return sentBy(ai);
  }],
  ['AI step check', async () => {
    const ai = model();
    await createAIBlockService({ ai }).verify(spec, 'categorise');
    return sentBy(ai);
  }],
  ['report explanation', async () => {
    const ai = model();
    const def = suggestReports(spec).find((d) => d.groupBy?.kind === 'field')!;
    const out = runReport(spec, def, STORED.map((values, i) => ({ values, createdAt: i })), { now: NOW, timeZone: 'UTC' });
    if (!out.ok) throw new Error(out.errors.join('; '));
    await explainReport(ai, out.result, { appId: spec.id });
    return sentBy(ai);
  }],
  ['compiler prompt', () => [{ prompt: buildCompilerPrompt(input), system: '', jsonSchema: {} } as StructuredRequest<unknown>]],
  ['compiler repair prompt', () => [{ prompt: buildRepairPrompt(input, undefined, ['screens[0] is empty']), system: '', jsonSchema: {} } as StructuredRequest<unknown>]],
  ['safety review before publishing', () => [buildSafetyRequest(spec, { title: spec.name, description: 'Tracks spending', tags: ['money'] })]],
  ['video workflow', () => [buildWorkflowRequest([{ image: IMAGE, timestampMs: 0, frameId: 'f0' }], { durationMs: 4000, note: 'adding an expense' })]],
  ['handwriting', () => [buildHandwritingRequest(IMAGE, 'prefer_on_device')]],
];

describe('no stored record value reaches a prompt (docs/07 §17.1-17.2)', () => {
  it.each(builders)('%s', async (_name, build) => {
    const requests = await build();
    expect(requests.length, 'the builder must run, or this check proves nothing').toBeGreaterThan(0);
    const sent = JSON.stringify(requests.map((r) => [r.system, r.prompt, r.jsonSchema]));
    for (const secret of SECRETS) expect(sent).not.toContain(secret);
  });

  it('sends only the one field an AI step works on, and nothing else from the form', async () => {
    const ai = model();
    const formValues = { note: 'Lunch with the team', amount: AMOUNT, category: OTHER_FIELD };
    await createAIBlockService({ ai }).run({ appId: spec.id, blockId: 'categorise', block: spec.aiBlocks.categorise, spec, formValues });
    expect(ai.calls[0].req.prompt).toContain('Lunch with the team');
  });

  it('reads stored records only after a model answered, and only what the formula uses', async () => {
    const reads: string[] = [];
    const watched: Pick<RecordRepository, 'list'> = { list: async (a, c) => { reads.push(`${a}/${c}`); return records.list(a, c); } };
    const ai = model();
    await createAppAssistant({ ai, records: watched, state, now: () => NOW }).ask(spec, 'What did I spend on fuel?', { appId: spec.id });
    expect(ai.calls.length).toBeGreaterThan(0);
    expect(reads).toEqual([]); // the model failed, so no formula ran and no record was read
  });
});

describe('request builders and record access stay apart (source check)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const files = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !/\.d\.ts$/.test(f))
    .map((f) => relative(root, join(root, f)).replace(/\\/g, '/'));

  it('only the assistant and the formula helper build a request and also read records, and both are covered above', () => {
    const both = files.filter((f) => {
      if (f === 'core/contracts/index.ts') return false; // the types themselves
      const text = readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const buildsRequest = /\btaskType:\s*'/.test(text) && /\bprompt:\s*[`'"$(\w]/.test(text);
      return buildsRequest && /RecordRepository|\.records\b/.test(text);
    });
    expect(both.sort()).toEqual(['core/assistant/assistant.ts', 'core/formula-assist/suggest.ts']);
  });
});
