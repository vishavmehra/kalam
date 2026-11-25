import { describe, expect, it } from 'vitest';
import { kalamSpecSchema, type KalamSpec } from '@/core/spec/schema';
import { applyVerification, joinSummary, presetOps } from './edit-model';

const spec: KalamSpec = kalamSpecSchema.parse({
  id: 'app_notes', schemaVersion: '1.0.0', version: 3, name: 'Notes', lang: 'en',
  theme: { primary: '#315C4C', radius: 12, fontScale: 1 },
  collections: { notes: { fields: { body: { type: 'text', label: 'Note' }, tag: { type: 'text', label: 'Tag' } } } },
  screens: [{ id: 'home', title: 'Notes', form: 'notes', children: [{ id: 'body_in', type: 'textInput', label: 'Note', field: 'body' }] }],
  initialScreen: 'home',
  actions: {},
  aiBlocks: { tagger: { kind: 'classify', prompt: 'Tag the note', verified: 'unverified', labels: ['work', 'home'], inputField: 'body', outputField: 'tag' } },
  intents: {},
  meta: { createdAt: 0 },
});

describe('edit model', () => {
  it('records a verification result as valid spec data without mutating the input', () => {
    const before = JSON.stringify(spec);
    const out = applyVerification(spec, 'tagger', { status: 'onDevice', testCount: 99, passCount: 120, model: 'nano', details: [] }, 1700000000000.7);
    expect(JSON.stringify(spec)).toBe(before);
    expect(out.aiBlocks.tagger).toMatchObject({ verified: 'onDevice', verification: { status: 'onDevice', testCount: 50, passCount: 50, model: 'nano', verifiedAt: 1700000000000 } });
    expect(kalamSpecSchema.safeParse(out).success).toBe(true);
    expect(applyVerification(spec, 'missing', { status: 'onDevice', testCount: 5, passCount: 5, details: [] }, 0)).toBe(spec);
  });

  it('preset ops set colours only; summaries stay bounded', () => {
    const ops = presetOps('ocean_blue');
    expect(ops[0]).toEqual({ op: 'setThemePreset', preset: 'ocean_blue' });
    expect(ops.every((o) => o.op === 'setThemePreset' || o.op === 'setThemeToken')).toBe(true);
    expect(joinSummary('a', 'b')).toBe('a; b');
    expect(joinSummary('x'.repeat(300), 'y').length).toBe(238);
  });
});

describe('background moods', () => {
  it('sets background, surface and text together and recognises the result', async () => {
    const { BACKGROUND_MOODS, currentMood, moodOps } = await import('./edit-model');
    const ops = moodOps('dark');
    expect(ops.map((o) => (o.op === 'setThemeToken' ? o.token : o.op))).toEqual(['background', 'surface', 'text']);
    const m = BACKGROUND_MOODS.dark;
    expect(currentMood({ background: m.background.toLowerCase(), surface: m.surface, text: m.text })).toBe('dark');
    expect(currentMood({ background: '#123456', surface: m.surface, text: m.text })).toBeUndefined();
  });
});

