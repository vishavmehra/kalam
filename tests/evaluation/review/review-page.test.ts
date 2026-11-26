/**
 * Drives the scoring page in jsdom (no browser, no network): loads a report, scores with the keyboard,
 * filters, and exports. The page is one self-contained HTML file, so this test loads that file as is.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { CreateApplication, CreationResult, DrawingDocument, TaskClassification } from '@/core/contracts';
import { describeSpec } from '@/core/spec/describe';
import { validateSpec } from '@/core/spec/validate';
import { getTemplate } from '@/core/templates';
import { summarizeDrawing } from '@/features/drawing/model/summarize';
import { evaluateSketchCase, evaluateTextCase, type EvalDeps } from '../runner/evaluate';
import { buildReport } from '../runner/metrics';
import { runtimeSmoke } from '../runner/runtime-smoke';
import { loadGolden } from '../runner/test-helpers';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const golden = loadGolden();

const cls = (): TaskClassification => ({
  taskType: 'create_app',
  complexity: 'simple',
  estimatedScreens: 1,
  estimatedCollections: 0,
  estimatedActions: 0,
  requiresMultimodalReasoning: false,
  requiresCloudReasoning: false,
  confidence: 0.9,
  method: 'deterministic',
  reasons: [],
  matchingTemplate: 'counter',
});

async function sampleReport() {
  const t = getTemplate('counter')!;
  const spec = validateSpec(t.build(t.defaults as never, { appId: 'app_page_test', now: 0, lang: 'en' })).spec!;
  const createApplication: CreateApplication = async () =>
    ({
      ok: true,
      spec,
      classification: cls(),
      route: 'template',
      provider: 'deterministic',
      understanding: describeSpec(spec),
      warnings: [],
      errors: [],
      latencyMs: 1,
    }) satisfies CreationResult;
  let clock = 0;
  const deps: EvalDeps = {
    classify: cls,
    createApplication,
    validate: validateSpec,
    describe: describeSpec,
    summarizeDrawing: (d: DrawingDocument) => summarizeDrawing(d),
    runtimeSmoke,
    now: () => (clock += 2),
  };
  const opts = { mode: 'deterministic' as const, captureDetail: true };
  const a = await evaluateTextCase(golden.text[1]!, deps, opts);
  const b = await evaluateTextCase(golden.text[2]!, deps, opts);
  const s = await evaluateSketchCase(golden.sketches[0]!, deps, opts);
  // a case that built nothing
  const none = await evaluateTextCase(
    golden.text[3]!,
    {
      ...deps,
      createApplication: async () => ({
        ok: false,
        classification: cls(),
        route: 'cloud',
        provider: 'none',
        warnings: [],
        errors: [],
        latencyMs: 1,
        message: 'Offline.',
      }),
    },
    opts,
  );
  none.detail = { ...none.detail!, notBuilt: 'Needs a real photo.', spec: undefined };
  a.aiPreScore = { score: 'correct', reasons: ['Does the job.'], confidence: 0.95 };
  a.mayDisagree = { flag: false, reasons: [] };
  b.aiPreScore = { score: 'partly', reasons: ['Misses a field.'], confidence: 0.5 };
  b.mayDisagree = { flag: true, reasons: ['The AI is not sure'] };
  s.aiPreScore = { score: 'wrong', reasons: ['Not a calculator.'], confidence: 0.8 };
  s.mayDisagree = { flag: true, reasons: ['The AI says wrong, which is worth confirming'] };
  return buildReport({
    mode: 'live',
    datasetVersion: '1.1.0',
    results: [a, b, s, none],
    platform: 'test',
    promptVersion: 'p',
    datasetHash: 'abc123',
    cloudCalls: 0,
    createdAt: new Date('2026-11-25T00:00:00Z'),
  });
}

function open() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/review/' });
  const w = dom.window as unknown as Window & typeof globalThis & { __kalamReview: { load(t: string): void } };
  // jsdom has no object URLs; capture what would be downloaded.
  const downloads: string[] = [];
  const RealBlob = w.Blob;
  (w as unknown as { Blob: unknown }).Blob = class extends RealBlob {
    constructor(parts: BlobPart[], o?: BlobPropertyBag) {
      super(parts, o);
      downloads.push(parts.map(String).join(''));
    }
  };
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  const key = (k: string) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const $ = (sel: string) => w.document.querySelector(sel) as HTMLElement;
  return { w, key, $, downloads };
}

describe('scoring page file', () => {
  it('is self-contained: no external address, no network call, no em dash', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/);
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+\bsrc=["'](?!blob:|data:)/i);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/[—–]/);
    expect(html).toMatch(/<html lang="en">/);
  });
});

describe('scoring page behaviour', () => {
  it('refuses a file that is not a report, with a plain message', () => {
    const { w, $ } = open();
    w.__kalamReview.load('{"hello":1}');
    expect($('#load-error').hidden).toBe(false);
    expect($('#load-error').textContent).toMatch(/not a Kalam evaluation report/);
    w.__kalamReview.load('not json');
    expect($('#load-error').textContent).toMatch(/not a JSON file/);
  });

  it('shows the case, scores by keyboard, advances, and reports progress', async () => {
    const report = await sampleReport();
    const { w, key, $ } = open();
    w.__kalamReview.load(JSON.stringify(report));
    expect($('#app').hidden).toBe(false);
    expect($('#prog-text').textContent).toBe('0 of 3 built apps scored');
    const first = $('#case-heading').textContent!;
    expect(first).toContain(report.cases[0]!.id);
    expect($('#card').textContent).toContain('What was asked');
    expect($('#card').textContent).toContain('What Kalam built');
    expect($('#card').textContent).toContain('AI pre-score (advice, not a human score)');
    key('c');
    expect($('#prog-text').textContent).toBe('1 of 3 built apps scored');
    expect($('#case-heading').textContent).toContain(report.cases[1]!.id);
    key('a'); // same as the AI: partly
    expect($('#prog-text').textContent).toBe('2 of 3 built apps scored');
    key('3');
    expect($('#prog-text').textContent).toBe('3 of 3 built apps scored');
    expect($('#tally').textContent).toMatch(/Correct 1.*Partly 1.*Wrong 1/);
    expect($('#status').textContent).toMatch(/Scored .* as Wrong\. 3 of 3 done\./);
  });

  it('lets a person clear a score and keeps notes', async () => {
    const report = await sampleReport();
    const { w, key, $ } = open();
    w.__kalamReview.load(JSON.stringify(report));
    key('p');
    key('k'); // back to the first case
    expect(($('#score-partly') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    const note = $('#note') as HTMLTextAreaElement;
    note.value = 'Missing the date field';
    note.dispatchEvent(new w.Event('input', { bubbles: true }));
    key('x');
    expect($('#prog-text').textContent).toBe('0 of 3 built apps scored');
    expect(($('#note') as HTMLTextAreaElement).value).toBe('Missing the date field');
  });

  it('filters to the cases where the AI may be wrong, and lists the case that built nothing apart', async () => {
    const report = await sampleReport();
    const { w, $ } = open();
    w.__kalamReview.load(JSON.stringify(report));
    expect($('#case-list').querySelectorAll('button').length).toBe(3);
    const box = $('#disagree') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    const ids = [...$('#case-list').querySelectorAll('button')].map((b) => b.getAttribute('data-id'));
    expect(ids).toEqual([report.cases[1]!.id, report.cases[2]!.id]);
    box.checked = false;
    box.dispatchEvent(new w.Event('change', { bubbles: true }));
    const show = $('#show') as HTMLSelectElement;
    show.value = 'nothing';
    show.dispatchEvent(new w.Event('change', { bubbles: true }));
    expect($('#card').textContent).toContain('Nothing was built');
    expect($('#card').querySelector('#score-correct')).toBeNull();
  });

  it('can hide the AI score until the person has scored', async () => {
    const report = await sampleReport();
    const { w, key, $ } = open();
    w.__kalamReview.load(JSON.stringify(report));
    const hide = $('#hideai') as HTMLInputElement;
    hide.checked = true;
    hide.dispatchEvent(new w.Event('change', { bubbles: true }));
    expect($('#card').textContent).toContain('Hidden until you score this case');
    expect($('#card').textContent).not.toContain('Does the job.');
    key('k');
    key('c');
    key('k');
    expect($('#card').textContent).toContain('Does the job.');
  });

  it('exports a scores file that names the run, with only the scored cases', async () => {
    const report = await sampleReport();
    const { w, key, $, downloads } = open();
    w.__kalamReview.load(JSON.stringify(report));
    ($('#reviewer') as HTMLInputElement).value = 'Owner';
    $('#reviewer').dispatchEvent(new w.Event('input', { bubbles: true }));
    key('c');
    key('w');
    key('e');
    const file = JSON.parse(downloads.at(-1)!);
    expect(file.schema).toBe('kalam-human-scores/1');
    expect(file.evaluationId).toBe(report.evaluationId);
    expect(file.datasetHash).toBe('abc123');
    expect(file.reviewer).toBe('Owner');
    expect(file.scores).toEqual([
      { id: report.cases[0]!.id, score: 'correct' },
      { id: report.cases[1]!.id, score: 'wrong' },
    ]);
    expect($('#export-note').textContent).toMatch(/Exported 2 score\(s\).*1 built app\(s\) are not scored yet/);
  });

  it('draws a sketch from its layout and gives every control a name', async () => {
    const report = await sampleReport();
    const { w, $ } = open();
    w.__kalamReview.load(JSON.stringify(report));
    ($('#case-list').querySelectorAll('button')[2] as HTMLButtonElement).click();
    expect($('#card').querySelector('.sk-page')).not.toBeNull();
    expect($('#card').textContent).toContain('Calculator');
    const unnamed = [...w.document.querySelectorAll('button, input, select, textarea')].filter((el) => {
      const e = el as HTMLInputElement;
      return !(
        e.textContent?.trim() ||
        e.getAttribute('aria-label') ||
        e.labels?.length ||
        e.getAttribute('aria-labelledby')
      );
    });
    expect(unnamed.map((e) => e.outerHTML)).toEqual([]);
  });

  it('keeps scores when the page is reopened (same browser)', async () => {
    const report = await sampleReport();
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/review/' });
    const w = dom.window as unknown as Window & typeof globalThis & { __kalamReview: { load(t: string): void } };
    w.__kalamReview.load(JSON.stringify(report));
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    const saved = w.localStorage.getItem(`kalam-review:${report.evaluationId}`)!;
    const again = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/review/' });
    again.window.localStorage.setItem(`kalam-review:${report.evaluationId}`, saved);
    (again.window as unknown as { __kalamReview: { load(t: string): void } }).__kalamReview.load(
      JSON.stringify(report),
    );
    expect(again.window.document.getElementById('prog-text')!.textContent).toBe('1 of 3 built apps scored');
  });
});
