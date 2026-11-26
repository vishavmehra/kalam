/**
 * The AI pre-scorer checks that an app works, not only that the drawn controls exist (eval 2026-11-25: Gemini
 * scored 45 of 50 correct where the reviewer found 34). It is told what each button does, which records are
 * linked and which saved fields are never shown, on the real s07 and s20 apps.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@/core/compiler/complete';
import type { KalamSpec } from '@/core/spec/schema';
import { validateSpec } from '@/core/spec/validate';
import { howItWorks, JUDGE_SYSTEM } from './review';

const FIXTURES: Array<{ id: string; request: string; spec: KalamSpec }> = JSON.parse(
  readFileSync(new URL('../../fixtures/compiler/eval-2026-11-25-built.json', import.meta.url), 'utf8'),
).cases;
const fixture = (prefix: string) => FIXTURES.find((c) => c.id.startsWith(`${prefix}-`))!;

describe('judge prompt', () => {
  it('asks for linked records, visible fields, buttons with an effect, real periods and followed instructions', () => {
    expect(JUDGE_SYSTEM).toMatch(/Linked records:.*only that owner's entries.*Repayments must lower a balance/);
    expect(JUDGE_SYSTEM).toMatch(/Saved fields: every field the person fills in must be visible again/);
    expect(JUDGE_SYSTEM).toMatch(/Buttons: each button must have an effect/);
    expect(JUDGE_SYSTEM).toMatch(/Periods:.*"this week"/);
    expect(JUDGE_SYSTEM).toMatch(/Instructions: what the person typed or said must be followed/);
  });

  it('s20 as built: the judge is told "Mark done" saves nothing and which fields are never shown', () => {
    const lines = howItWorks(fixture('s20').spec).join('\n');
    expect(lines).toMatch(/Button "Mark done" on "Details" saves nothing/);
    expect(lines).toMatch(/Button "Cancel" on "Details" deletes the opened entry/);
    expect(lines).toMatch(/Saved but never shown again: .*Phone/);
  });

  it('s07 after the repair: the judge is told each entry is linked to one customer', () => {
    const f = fixture('s07');
    const fixed = completeSpec(validateSpec(f.spec).spec!, { request: f.request }).spec;
    const lines = howItWorks(fixed).join('\n');
    expect(lines).toMatch(/Each "Entries" entry is linked to one "Customers"/);
    expect(lines).not.toMatch(/Saved but never shown again/);
    expect(lines).toMatch(/Money is shown in INR/);
  });
});
