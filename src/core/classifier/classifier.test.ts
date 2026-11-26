import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ComplexityLevel, NormalizedImage, NormalizedInput, TaskType, TemplateId } from '../contracts';
import { getTemplate } from '../templates';
import { classifyRequest } from './index';

interface Case {
  id: string;
  text: string;
  audioTranscript?: string;
  images?: number;
  drawingPages?: number;
  videoFrames?: number;
  existingTemplate?: TemplateId;
  expected: { complexity: ComplexityLevel; template?: TemplateId; taskType?: TaskType; multimodal?: boolean; lowConfidence?: boolean };
  tags: string[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/requests/classifier-cases.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

const img = (i: number, source: NormalizedImage['source']): NormalizedImage => ({
  id: `img_${i}`, mimeType: 'image/png', base64: 'iVBORw0KGgo=', width: 800, height: 1200, source,
});

function toInput(c: Case): NormalizedInput {
  const input: NormalizedInput = { text: c.text, modalities: ['text'], images: [] };
  if (c.audioTranscript) { input.audioTranscript = c.audioTranscript; input.modalities.push('audio'); }
  if (c.images) { input.images = Array.from({ length: c.images }, (_, i) => img(i, 'photo')); input.modalities.push('image'); }
  if (c.drawingPages) {
    input.modalities.push('drawing');
    input.drawing = {
      drawingId: 'd1', pageCount: c.drawingPages, texts: [],
      elements: Array.from({ length: c.drawingPages * 6 }, (_, i) => ({ kind: 'rect', page: i % c.drawingPages!, bbox: [0, 0, 10, 10] as [number, number, number, number] })),
      images: Array.from({ length: c.drawingPages }, (_, i) => img(i, 'drawing')),
    };
  }
  if (c.videoFrames) {
    input.modalities.push('video');
    input.video = { frames: Array.from({ length: c.videoFrames }, (_, i) => img(i, 'video_frame')), durationSec: 20 };
  }
  if (c.existingTemplate) {
    const t = getTemplate(c.existingTemplate)!;
    input.existingSpec = t.build(t.defaults, { appId: 'app_existing', now: 0, lang: 'en' });
  }
  return input;
}

describe('classifier benchmark (tests/fixtures/requests/classifier-cases.json)', () => {
  const results = fixture.cases.map((c) => ({ c, r: classifyRequest(toInput(c)) }));

  it('has ≥ 40 labelled cases including Hinglish/Hindi and edge cases', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40);
    expect(fixture.cases.filter((c) => c.tags.includes('hinglish') || c.tags.includes('hindi')).length).toBeGreaterThanOrEqual(8);
    expect(fixture.cases.filter((c) => c.tags.includes('edge')).length).toBeGreaterThanOrEqual(3);
  });

  it('complexity-level accuracy ≥ 90%', () => {
    const misses = results.filter(({ c, r }) => r.complexity !== c.expected.complexity);
    const accuracy = 1 - misses.length / results.length;
    // Printed so the benchmark result is visible in CI logs and reports.
    console.log(`classifier level accuracy: ${(accuracy * 100).toFixed(1)}% (${results.length - misses.length}/${results.length})`);
    for (const { c, r } of misses) console.log(`  MISS ${c.id}: expected ${c.expected.complexity}, got ${r.complexity} — ${r.reasons.join(' | ')}`);
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('template, task type, multimodal and low-confidence labels', () => {
    const wrong: string[] = [];
    for (const { c, r } of results) {
      const e = c.expected;
      if (e.template && r.matchingTemplate !== e.template) wrong.push(`${c.id}: template ${r.matchingTemplate} ≠ ${e.template}`);
      if (!e.template && r.matchingTemplate && e.complexity !== 'simple') wrong.push(`${c.id}: unexpected template ${r.matchingTemplate}`);
      if (e.taskType && r.taskType !== e.taskType) wrong.push(`${c.id}: taskType ${r.taskType} ≠ ${e.taskType}`);
      if (e.multimodal !== undefined && r.requiresMultimodalReasoning !== e.multimodal) wrong.push(`${c.id}: multimodal`);
      if (e.lowConfidence && r.confidence >= 0.5) wrong.push(`${c.id}: confidence ${r.confidence} should be low`);
    }
    const labelled = results.filter(({ c }) => c.expected.template || c.expected.taskType || c.expected.lowConfidence).length;
    console.log(`classifier secondary-label accuracy: ${labelled - wrong.length}/${labelled}`);
    for (const w of wrong) console.log(`  MISS ${w}`);
    expect(wrong.length / labelled).toBeLessThanOrEqual(0.1);
  });
});

describe('classifyRequest behaviour', () => {
  const text = (t: string): NormalizedInput => ({ text: t, modalities: ['text'], images: [] });

  it('docs/07 §3.4: four-operation calculator is simple, template, no cloud', () => {
    const r = classifyRequest(text('Make a calculator with addition, subtraction, multiplication and division'));
    expect(r).toMatchObject({
      taskType: 'create_app', complexity: 'simple', matchingTemplate: 'calculator', requiresCloudReasoning: false,
      requiresMultimodalReasoning: false, method: 'deterministic',
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.estimatedScreens).toBe(1);
    expect(r.reasons.join(' ')).toMatch(/Calculator template/);
  });

  it('complex requests require cloud and never carry a template', () => {
    const r = classifyRequest(text('CRM with leads, deals, customers, follow-up workflow and sales dashboards'));
    expect(r.complexity).toBe('complex');
    expect(r.requiresCloudReasoning).toBe(true);
    expect(r.matchingTemplate).toBeUndefined();
    expect(r.estimatedCollections).toBeGreaterThan(1);
  });

  it('vague text fails safely: low confidence, no cloud, explains why', () => {
    const r = classifyRequest(text('app banao'));
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.requiresCloudReasoning).toBe(false);
    expect(r.reasons[0]).toMatch(/vague|clearly/);
  });

  it('sketches always go to cloud vision, even with a template word', () => {
    const r = classifyRequest({ ...text('make this calculator'), images: [img(0, 'photo')], modalities: ['text', 'image'] });
    expect(r.taskType).toBe('interpret_sketch');
    expect(r.requiresCloudReasoning).toBe(true);
    expect(r.matchingTemplate).toBeUndefined();
  });

  it('simple request without a template still needs generation (cloud), honestly flagged', () => {
    const r = classifyRequest(text('Track my weight every morning'));
    expect(r.complexity).toBe('simple');
    expect(r.matchingTemplate).toBeUndefined();
    expect(r.requiresCloudReasoning).toBe(true);
  });

  it('is cheap: well under 2 ms per request (a model call takes ~1 s)', () => {
    const run = () => classifyRequest(text('roz ka kharcha likhne ka app chahiye, rupaye mein'));
    for (let i = 0; i < 50; i += 1) run(); // warm the JIT first
    // Best of 5 batches: a shared CI/dev machine can stall any single batch; the fastest one shows the real cost.
    const batches = Array.from({ length: 5 }, () => {
      const start = performance.now();
      for (let i = 0; i < 100; i += 1) run();
      return (performance.now() - start) / 100;
    });
    expect(Math.min(...batches)).toBeLessThan(2);
  });
});

describe('what is asked for decides the level, not the input type (docs/07 §3.2)', () => {
  const drawing = (pages: number, buttons: number, extra = 0): NormalizedInput => ({
    text: '', modalities: ['drawing'], images: [],
    drawing: {
      drawingId: 'd', pageCount: pages, texts: ['Customers', 'Payments', 'Orders'], images: [],
      elements: [
        ...Array.from({ length: buttons }, () => ({ kind: 'stamp:bigButton', page: 0, bbox: [0, 0, 1, 1] as [number, number, number, number] })),
        ...Array.from({ length: extra }, () => ({ kind: 'stamp:textInput', page: 0, bbox: [0, 0, 1, 1] as [number, number, number, number] })),
      ],
    },
  });
  const video = (frames: number, summary?: string, extra: Partial<NormalizedInput> = {}): NormalizedInput => ({
    text: '', modalities: ['video'], images: [],
    video: { frames: Array.from({ length: frames }, (_, i) => img(i, 'video_frame')), durationSec: 30, ...(summary ? { summary } : {}) },
    ...extra,
  });

  it('a small Studio sketch is simple but still reads with cloud vision', () => {
    const r = classifyRequest(drawing(1, 4, 3));
    expect(r).toMatchObject({ complexity: 'simple', taskType: 'interpret_sketch', requiresCloudReasoning: true, requiresMultimodalReasoning: true });
    expect(r.matchingTemplate).toBeUndefined();
    expect(classifyRequest(drawing(2, 1, 4)).complexity).toBe('simple'); // a form and its list
  });

  it('sketch size comes from screens, actions and parts; its labels never raise it', () => {
    expect(classifyRequest(drawing(2, 2)).complexity).toBe('medium');
    expect(classifyRequest(drawing(3, 1)).complexity).toBe('medium');
    expect(classifyRequest(drawing(1, 4, 12)).complexity).toBe('medium'); // many parts on one page
    expect(classifyRequest(drawing(5, 3)).complexity).toBe('complex');
    expect(classifyRequest(drawing(1, 1)).reasons.join(' ')).not.toMatch(/kinds of records/);
  });

  it('a sketch with a typed instruction is at least medium; heavy words make it complex', () => {
    expect(classifyRequest({ ...drawing(1, 2), text: 'use rupees', modalities: ['drawing', 'text'] }).complexity).toBe('medium');
    const crm = 'A CRM for my sales team with leads, deals, follow-up workflow and dashboards';
    expect(classifyRequest({ ...drawing(1, 2), text: crm, modalities: ['drawing', 'text'] }).complexity).toBe('complex');
  });

  it('a photo hides its structure, so it starts at medium; more than four photos is complex', () => {
    const photos = (n: number): NormalizedInput => ({ text: '', modalities: ['image'], images: Array.from({ length: n }, (_, i) => img(i, 'photo')) });
    expect(classifyRequest(photos(1)).complexity).toBe('medium');
    expect(classifyRequest(photos(5)).complexity).toBe('complex');
  });

  it('video frames are samples of one clip, not images', () => {
    expect(classifyRequest(video(12)).complexity).toBe('medium');
    expect(classifyRequest(video(8, 'A walkthrough of a shop stock app: item list, add item form and a low stock list.')).complexity).toBe('medium');
    expect(classifyRequest(video(3, 'A tour of a clinic system with patients, doctors, appointments, billing and reports for admin and doctor logins.')).complexity).toBe('complex');
    // The same frames sent as images beside the clip are still the clip.
    expect(classifyRequest(video(6, undefined, { images: Array.from({ length: 6 }, (_, i) => img(i, 'video_frame')) })).complexity).toBe('medium');
  });
});

describe('links and ordinary reports are medium; heavy signals make complex (docs/07 §3.1)', () => {
  const level = (t: string) => classifyRequest({ text: t, modalities: ['text'], images: [] }).complexity;

  it('a voice attendance register with a monthly summary is medium', () => {
    expect(classifyRequest({ text: '', audioTranscript: 'attendance register for my tuition class where each student is present or absent and I can see a monthly summary', modalities: ['audio'], images: [] }).complexity).toBe('medium');
  });

  it('records with a history or a monthly report stay medium', () => {
    expect(level('Clinic app with patients, doctors, appointments and visit history')).toBe('medium');
    expect(level("Student fee register: each student's fees paid and pending, with a monthly report")).toBe('medium');
  });

  it('roles, workflows and whole systems stay complex', () => {
    expect(level('ERP for my factory')).toBe('complex');
    expect(level('Hospital app where patients book appointments, doctors approve them, then the pharmacy dispenses medicines and billing generates invoices automatically')).toBe('complex');
    expect(level('Tailor shop with admin and staff logins, roles and permissions, customers, orders and payments')).toBe('complex');
  });

  it('a tuition class is not a fee', () => {
    const r = classifyRequest({ text: 'attendance for my tuition class', modalities: ['text'], images: [] });
    expect(r.estimatedCollections).toBeLessThanOrEqual(1);
  });
});
