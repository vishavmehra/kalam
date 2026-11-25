import { describe, expect, it } from 'vitest';
import { loadFixtures } from '../../../tests/fixtures/specs/load';
import { describeSpec, validateSpec, type KalamSpec } from './index';

const specs = Object.fromEntries(
  loadFixtures('valid').map(({ name, json }) => [name, validateSpec(json).spec as KalamSpec]),
);

describe('describeSpec', () => {
  it('summarises the tailor book in plain language', () => {
    const u = describeSpec(specs['tailor-measurement-book'] as KalamSpec);
    expect(u.appName).toBe('Ramesh Tailors');
    expect(u.purpose).toBe('A local tailoring order and measurement book.');
    expect(u.screens.map((s) => s.title)).toEqual(['Orders', 'New order']);
    expect(u.screens[1]?.items).toEqual(expect.arrayContaining(['Button: Save order', 'Text box: Customer name', 'Photo: Scan measurement slip (read by AI)']));
    expect(u.actions).toContain('Opens New order');
    expect(u.actions).toContain('Saves a new order, returns to Orders and says “Order saved”');
    expect(u.collections[0]).toMatchObject({ id: 'orders', name: 'Orders' });
    expect(u.collections[0]?.fields).toContainEqual({ label: 'Customer name', type: 'Text', required: true });
    expect(u.collections[0]?.fields).toContainEqual({ label: 'Chest', type: 'Number (in)', required: false });
    expect(u.aiFeatures[0]).toMatchObject({ id: 'slip_to_order', kind: 'extractFromPhoto', verified: 'Not checked yet' });
    expect(u.aiFeatures[0]?.description).toMatch(/^Reads a photo and fills in customer name, garment/);
    expect(u.assumptions).toEqual(expect.arrayContaining(['Currency set to INR', 'Language: Hindi', 'Opens on Orders']));
  });

  it('describes counters, updates, deletes and AI actions', () => {
    expect(describeSpec(specs['habit-counter'] as KalamSpec).actions).toEqual(
      ['Adds 1 to glasses of water', 'Resets glasses of water', 'Adds 5 to push-ups'],
    );
    const khata = describeSpec(specs['kirana-credit-book'] as KalamSpec).actions;
    expect(khata).toContain('Updates the chosen entry and returns to Khata');
    expect(khata).toContain('Deletes the chosen entry after asking “Delete this entry?” and returns to Khata');
    expect(describeSpec(specs['notes-app'] as KalamSpec).actions).toContain('Summarises note in up to 40 words using AI');
  });

  it('never leaks raw ids into user-facing sentences', () => {
    for (const [name, spec] of Object.entries(specs)) {
      const u = describeSpec(spec as KalamSpec);
      const sentences = [u.purpose, ...u.actions, ...u.assumptions, ...u.screens.flatMap((s) => s.items), ...u.aiFeatures.map((a) => a.description)];
      for (const s of sentences) expect(s, `${name}: ${s}`).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
  });

  it('works for every valid fixture', () => {
    for (const spec of Object.values(specs)) {
      const u = describeSpec(spec as KalamSpec);
      expect(u.screens.length).toBe(spec?.screens.length);
      expect(u.assumptions.length).toBeGreaterThan(0);
    }
  });
});
