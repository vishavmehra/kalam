import { describe, expect, it } from 'vitest';
import { summarizeDrawing } from '@/features/drawing/model/summarize';
import { STAMPS } from '@/features/drawing/model/document';
import { listTemplates } from '@/core/templates';
import { validateGolden } from './golden';
import { PAGE_HEIGHT, PAGE_WIDTH, STAMP_SIZES, buildSketchDocument, expectedExtraction } from './sketch-builder';
import { loadGolden } from './test-helpers';
import type { GoldenModalityCase, GoldenSketchCase, GoldenTextCase } from './types';

const golden = loadGolden();
const templateIds = listTemplates().map((t) => t.id);

describe('golden dataset', () => {
  it('has 25 text requests including Hinglish and Hindi, 25 sketches and 25 modality cases', () => {
    expect(golden.text).toHaveLength(25);
    expect(golden.sketches).toHaveLength(25);
    expect(golden.modalities).toHaveLength(25);
    for (const m of ['image', 'audio', 'video', 'mixed'] as const) {
      expect(golden.modalities.filter((c) => c.modality === m).length, `no ${m} cases`).toBeGreaterThanOrEqual(5);
    }
    expect(golden.text.filter((c) => c.language === 'hinglish').length).toBeGreaterThanOrEqual(3);
    expect(golden.text.filter((c) => c.language === 'hi').length).toBeGreaterThanOrEqual(1);
    expect(golden.meta.datasetVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is structurally valid against the registered templates', () => {
    expect(
      validateGolden({ text: golden.text, sketches: golden.sketches, modalities: golden.modalities, templateIds }),
    ).toEqual([]);
  });

  it('covers every complexity level and both routes', () => {
    const levels = new Set(
      [...golden.text, ...golden.sketches, ...golden.modalities].map((c) => c.expected.complexity),
    );
    expect([...levels].sort()).toEqual(['complex', 'medium', 'simple']);
    expect(golden.text.some((c) => c.expected.route === 'template')).toBe(true);
    expect(golden.text.some((c) => c.expected.route === 'cloud')).toBe(true);
  });

  it('exercises every template the registry offers at least once', () => {
    const used = new Set(golden.text.map((c) => c.expected.template).filter(Boolean));
    for (const id of templateIds) expect(used.has(id), `template ${id} has no golden request`).toBe(true);
  });

  it('includes a prompt-injection case with forbidden text and a vague case', () => {
    expect(golden.text.some((c) => (c.expected.forbiddenText?.length ?? 0) > 0)).toBe(true);
    expect(golden.text.some((c) => c.expected.lowConfidence)).toBe(true);
  });

  it('flags ambiguous cases instead of hiding them', () => {
    expect(golden.text.filter((c) => c.ambiguous).length).toBeGreaterThan(0);
    for (const c of [...golden.text, ...golden.sketches, ...golden.modalities].filter((x) => x.ambiguous)) {
      expect(c.notes, `${c.id} is ambiguous and needs a note`).toBeTruthy();
    }
  });
});

describe('human review and missing assets', () => {
  it('marks every case as needing a person, because no one has reviewed the labels yet', () => {
    for (const c of [...golden.text, ...golden.sketches, ...golden.modalities]) {
      expect(c.review?.status ?? 'needs_human_review', c.id).toBe('needs_human_review');
    }
  });

  it('says how many hand-drawn photo sketches exist, and that none do yet', () => {
    expect(golden.meta.handDrawnPhotos).toMatchObject({ required: 25, present: 0 });
    expect(golden.meta.handDrawnPhotos?.note).toMatch(/person with paper and a camera/);
  });

  it('names the real asset behind every placeholder photo, frame or recording', () => {
    for (const c of golden.modalities.filter((x) => x.images || x.video || x.untranscribedAudio)) {
      expect(c.needsAssets, c.id).toBeTruthy();
    }
    expect(
      golden.modalities
        .filter((c) => c.sketch || c.audioTranscript)
        .every((c) => !c.needsAssets || c.images || c.video),
    ).toBe(true);
  });
});

describe('validateGolden', () => {
  const base = golden.text[0] as GoldenTextCase;
  const sketch = golden.sketches[0] as GoldenSketchCase;
  const run = (text: GoldenTextCase[], sketches: GoldenSketchCase[] = []) =>
    validateGolden({ text, sketches, templateIds });

  it('reports duplicate ids and bad ids', () => {
    expect(run([base, base]).join('\n')).toMatch(/duplicate id/);
    expect(run([{ ...base, id: 'Bad Id' }]).join('\n')).toMatch(/ids are lowercase/);
  });

  it('requires a template exactly when the route is template', () => {
    const noTemplate = { ...base, expected: { ...base.expected, template: undefined } };
    expect(run([noTemplate]).join('\n')).toMatch(/needs a template id/);
    const cloudWithTemplate = { ...base, expected: { ...base.expected, route: 'cloud' as const } };
    expect(run([cloudWithTemplate]).join('\n')).toMatch(/must not name a template/);
    const unknown = { ...base, expected: { ...base.expected, template: 'spaceship' as never } };
    expect(run([unknown]).join('\n')).toMatch(/unknown template/);
  });

  it('only lets simple requests take the template route', () => {
    const medium = { ...base, expected: { ...base.expected, complexity: 'medium' as const } };
    expect(run([medium]).join('\n')).toMatch(/only simple requests/);
  });

  it('catches a sketch whose declared stamp counts do not match its layout', () => {
    const wrong = {
      ...sketch,
      expected: { ...sketch.expected, stamps: { ...expectedExtraction(sketch).stamps, bigButton: 99 } },
    };
    expect(run([], [wrong]).join('\n')).toMatch(/expects 99 bigButton/);
  });

  it('checks modality cases: input present, modality matches, sketch exists, placeholders name their asset', () => {
    const mod = golden.modalities.find((c) => c.modality === 'image') as GoldenModalityCase;
    const check = (c: GoldenModalityCase) =>
      validateGolden({ text: [], sketches: golden.sketches, modalities: [c], templateIds }).join(' | ');
    expect(check({ ...mod, images: undefined, text: undefined })).toMatch(/has no input/);
    expect(check({ ...mod, modality: 'video' })).toMatch(/must carry video input/);
    expect(check({ ...mod, modality: 'mixed' })).toMatch(/at least two kinds of input/);
    expect(check({ ...mod, text: 'x', sketch: 'nope' })).toMatch(/unknown sketch "nope"/);
    expect(check({ ...mod, needsAssets: undefined })).toMatch(/must say which real asset/);
    expect(check(mod)).toBe('');
  });

  it('requires sketches to route to the cloud with the sketch task', () => {
    const wrong = {
      ...sketch,
      expected: { ...sketch.expected, route: 'template' as const, template: 'counter' as const },
    };
    expect(run([], [wrong]).join('\n')).toMatch(/route must be "cloud"/);
  });
});

describe('sketch builder', () => {
  it('is deterministic: the same sketch builds the same document every time', () => {
    for (const c of golden.sketches) {
      expect(buildSketchDocument(c)).toEqual(buildSketchDocument(c));
      expect(JSON.stringify(buildSketchDocument(c))).toBe(JSON.stringify(buildSketchDocument(c)));
    }
  });

  it('builds real documents: unique ids, page per screen, titles kept', () => {
    for (const c of golden.sketches) {
      const doc = buildSketchDocument(c);
      expect(doc.pages).toHaveLength(c.pages.length);
      expect(doc.pages.map((p) => p.title)).toEqual(c.pages.map((p) => p.title));
      const ids = doc.pages.flatMap((p) => [p.id, ...p.elements.map((e) => e.id)]);
      expect(new Set(ids).size, `${c.id} has duplicate ids`).toBe(ids.length);
      expect(doc.createdAt).toBe(0);
    }
  });

  it('keeps every element on its page and stamps in a single column without overlap', () => {
    for (const c of golden.sketches) {
      for (const page of buildSketchDocument(c).pages) {
        expect(page.width).toBe(PAGE_WIDTH);
        expect(page.height).toBe(PAGE_HEIGHT);
        const stamps = page.elements.filter((e) => e.kind === 'stamp');
        for (const e of stamps) {
          if (e.kind !== 'stamp') continue;
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(PAGE_WIDTH);
          expect(e.y + e.h, `${c.id}/${page.title} runs off the page`).toBeLessThanOrEqual(PAGE_HEIGHT);
        }
        const sorted = stamps.flatMap((e) => (e.kind === 'stamp' ? [e] : [])).sort((a, b) => a.y - b.y);
        sorted.forEach((e, i) => {
          const next = sorted[i + 1];
          if (next) expect(e.y + e.h, `${c.id}/${page.title}: stamps overlap`).toBeLessThanOrEqual(next.y);
        });
      }
    }
  });

  it('uses the same stamp sizes and default labels as the Drawing Studio', () => {
    for (const s of STAMPS) {
      expect(STAMP_SIZES[s.component], `no size for stamp ${s.component}`).toEqual({ w: s.w, h: s.h, label: s.label });
    }
    expect(Object.keys(STAMP_SIZES).sort()).toEqual(STAMPS.map((s) => s.component).sort());
  });

  it('round-trips through the Drawing Studio summary: every label and stamp comes back', () => {
    for (const c of golden.sketches) {
      const summary = summarizeDrawing(buildSketchDocument(c));
      expect(summary.pageCount).toBe(c.pages.length);
      const texts = new Set(summary.texts.map((t) => t.toLowerCase()));
      const want = expectedExtraction(c);
      for (const label of want.labels)
        expect(texts.has(label.toLowerCase()), `${c.id}: label "${label}" was lost`).toBe(true);
      for (const [name, n] of Object.entries(want.stamps)) {
        const got = summary.elements.filter((e) => e.kind === `stamp:${name}`).length;
        expect(got, `${c.id}: ${name} stamps`).toBe(n);
      }
    }
  });

  it('reads labels and stamp counts off the layout when a sketch does not declare them', () => {
    const calc = golden.sketches.find((c) => c.id === 's11-gst-calculator') as GoldenSketchCase;
    expect(calc.expected.labels).toBeUndefined();
    expect(expectedExtraction(calc)).toEqual({
      labels: ['GST calculator', 'Amount before tax', 'GST rate percent', 'GST amount', 'Total with GST'],
      stamps: { heading: 1, textInput: 2, stat: 2 },
    });
    const declared = golden.sketches.find((c) => c.id === 's01-calculator') as GoldenSketchCase;
    expect(expectedExtraction(declared).labels).toBe(declared.expected.labels);
  });

  it('attaches a label written inside a hand-drawn box to that box', () => {
    const clinic = golden.sketches.find((c) => c.id === 's10-clinic-six-screens');
    expect(clinic).toBeDefined();
    const summary = summarizeDrawing(buildSketchDocument(clinic as GoldenSketchCase));
    const box = summary.elements.find((e) => e.kind === 'rect');
    expect(box?.label).toBe('Tap an appointment to add visit notes');
  });
});
