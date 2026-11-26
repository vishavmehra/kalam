import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/fixtures/specs/load';
import type { RuntimeServices } from '@/core/contracts';
import { validateSpec } from '@/core/spec';
import type { KalamSpec } from '@/core/spec/schema';
import { acceptProposal } from './dispatch';
import { proposalFromQueued, screenRunsBlock } from './queued-ai';
import { createRuntimeState, navigate } from './state';
import type { EngineEnv } from './types';

const spec = (name: string) => validateSpec(loadFixture('valid', name)).spec as KalamSpec;
const medicine = spec('medicine-tracker'); // photo "label_photo" on screen "add" runs the extractFromPhoto step "read_label"
const notes = spec('notes-app'); // button "summarise" on screen "new" runs the summarise step "summarise_note"

const env = (s: KalamSpec): EngineEnv => ({ spec: s, appId: s.id, services: {} as RuntimeServices, data: { records: {}, state: {} }, now: new Date(2026, 10, 20) });
const on = (s: KalamSpec, screen: string) => navigate(s, createRuntimeState(s), screen)!;

describe('a queued AI step that finished while the app was closed', () => {
  it('knows which screen runs a step: a photo that runs it, or a button that does', () => {
    expect(screenRunsBlock(medicine, medicine.screens.find((s) => s.id === 'add')!, 'read_label')).toBe(true);
    expect(screenRunsBlock(medicine, medicine.screens.find((s) => s.id === 'home')!, 'read_label')).toBe(false);
    expect(screenRunsBlock(notes, notes.screens.find((s) => s.id === 'new')!, 'summarise_note')).toBe(true);
    expect(screenRunsBlock(notes, notes.screens.find((s) => s.id === 'home')!, 'summarise_note')).toBe(false);
  });

  it('comes back as a proposal on the screen that runs it, checked like a live one, and fills the form only when accepted', () => {
    const state = on(medicine, 'add');
    const proposal = proposalFromQueued(env(medicine), state, { blockId: 'read_label', output: { medicine: 'Paracetamol 500', stray: 'dropped', time: 'Morning' } });
    expect(proposal).toMatchObject({ blockId: 'read_label', screenId: 'add', source: 'cloud', values: { medicine: 'Paracetamol 500' } });
    // Only the fields the step declares (`fields: [medicine]`) survive; nothing else the model sent.
    expect(Object.keys(proposal!.values)).toEqual(['medicine']);
    expect(state.forms.add?.medicine).toBeUndefined();
    const accepted = acceptProposal(env(medicine), state, proposal!);
    expect(accepted.state.forms.add?.medicine).toBe('Paracetamol 500');
  });

  it('waits, and shows nothing, on any other screen or for a step the app no longer has', () => {
    const result = { blockId: 'read_label', output: { medicine: 'Paracetamol 500' } };
    expect(proposalFromQueued(env(medicine), createRuntimeState(medicine), result)).toBeUndefined();
    expect(proposalFromQueued(env(medicine), on(medicine, 'add'), { ...result, blockId: 'deleted_step' })).toBeUndefined();
    expect(proposalFromQueued(env(medicine), on(medicine, 'add'), { ...result, blockId: '__proto__' })).toBeUndefined();
  });

  it('drops a result with nothing usable in it, and keeps what is valid when part of it is not', () => {
    const state = on(notes, 'new');
    expect(proposalFromQueued(env(notes), state, { blockId: 'summarise_note', output: { summary: '' } })).toBeUndefined();
    expect(proposalFromQueued(env(notes), state, { blockId: 'summarise_note', output: { unrelated: 'x' } })).toBeUndefined();
    const ok = proposalFromQueued(env(notes), state, { blockId: 'summarise_note', output: { summary: 'Buy rice and dal.' } });
    expect(ok?.values).toEqual({ summary: 'Buy rice and dal.' });
    // The summarise button's own follow-up (`then`) is carried over, so accepting behaves like the live step.
    expect(ok && 'then' in ok).toBe(true);
  });
});
