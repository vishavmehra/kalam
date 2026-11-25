/** Structural checks for the golden files, so a malformed case fails loudly before any run. Pure. */
import { expectedExtraction } from './sketch-builder';
import type { GoldenExpected, GoldenModalityCase, GoldenSketchCase, GoldenTextCase } from './types';

const ID = /^[a-z][a-z0-9-]{2,60}$/;
const STAMPS = new Set(['bigButton', 'list', 'textInput', 'heading', 'stat', 'photo', 'toggle']);

function checkExpected(id: string, e: GoldenExpected, problems: string[]): void {
  if (!['simple', 'medium', 'complex'].includes(e.complexity)) problems.push(`${id}: bad complexity "${e.complexity}"`);
  if (e.route !== 'template' && e.route !== 'cloud') problems.push(`${id}: bad route "${String(e.route)}"`);
  if (e.route === 'template' && !e.template) problems.push(`${id}: a template route needs a template id`);
  if (e.route === 'cloud' && e.template) problems.push(`${id}: a cloud route must not name a template`);
  if (e.route === 'template' && e.complexity !== 'simple')
    problems.push(`${id}: only simple requests take the template route`);
  if (!Number.isInteger(e.minScreens) || e.minScreens < 0) problems.push(`${id}: minScreens must be a whole number`);
  if (!Number.isInteger(e.minCollections) || e.minCollections < 0)
    problems.push(`${id}: minCollections must be a whole number`);
  for (const f of e.requiredFields) {
    if (!Array.isArray(f.anyOf) || f.anyOf.length === 0)
      problems.push(`${id}: a required field needs at least one keyword`);
  }
}

export function validateGolden(input: {
  text: readonly GoldenTextCase[];
  sketches: readonly GoldenSketchCase[];
  modalities?: readonly GoldenModalityCase[];
  /** Ids of the registered templates, to catch typos. Optional. */
  templateIds?: readonly string[];
}): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const unique = (id: string) => {
    if (!ID.test(id)) problems.push(`${id}: ids are lowercase letters, digits and dashes`);
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);
  };
  const template = (id: string, e: GoldenExpected) => {
    if (e.template && input.templateIds && !input.templateIds.includes(e.template))
      problems.push(`${id}: unknown template "${e.template}"`);
  };

  for (const c of input.text) {
    unique(c.id);
    if (!c.text.trim()) problems.push(`${c.id}: empty request`);
    if (!['en', 'hinglish', 'hi'].includes(c.language)) problems.push(`${c.id}: bad language "${c.language}"`);
    checkExpected(c.id, c.expected, problems);
    template(c.id, c.expected);
  }

  for (const c of input.sketches) {
    unique(c.id);
    if (c.pages.length === 0) problems.push(`${c.id}: a sketch needs at least one page`);
    if (c.pages.length > 8) problems.push(`${c.id}: more than 8 pages`);
    checkExpected(c.id, c.expected, problems);
    if (c.expected.route !== 'cloud') problems.push(`${c.id}: sketches need cloud vision, so route must be "cloud"`);
    if (c.expected.taskType !== 'interpret_sketch') problems.push(`${c.id}: sketches use the interpret_sketch task`);
    const want = expectedExtraction(c);
    if (want.labels.length === 0) problems.push(`${c.id}: the sketch has no labels to recover`);
    for (const name of Object.keys(want.stamps)) {
      if (!STAMPS.has(name)) problems.push(`${c.id}: unknown stamp "${name}"`);
    }
    // Declared stamp counts must match the layout, so the extraction check cannot pass or fail by typo.
    const placed: Record<string, number> = {};
    for (const p of c.pages) {
      for (const item of p.items) {
        if ('stamp' in item) {
          if (!STAMPS.has(item.stamp)) problems.push(`${c.id}: unknown stamp "${item.stamp}" in layout`);
          placed[item.stamp] = (placed[item.stamp] ?? 0) + 1;
        }
      }
    }
    for (const [name, n] of Object.entries(c.expected.stamps ?? {})) {
      if ((placed[name] ?? 0) !== n)
        problems.push(`${c.id}: expects ${n} ${name} stamp(s) but the layout places ${placed[name] ?? 0}`);
    }
  }

  const sketchIds = new Set(input.sketches.map((s) => s.id));
  for (const c of input.modalities ?? []) {
    unique(c.id);
    checkExpected(c.id, c.expected, problems);
    template(c.id, c.expected);
    if (!['image', 'audio', 'video', 'mixed'].includes(c.modality))
      problems.push(`${c.id}: bad modality "${String(c.modality)}"`);
    const parts = [
      c.images ? 'image' : '',
      c.audioTranscript?.trim() || c.untranscribedAudio ? 'audio' : '',
      c.video ? 'video' : '',
      c.sketch ? 'drawing' : '',
      c.text?.trim() ? 'text' : '',
    ].filter(Boolean);
    if (parts.length === 0) problems.push(`${c.id}: the case has no input`);
    if (c.modality === 'mixed' ? parts.length < 2 : !parts.includes(c.modality)) {
      problems.push(
        `${c.id}: a ${c.modality} case must carry ${c.modality === 'mixed' ? 'at least two kinds of input' : `${c.modality} input`}`,
      );
    }
    if (c.sketch && !sketchIds.has(c.sketch)) problems.push(`${c.id}: unknown sketch "${c.sketch}"`);
    if ((c.images || c.video || c.untranscribedAudio) && !c.needsAssets)
      problems.push(`${c.id}: placeholder media must say which real asset it needs`);
  }
  return problems;
}
