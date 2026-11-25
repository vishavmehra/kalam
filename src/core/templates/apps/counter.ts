import { z } from 'zod';
import type { KalamComponent } from '../../spec/schema';
import { assembleSpec, baseParamsShape, extractBase, phrases, type KalamTemplate } from '../base';
import { extractNumberAfter } from '../extract';

const paramsSchema = z
  .object({
    ...baseParamsShape,
    /** What is being counted, e.g. "Glasses of water", "Malas". */
    label: z.string().trim().min(1).max(40),
    step: z.number().positive().max(1000),
    /** 0 = no target. */
    target: z.number().int().min(0).max(1_000_000),
    allowNegative: z.boolean(),
  })
  .strict();
export type CounterParams = z.infer<typeof paramsSchema>;

const COUNTED = /\b(?:count|counting|counter for|tally of|track|ginti)\s+(?:my\s+|the\s+|of\s+)?([a-z][a-z ]{2,30}?)(?=\s+(?:with|and|for|to|up|till|until|target|goal|per|each|every|daily)\b|[.,!?]|$)/i;

export const counterTemplate: KalamTemplate<CounterParams> = {
  id: 'counter',
  title: 'Counter',
  description: 'A big tap counter with add, subtract and reset, plus an optional target.',
  strongKeywords: ['counter', 'tally', 'ginti', 'tap count', 'clicker', 'jaap', 'गिनती', 'काउंटर'],
  keywords: [
    'counter', 'count', 'tally', 'ginti', 'gino', 'clicker', 'increment', 'tap', 'mala', 'jaap', 'score',
    'glasses of water', 'reps', 'गिनती', 'काउंटर',
  ],
  examples: ['A simple counter with plus, minus and reset', 'Mala jaap counter with target 108', 'ginti karne wala app'],
  paramsSchema,
  defaults: { name: 'Counter', theme: 'calm_green', label: 'Count', step: 1, target: 0, allowNegative: false },
  extractParams(text) {
    const out: Partial<CounterParams> = extractBase(text);
    const target = extractNumberAfter(text, ['target', 'goal', 'up to', 'upto', 'till', 'until', 'lakshya']);
    if (target !== undefined && Number.isInteger(target)) out.target = target;
    else if (/\bmala\b|\bjaap\b|\bjap\b/i.test(text)) out.target = 108;
    const step = extractNumberAfter(text, ['step of', 'steps of', 'by']);
    if (step !== undefined && step > 0 && step <= 1000) out.step = step;
    if (/\bnegative\b|below zero/i.test(text)) out.allowNegative = true;
    const counted = COUNTED.exec(text)?.[1]?.trim();
    if (counted && !/^(?:app|application|counter|something|things?)$/i.test(counted)) {
      out.label = counted.charAt(0).toUpperCase() + counted.slice(1);
    } else if (/\bmala\b|\bjaap\b|\bjap\b/i.test(text)) out.label = 'Mala count';
    return out;
  },
  build(p, opts) {
    const children: KalamComponent[] = [
      {
        id: 'count', type: 'counter', label: p.label, step: p.step,
        ...(p.allowNegative ? {} : { min: 0 }),
        a11yLabel: `${p.label} counter`, readAloud: `${p.label} is now`,
      },
    ];
    if (p.target > 0) {
      children.push(
        { id: 'left_to_target', type: 'stat', label: `Left to reach ${p.target}`, expr: `max(${p.target} - state.count, 0)`, format: 'integer' },
        { id: 'target_status', type: 'stat', label: 'Status', expr: `if(state.count >= ${p.target}, 'Target reached', 'Keep going')`, format: 'text' },
      );
    }
    children.push(
      { id: 'add_button', type: 'bigButton', label: `Add ${p.step}`, action: 'add_one', tone: 'primary' },
      { id: 'remove_button', type: 'bigButton', label: `Subtract ${p.step}`, action: 'remove_one', tone: 'secondary' },
      { id: 'reset_button', type: 'bigButton', label: 'Reset to zero', action: 'reset_count', tone: 'danger' },
    );
    return assembleSpec(
      {
        templateId: 'counter',
        name: p.name,
        description: p.target > 0 ? `Counts ${p.label.toLowerCase()} towards a target of ${p.target}.` : `Counts ${p.label.toLowerCase()} with one tap.`,
        glyph: 'plus',
        theme: p.theme,
        collections: {},
        screens: [{ id: 'counter', title: p.name.slice(0, 60), children }],
        actions: {
          add_one: { type: 'increment', target: 'count', by: p.step },
          remove_one: { type: 'decrement', target: 'count', by: p.step },
          reset_count: { type: 'reset', target: 'count' },
        },
        intents: {
          add_one: phrases(['add', 'plus', 'plus one', 'one more', 'count', 'ek aur', 'badhao', 'aur ek', 'एक और', 'बढ़ाओ']),
          remove_one: phrases(['minus', 'minus one', 'subtract', 'one less', 'ek kam', 'ghatao', 'कम करो', 'घटाओ']),
          reset_count: phrases(['reset counter', 'start over', 'back to zero', 'zero karo', 'shuru se', 'शून्य करो', 'फिर से शुरू']),
        },
        tags: ['counter'],
      },
      opts,
    );
  },
};
