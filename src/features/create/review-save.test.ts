import { describe, expect, it, vi } from 'vitest';

import { fixtureSpec } from '@/core/backup/test-fixtures';
import type { AIBlockVerificationReport, CreationResult } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';

import { checksPassed, rebuildText, saveStep, storedAppFrom } from './review-save';
import { removeVoiceNote } from './voice-note';

const discard = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/infrastructure/platform/media-audio', () => ({ discardRecording: discard }));

const report = (blockId: string, status: AIBlockVerificationReport['status']): AIBlockVerificationReport => ({
  blockId, appVersion: 1, blockHash: 'h', promptVersion: 'ai-block-verify/1', status,
  testCount: 2, passCount: status === 'unverified' ? 0 : 2, judgeUsed: false, cases: [], checkedAt: 1, message: 'm',
});
const spec = { ...fixtureSpec(), aiBlocks: { slip: {} } } as unknown as KalamSpec;
const result = (extra: Partial<CreationResult> = {}) => ({
  ok: true, route: 'cloud', provider: 'firebase', model: 'gemini', spec,
  classification: { matchingTemplate: 'expense_tracker' }, ...extra,
}) as unknown as CreationResult;

describe('the review stamp', () => {
  it('says Checked only when no AI step was left unchecked', () => {
    expect(checksPassed({})).toBe(true);
    expect(checksPassed({ verification: [report('slip', 'onDevice'), report('b', 'cloudPreferred')] })).toBe(true);
    expect(checksPassed({ verification: [report('slip', 'onDevice'), report('b', 'unverified')] })).toBe(false);
  });
});

describe('Save to Shelf', () => {
  it('keeps the AI-step checks for blocks the app still has, and the route it was built on', () => {
    const app = storedAppFrom(spec, result({ verification: [report('slip', 'onDevice'), report('gone', 'onDevice')] }), undefined, 5);
    expect(Object.keys(app.aiVerification ?? {})).toEqual(['slip']);
    expect(app.origin).toEqual({ route: 'cloud', provider: 'firebase', model: 'gemini' });
    expect(app.createdAt).toBe(5);
    expect(app.creationInput).toBeUndefined();
  });

  it('stores no checks when none ran, and the template a template build used', () => {
    const app = storedAppFrom(spec, result({ route: 'template', provider: 'none', model: undefined }), undefined, 1);
    expect(app.aiVerification).toBeUndefined();
    expect(app.origin).toEqual({ route: 'template', templateId: 'expense_tracker' });
  });

  it('saves, asks before dropping answers that need a rebuild, or says what to fix', () => {
    expect(saveStep({ ok: true, spec, rebuild: [] })).toEqual({ kind: 'save', spec });
    expect(saveStep({ ok: true, spec, rebuild: ['Measurements are in cm.'] })).toEqual({ kind: 'ask', spec });
    expect(saveStep({ ok: false, error: 'Name the first screen.', issues: [] })).toEqual({ kind: 'fix', message: 'Name the first screen.' });
  });

  it('starts a rebuild from the typed words plus each answer on its own line', () => {
    expect(rebuildText('  A ledger ', ['In cm.', '', 'Add a phone field.'])).toBe('A ledger\n\nIn cm.\nAdd a phone field.');
    expect(rebuildText('', ['In cm.'])).toBe('In cm.');
    expect(rebuildText('x'.repeat(5000), [])).toHaveLength(4000);
  });
});

describe('removing the voice note', () => {
  it('deletes a kept recording too, not only the words', () => {
    const setVoice = vi.fn();
    removeVoiceNote({ transcript: 'hi', recognizedBy: 'on_device', audioUri: 'file:///rec.m4a' }, setVoice);
    expect(discard).toHaveBeenCalledWith('file:///rec.m4a');
    expect(setVoice).toHaveBeenCalledWith(undefined);
    discard.mockClear();
    removeVoiceNote({ transcript: 'typed', recognizedBy: 'typed' }, setVoice);
    expect(discard).not.toHaveBeenCalled();
  });
});
