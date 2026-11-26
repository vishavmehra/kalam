/**
 * The "Add" button an empty list can offer (docs/03 §15.5). It reuses a button the app already has on the same screen:
 * one that opens a page which saves into this list's collection. Nothing is invented, so the label, the action and what
 * happens next are exactly what the app's own button does. Pure TypeScript.
 */
import type { KalamSpec } from '@/core/spec/schema';

export interface EmptyListAdd {
  /** Id of the existing navigate action to run. */
  action: string;
  /** The label of the button it came from. */
  label: string;
}

export function emptyListAdd(spec: KalamSpec, screenId: string, source: string): EmptyListAdd | undefined {
  const screen = spec.screens.find((s) => s.id === screenId);
  if (!screen) return undefined;
  for (const c of screen.children) {
    if (c.type !== 'bigButton') continue;
    const a = spec.actions[c.action];
    if (a?.type !== 'navigate') continue;
    const target = spec.screens.find((s) => s.id === a.screen);
    if (target?.form !== source) continue;
    const saves = target.children.some((x) => {
      if (x.type !== 'bigButton') return false;
      const act = spec.actions[x.action];
      return act?.type === 'insert' && act.collection === source;
    });
    if (saves) return { action: c.action, label: c.label };
  }
  return undefined;
}
