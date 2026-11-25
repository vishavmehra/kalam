/**
 * Suggested questions built from the spec. Each one is worded so the assistant answers it without
 * a model, so the suggestions always work, offline included.
 */
import type { KalamSpec } from '../spec/schema';
import { collectionName, lower, singular } from './text';

export function suggestQuestions(spec: KalamSpec, max = 5): string[] {
  const out: string[] = [];
  const collections = Object.entries(spec.collections);
  collections.slice(0, 2).forEach(([cid, c], i) => {
    const plural = lower(collectionName(spec, cid));
    const noun = lower(singular(collectionName(spec, cid)));
    out.push(`How many ${plural} do I have?`);
    const money = Object.values(c.fields).find((f) => f.type === 'number');
    if (money) out.push(`What is the total ${lower(money.label)}${collections.length > 1 ? ` of ${plural}` : ''}?`);
    if (i === 0 && Object.values(c.fields).some((f) => f.type === 'date')) out.push(`How many ${plural} today?`);
    if (i === 0 && spec.screens.some((s) => s.form === cid)) out.push(`How do I add ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}?`);
  });
  const button = spec.screens.flatMap((s) => s.children).find((c) => c.type === 'bigButton');
  if (button && button.type === 'bigButton') out.push(`What does ${button.label} do?`);
  out.push('What can I do in this app?');
  return [...new Set(out)].slice(0, max);
}
