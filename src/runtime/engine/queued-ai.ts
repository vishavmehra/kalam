/**
 * A queued AI step that finished while the app was closed or offline (features/queue) comes back as a proposal,
 * checked exactly like a live one: the block's declared fields only, every value coerced and bounded, nothing
 * written until the person accepts. It appears only on the screen that runs the step, because accepting fills
 * that screen's form. Pure TypeScript.
 */
import type { RecordValue } from '@/core/contracts';
import type { KalamScreen, KalamSpec } from '@/core/spec/schema';
import { validateProposal } from './dispatch';
import { currentScreen } from './state';
import type { AIProposal, EngineEnv, RuntimeState } from './types';

/** The action a button on `screen` uses to run `blockId`, if any. */
function runAction(spec: KalamSpec, screen: KalamScreen, blockId: string) {
  for (const c of screen.children) {
    if (c.type !== 'bigButton') continue;
    const action = Object.prototype.hasOwnProperty.call(spec.actions, c.action) ? spec.actions[c.action] : undefined;
    if (action?.type === 'runAI' && action.aiBlock === blockId) return action;
  }
  return undefined;
}

/** Whether this screen is where the step is started: a photo that runs it, or a button that does. */
export function screenRunsBlock(spec: KalamSpec, screen: KalamScreen, blockId: string): boolean {
  return screen.children.some((c) => c.type === 'photo' && c.aiBlock === blockId) || runAction(spec, screen, blockId) !== undefined;
}

/**
 * The proposal for a finished queued step, or undefined when it cannot be shown here: the step no longer exists,
 * this is not the screen that runs it, or nothing in the result passes the block's checks.
 */
export function proposalFromQueued(
  env: EngineEnv, state: RuntimeState, result: { blockId: string; output: Record<string, RecordValue> },
): AIProposal | undefined {
  if (!Object.prototype.hasOwnProperty.call(env.spec.aiBlocks, result.blockId)) return undefined;
  const block = env.spec.aiBlocks[result.blockId];
  const screen = currentScreen(env.spec, state);
  if (!screenRunsBlock(env.spec, screen, result.blockId)) return undefined;
  const { values, rejected } = validateProposal(env, screen, block, result.output);
  if (!Object.keys(values).length) return undefined;
  return {
    blockId: result.blockId, screenId: screen.id, values, rejected,
    // The queue only ever runs a step online, through the cloud route.
    source: 'cloud', provider: 'queue', latencyMs: 0,
    then: runAction(env.spec, screen, result.blockId)?.then,
  };
}
