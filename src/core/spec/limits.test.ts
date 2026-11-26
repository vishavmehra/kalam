/**
 * At-limit tests for EVERY entry of the limits policy (docs/05 §20.1, docs/13 §5.1): a spec exactly at the limit is
 * accepted, one past it is refused at the right place, and the 100 KB cap is checked to the byte. `CASES` is typed over
 * the keys of `LIMITS`, so a new limit without a test here does not compile.
 */
import { describe, expect, it } from 'vitest';
import { evaluateFormula, validateFormula } from '@/core/formula';
import { applyPatchOps } from '@/core/edit/apply';
import { limitsPolicy } from '@/core/limits/policy';
import { LIMITS } from './schema';
import { validateSpec } from './validate';

type Json = Record<string, any>;
const L = LIMITS;

/** A small valid app: one collection with a name, a screen that adds to it and lists it. */
const base = (): Json => ({
  id: 'app_limits', schemaVersion: '1.1.0', version: 1, name: 'Limits', lang: 'en',
  theme: { primary: '#2B5FA8', radius: 14, fontScale: 1 },
  collections: { items: { fields: { name: { type: 'text', label: 'Name' } } } },
  screens: [{
    id: 'home', title: 'Home', form: 'items',
    children: [
      { id: 'name_input', type: 'textInput', label: 'Name', field: 'name' },
      { id: 'save', type: 'bigButton', label: 'Save', action: 'add' },
      { id: 'items_list', type: 'list', source: 'items', primary: 'name' },
    ],
  }],
  initialScreen: 'home',
  actions: { add: { type: 'insert', collection: 'items' } },
  aiBlocks: {}, intents: {}, meta: { createdAt: 1 },
});

const text = (id: string, label = 'Note'): Json => ({ id, type: 'text', label });
/** `n` more text components on the home screen, so it holds `total` in all. */
const withComponents = (s: Json, total: number): Json => {
  while (s.screens[0].children.length < total) s.screens[0].children.push(text(`note_${s.screens[0].children.length}`));
  return s;
};
const classify = (): Json => ({
  kind: 'classify', prompt: 'Sort it.', verified: 'unverified', labels: ['a', 'b'], inputField: 'name', outputField: 'name',
});

function accepted(spec: unknown): void {
  const r = validateSpec(spec);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  expect(r.ok).toBe(true);
}
/** Refused, with an error at `path` (and `code` when given). */
function refusedAt(spec: unknown, path: string, code?: string): void {
  const r = validateSpec(spec);
  expect(r.ok).toBe(false);
  const found = r.errors.filter((e) => e.path === path);
  expect(found.length, `no error at ${path}: ${JSON.stringify(r.errors.map((e) => [e.code, e.path]))}`).toBeGreaterThan(0);
  if (code) expect(found.map((e) => e.code)).toContain(code);
}

it('starts from a spec that is valid', () => accepted(base()));

const CASES: Record<keyof typeof LIMITS, () => void> = {
  screens: () => {
    const screens = (n: number) => {
      const s = base();
      for (let i = 1; i < n; i++) s.screens.push({ id: `s_${i}`, title: `Screen ${i}`, children: [text(`t_${i}`)] });
      return s;
    };
    accepted(screens(L.screens));
    refusedAt(screens(L.screens + 1), 'screens', 'RESOURCE_LIMIT');
  },
  componentsPerScreen: () => {
    accepted(withComponents(base(), L.componentsPerScreen));
    refusedAt(withComponents(base(), L.componentsPerScreen + 1), 'screens[0].children', 'RESOURCE_LIMIT');
  },
  collections: () => {
    const collections = (n: number) => {
      const s = base();
      for (let i = 1; i < n; i++) s.collections[`c_${i}`] = { fields: { a: { type: 'text', label: 'A' } } };
      return s;
    };
    accepted(collections(L.collections));
    refusedAt(collections(L.collections + 1), 'collections', 'RESOURCE_LIMIT');
  },
  fieldsPerCollection: () => {
    const fields = (n: number) => {
      const s = base();
      for (let i = 1; i < n; i++) s.collections.items.fields[`f_${i}`] = { type: 'text', label: `F ${i}` };
      return s;
    };
    accepted(fields(L.fieldsPerCollection));
    refusedAt(fields(L.fieldsPerCollection + 1), 'collections.items.fields', 'RESOURCE_LIMIT');
  },
  aiBlocks: () => {
    const blocks = (n: number) => {
      const s = base();
      for (let i = 0; i < n; i++) s.aiBlocks[`block_${i}`] = classify();
      return s;
    };
    accepted(blocks(L.aiBlocks));
    refusedAt(blocks(L.aiBlocks + 1), 'aiBlocks', 'RESOURCE_LIMIT');
  },
  actions: () => {
    const actions = (n: number) => {
      const s = base();
      for (let i = 1; i < n; i++) s.actions[`say_${i}`] = { type: 'feedback', message: 'Done' };
      return s;
    };
    accepted(actions(L.actions));
    refusedAt(actions(L.actions + 1), 'actions', 'RESOURCE_LIMIT');
  },
  intentPhrasesPerAction: () => {
    const phrases = (n: number) => ({ ...base(), intents: { add: Array.from({ length: n }, (_, i) => `add item ${i}`) } });
    accepted(phrases(L.intentPhrasesPerAction));
    refusedAt(phrases(L.intentPhrasesPerAction + 1), 'intents.add');
  },
  enumOptions: () => {
    const options = (n: number) => {
      const s = base();
      s.collections.items.fields.kind = { type: 'enum', label: 'Kind', options: Array.from({ length: n }, (_, i) => `option ${i}`) };
      return s;
    };
    accepted(options(L.enumOptions));
    refusedAt(options(L.enumOptions + 1), 'collections.items.fields.kind.options');
  },
  nameLength: () => {
    const named = (n: number) => ({ ...base(), name: 'n'.repeat(n) });
    accepted(named(L.nameLength));
    refusedAt(named(L.nameLength + 1), 'name');
    const titled = (n: number) => {
      const s = base();
      s.screens[0].title = 't'.repeat(n);
      return s;
    };
    accepted(titled(L.nameLength));
    refusedAt(titled(L.nameLength + 1), 'screens[0].title');
  },
  labelLength: () => {
    const labelled = (n: number) => {
      const s = base();
      s.screens[0].children.push(text('long_note', 'l'.repeat(n)));
      return s;
    };
    accepted(labelled(L.labelLength));
    refusedAt(labelled(L.labelLength + 1), 'screens[0].children[3].label');
  },
  descriptionLength: () => {
    const described = (n: number) => ({ ...base(), description: 'd'.repeat(n) });
    accepted(described(L.descriptionLength));
    refusedAt(described(L.descriptionLength + 1), 'description');
  },
  promptLength: () => {
    const prompted = (n: number) => {
      const s = base();
      s.aiBlocks.sorter = { ...classify(), prompt: 'p'.repeat(n) };
      return s;
    };
    accepted(prompted(L.promptLength));
    refusedAt(prompted(L.promptLength + 1), 'aiBlocks.sorter.prompt');
  },
  formulaLength: () => {
    // A single digit padded with spaces: the length is the only thing that changes.
    const stat = (n: number) => {
      const s = base();
      s.screens[0].children.push({ id: 'total', type: 'stat', label: 'Total', expr: '1'.padEnd(n, ' ') });
      return s;
    };
    accepted(stat(L.formulaLength));
    refusedAt(stat(L.formulaLength + 1), 'screens[0].children[3].expr');
  },
  formulaSteps: () => {
    // `sum(big.v)` costs two steps for each entry plus a few; the limit is reached just under half of the cap.
    const run = (n: number) =>
      evaluateFormula('sum(big.v)', {
        collections: { big: Array.from({ length: n }, (_, i) => ({ v: i })) }, form: {}, state: {}, now: new Date(2026, 0, 1),
      } as never);
    expect(run(Math.floor(L.formulaSteps / 2) - 5).ok).toBe(true);
    const over = run(Math.floor(L.formulaSteps / 2) + 1);
    expect(over.ok).toBe(false);
    expect(JSON.stringify(over)).toMatch(/too complex/);
  },
  classifyLabels: () => {
    const labelled = (n: number) => {
      const s = base();
      s.aiBlocks.sorter = { ...classify(), labels: Array.from({ length: n }, (_, i) => `label ${i}`) };
      return s;
    };
    accepted(labelled(L.classifyLabels));
    refusedAt(labelled(L.classifyLabels + 1), 'aiBlocks.sorter.labels');
  },
  tags: () => {
    const tagged = (n: number) => ({ ...base(), meta: { createdAt: 1, tags: Array.from({ length: n }, (_, i) => `tag${i}`) } });
    accepted(tagged(L.tags));
    refusedAt(tagged(L.tags + 1), 'meta.tags');
  },
  layoutNodesPerScreen: () => {
    const groups = (n: number) => {
      const s = withComponents(base(), n);
      s.screens[0].layout = s.screens[0].children.slice(0, n).map((c: Json) => ({ type: 'row', children: [c.id] }));
      return s;
    };
    accepted(groups(L.layoutNodesPerScreen));
    refusedAt(groups(L.layoutNodesPerScreen + 1), 'screens[0].layout');
  },
  layoutDepth: () => {
    const nested = (depth: number) => {
      const s = base();
      let node: Json = { type: 'row', children: ['name_input'] };
      for (let i = 1; i < depth; i++) node = { type: 'row', children: [node] };
      s.screens[0].layout = [node];
      return s;
    };
    accepted(nested(L.layoutDepth));
    refusedAt(nested(L.layoutDepth + 1), 'screens[0].layout', 'INVALID_LAYOUT');
  },
  layoutChildren: () => {
    const group = (n: number) => {
      const s = withComponents(base(), n);
      s.screens[0].layout = [{ type: 'row', children: s.screens[0].children.slice(0, n).map((c: Json) => c.id) }];
      return s;
    };
    accepted(group(L.layoutChildren));
    refusedAt(group(L.layoutChildren + 1), 'screens[0].layout[0].children');
  },
  reminders: () => {
    const reminders = (n: number) => {
      const s = base();
      s.collections.tasks = { fields: { title: { type: 'text', label: 'Title' }, due: { type: 'date', label: 'Due' } } };
      s.permissions = [{ kind: 'notifications', reason: 'To remind you about tasks' }];
      for (let i = 0; i < n; i++) {
        s.screens[0].children.push({ id: `remind_${i}`, type: 'reminder', label: `Reminder ${i}`, source: 'tasks', dateField: 'due' });
      }
      return s;
    };
    accepted(reminders(L.reminders));
    refusedAt(reminders(L.reminders + 1), 'screens', 'RESOURCE_LIMIT');
  },
  terminology: () => {
    const terms = (n: number) => ({
      ...base(),
      localization: { terminology: Array.from({ length: n }, (_, i) => ({ term: `term ${i}`, keep: true })) },
    });
    accepted(terms(L.terminology));
    refusedAt(terms(L.terminology + 1), 'localization.terminology');
  },
  timerSeconds: () => {
    const timer = (seconds: number) => {
      const s = base();
      s.screens[0].children.push({ id: 'rest', type: 'timer', label: 'Rest', mode: 'countdown', durationSec: seconds });
      return s;
    };
    accepted(timer(L.timerSeconds));
    refusedAt(timer(L.timerSeconds + 1), 'screens[0].children[3].durationSec');
  },
  signatureLength: () => {
    const signed = (maxLength?: number) => {
      const s = base();
      s.collections.items.fields.sig = { type: 'text', label: 'Signature', ...(maxLength ? { maxLength } : {}) };
      s.screens[0].children.push({ id: 'sign_here', type: 'signature', label: 'Sign here', field: 'sig' });
      return s;
    };
    accepted(signed());
    accepted(signed(L.signatureLength));
    refusedAt(signed(L.signatureLength - 1), 'screens[0].children[3].field', 'FIELD_TYPE_MISMATCH');
  },
  specBytes: () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const json = JSON.stringify(base());
    // Whitespace after the JSON is still JSON: pad to exactly the cap, then one byte more.
    const padded = (size: number) => json + ' '.repeat(size - bytes(json));
    expect(bytes(padded(L.specBytes))).toBe(L.specBytes);
    accepted(padded(L.specBytes));
    refusedAt(padded(L.specBytes + 1), '', 'SPEC_TOO_LARGE');
    // Bytes, not characters: a text under the cap in characters but over it in bytes is too large.
    const hindi = json + ' ' + 'ह'.repeat(Math.ceil((L.specBytes - bytes(json)) / 3) + 1);
    expect(hindi.length).toBeLessThan(L.specBytes);
    expect(bytes(hindi)).toBeGreaterThan(L.specBytes);
    refusedAt(hindi, '', 'SPEC_TOO_LARGE');
    // An object is measured as its JSON text, so it gets the same cap.
    refusedAt({ ...base(), padding: 'a'.repeat(L.specBytes) }, '', 'SPEC_TOO_LARGE');
  },
  nestingDepth: () => {
    const deep = (levels: number) => {
      let inner: Json = {};
      for (let i = 1; i < levels; i++) inner = { next: inner };
      return { ...base(), extra: inner };
    };
    const tooDeep = (s: unknown) => validateSpec(s).errors.some((e) => e.code === 'SPEC_TOO_DEEP');
    // The unknown `extra` property is itself refused; what is checked here is only the depth scan.
    expect(tooDeep(deep(L.nestingDepth - 1))).toBe(false);
    expect(tooDeep(deep(L.nestingDepth + 1))).toBe(true);
  },
  formulaDepth: () => {
    const scope = { collections: {}, formFields: [], stateKeys: [] };
    const nested = (calls: number) => 'abs('.repeat(calls) + '1' + ')'.repeat(calls);
    // Deepest call chain the parser accepts, found by trying; it must sit right at the policy number.
    let deepest = 0;
    while (validateFormula(nested(deepest + 1), scope).length === 0 && deepest < 200) deepest++;
    expect(deepest).toBeGreaterThan(0);
    expect(deepest).toBeLessThanOrEqual(L.formulaDepth);
    expect(deepest).toBeGreaterThanOrEqual(L.formulaDepth - 1);
    expect(validateFormula(nested(deepest + 1), scope).join(' ')).toMatch(/nested too deeply/);
  },
  editOperations: () => {
    const spec = validateSpec(base()).spec!;
    const ops = (n: number) => Array.from({ length: n }, (_, i) => ({ op: 'setAppName' as const, value: `Name ${i}` }));
    expect(applyPatchOps(spec, ops(L.editOperations)).ok).toBe(true);
    const over = applyPatchOps(spec, ops(L.editOperations + 1));
    expect(over.ok).toBe(false);
    expect(over.errors.map((e) => e.code)).toContain('PATCH_TOO_LARGE');
  },
};

describe('every limit in the policy is enforced exactly at its number', () => {
  it('has one case for each limit, and none for a limit that is gone', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(LIMITS).sort());
  });
  for (const key of Object.keys(CASES) as Array<keyof typeof LIMITS>) {
    it(`${key} = ${LIMITS[key]}: accepted at the limit, refused one past it`, CASES[key]);
  }
  it('reads the numbers from the versioned policy, not from copies', () => {
    expect(LIMITS).toBe(limitsPolicy.spec);
  });
});
