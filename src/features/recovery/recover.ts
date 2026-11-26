/**
 * Runs a recovery step and records it (docs/14 §14.3 steps 7 and 8). Pure TypeScript: the screen hands
 * in the functions that do the work, and the log is a parameter, so the rules are tested without a device.
 *
 * Rules: an action runs only if the plan lists it for this failure (unsafe recovery is rejected, docs/14 §14.6),
 * and only when the person chose it, so the press is the confirmation. Nothing here changes saved data; the
 * handler a screen supplies (retry the build, open Settings) is the only thing that acts. If a handler
 * throws, the failure is recorded and the person's input stays where it was.
 */
import { recoveryLog, type RecoveryActionKind, type RecoveryLog } from '@/core/observability';

import type { RecoveryPlan } from './plan';

export type RecoveryHandlers = Partial<Record<RecoveryActionKind, () => unknown>>;
export type RecoveryResult = 'applied' | 'failed' | 'rejected';

/** The actions this plan lists that the screen can actually do, in order. */
export const availableActions = (plan: RecoveryPlan, handlers: RecoveryHandlers): RecoveryActionKind[] =>
  plan.actions.filter((a) => typeof handlers[a] === 'function');

export async function applyRecovery(
  plan: RecoveryPlan, action: RecoveryActionKind, handlers: RecoveryHandlers, log: RecoveryLog = recoveryLog,
): Promise<RecoveryResult> {
  const run = handlers[action];
  if (!plan.actions.includes(action) || typeof run !== 'function') return 'rejected';
  try {
    await run();
  } catch {
    log.note({ code: plan.code, action, outcome: 'failed' });
    return 'failed';
  }
  log.note({ code: plan.code, action, outcome: 'applied' });
  return 'applied';
}

/** The failure was put in front of the person. */
export const noteShown = (plan: RecoveryPlan, log: RecoveryLog = recoveryLog) =>
  log.note({ code: plan.code, outcome: 'shown', ...(plan.actions[0] ? { action: plan.actions[0] } : {}) });

/** The person closed it without acting. */
export const noteDismissed = (plan: RecoveryPlan, log: RecoveryLog = recoveryLog) =>
  log.note({ code: plan.code, outcome: 'dismissed' });
