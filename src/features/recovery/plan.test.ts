import { describe, expect, it } from 'vitest';

import { describeAIError } from '@/core/ai/errors';
import { createRecoveryLog, KNOWN_ERROR_CODES, RECOVERY_ACTIONS } from '@/core/observability';
import en from '@/i18n/locales/en.json';

import { actionKey, creationErrorCode, planRecovery } from './plan';
import { applyRecovery, availableActions, noteDismissed, noteShown } from './recover';

const english = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en);

describe('recovery plan (docs/14 §14)', () => {
  it('has a plan for every stable error code, with real sentences for it', () => {
    for (const code of KNOWN_ERROR_CODES) {
      const plan = planRecovery(code);
      expect(plan.code, code).toBe(code);
      expect(plan.what, code).not.toBe('recovery.what.generic');
      for (const key of [plan.what, plan.kept, ...plan.actions.map(actionKey)]) {
        expect(typeof english(key), `${code}: ${key}`).toBe('string');
      }
    }
  });

  it('uses only typed actions, and every typed action has a label', () => {
    for (const code of KNOWN_ERROR_CODES) for (const a of planRecovery(code).actions) expect(RECOVERY_ACTIONS).toContain(a);
    for (const a of RECOVERY_ACTIONS) expect(typeof english(actionKey(a)), a).toBe('string');
  });

  it('offers the same next step the AI layer names for each AI failure', () => {
    const asked: Record<string, string> = {
      retry: 'retry', retry_later: 'retry_later', retry_when_online: 'retry_when_online', turn_on_cloud: 'turn_on_cloud',
      prepare_on_device: 'prepare_on_device', change_input: 'change_input',
    };
    for (const code of ['offline', 'consent_denied', 'model_unavailable', 'timeout', 'quota', 'unsupported_modality', 'bad_request', 'provider_error'] as const) {
      const step = describeAIError(code).recovery;
      if (step !== 'none') expect(planRecovery(code).actions, code).toContain(asked[step]);
    }
    expect(planRecovery('offline')).toMatchObject({ category: 'network', retryable: true, actions: ['retry_when_online'] });
    expect(planRecovery('consent_denied')).toMatchObject({ category: 'permission', retryable: false });
  });

  it('keeps original data in the story: files stay untouched, apps keep the last working version', () => {
    expect(planRecovery('not_a_backup').kept).toBe('recovery.kept.file');
    expect(planRecovery('wrong_passphrase_or_damaged').kept).toBe('recovery.kept.file');
    expect(planRecovery('SCHEMA_INVALID').kept).toBe('recovery.kept.app');
    expect(planRecovery('record_limit')).toMatchObject({ category: 'storage', kept: 'recovery.kept.entries', actions: ['review_storage', 'export_backup'] });
    expect(planRecovery('INVALID_FORMULA')).toMatchObject({ category: 'formula', actions: ['fix_formula'] });
  });

  it('puts a failed design check in the right category by where it came from', () => {
    expect(planRecovery('SCHEMA_INVALID').category).toBe('ai_output');
    expect(planRecovery('SCHEMA_INVALID', 'import').category).toBe('import');
    expect(planRecovery('SCHEMA_INVALID', 'bazaar').category).toBe('marketplace');
    expect(planRecovery('timeout', 'import').category).toBe('network');
  });

  it('falls back to a plain plan for anything that is not a stable code, and never echoes it', () => {
    for (const raw of ['Error: could not read Asha-clinic.pdf', undefined, 42, { message: 'secret' }, new Error('SENTINEL')]) {
      const plan = planRecovery(raw);
      expect(plan).toMatchObject({ code: 'other', what: 'recovery.what.generic', kept: 'recovery.kept.none' });
      expect(JSON.stringify(plan)).not.toMatch(/Asha|secret|SENTINEL/);
    }
    // A code that errors carry in `.code` or a class name works like the string.
    expect(planRecovery({ code: 'timeout' }).code).toBe('timeout');
    expect(planRecovery({ name: 'InvalidSpecError' }).code).toBe('invalid_spec');
  });
});

describe('creationErrorCode', () => {
  const pass = (stage: 'model' | 'validation', errorCode?: 'timeout' | 'offline') => ({ pass: 'first' as const, stage, issues: [], repairs: [], ...(errorCode ? { errorCode } : {}) });
  const issue = (code: string) => ({ code, path: 'screens[0]', message: 'Asha clinic', severity: 'error' as const, recoverable: true });

  it('takes the last compile pass that named a code, else the first spec problem, else other', () => {
    expect(creationErrorCode({ errors: [issue('UNKNOWN_FIELD')], compileAttempts: [pass('model', 'offline'), pass('model', 'timeout'), pass('validation')] })).toBe('timeout');
    expect(creationErrorCode({ errors: [issue('UNKNOWN_FIELD'), issue('DUPLICATE_ID')], compileAttempts: [pass('validation')] })).toBe('UNKNOWN_FIELD');
    expect(creationErrorCode({ errors: [issue('UNKNOWN_FIELD')] })).toBe('UNKNOWN_FIELD');
    expect(creationErrorCode({ errors: [] })).toBe('other');
    expect(creationErrorCode({ errors: [issue('NOT_A_STABLE_CODE')] })).toBe('other');
  });

  it('feeds a plan that is specific, and never reads the message', () => {
    const plan = planRecovery(creationErrorCode({ errors: [], compileAttempts: [pass('model', 'offline')] }));
    expect(plan).toMatchObject({ code: 'offline', category: 'network', actions: ['retry_when_online'] });
    expect(JSON.stringify(planRecovery(creationErrorCode({ errors: [issue('UNKNOWN_FIELD')] })))).not.toContain('Asha');
  });
});

describe('recovery steps', () => {
  const plan = planRecovery('timeout');

  it('runs a listed action once the person chose it, and records it', async () => {
    const log = createRecoveryLog(10, () => 7);
    let ran = 0;
    expect(await applyRecovery(plan, 'retry', { retry: () => { ran += 1; } }, log)).toBe('applied');
    expect(ran).toBe(1);
    expect(log.recent()).toEqual([{ code: 'timeout', action: 'retry', outcome: 'applied', at: 7 }]);
  });

  it('rejects an action this failure does not list, or one the screen cannot do, and runs nothing', async () => {
    const log = createRecoveryLog();
    let ran = 0;
    const handlers = { turn_on_cloud: () => { ran += 1; }, export_backup: () => { ran += 1; } };
    expect(await applyRecovery(plan, 'turn_on_cloud', handlers, log)).toBe('rejected');
    expect(await applyRecovery(plan, 'retry', handlers, log)).toBe('rejected');
    expect(await applyRecovery(plan, 'delete_everything' as never, { delete_everything: () => { ran += 1; } } as never, log)).toBe('rejected');
    expect(ran).toBe(0);
    expect(log.recent()).toEqual([]);
    expect(availableActions(plan, handlers)).toEqual([]);
    expect(availableActions(planRecovery('consent_denied'), handlers)).toEqual(['turn_on_cloud']);
  });

  it('records a failed action without throwing', async () => {
    const log = createRecoveryLog();
    expect(await applyRecovery(plan, 'retry', { retry: async () => { throw new Error('Asha clinic'); } }, log)).toBe('failed');
    expect(log.recent()[0]).toMatchObject({ code: 'timeout', action: 'retry', outcome: 'failed' });
    expect(JSON.stringify(log.recent())).not.toContain('Asha');
  });

  it('notes what was shown and what was closed', () => {
    const log = createRecoveryLog();
    noteShown(plan, log);
    noteShown(planRecovery('not_configured'), log);
    noteDismissed(plan, log);
    expect(log.recent().map((e) => [e.code, e.outcome, e.action])).toEqual([
      ['timeout', 'dismissed', undefined], ['not_configured', 'shown', undefined], ['timeout', 'shown', 'retry'],
    ]);
  });
});
