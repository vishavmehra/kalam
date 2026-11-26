// @vitest-environment jsdom
/**
 * The component registry (docs/04 §6.4, §9.3, docs/13 §5.4): one renderer per component type, checked against the schema's own
 * list of types, an unknown type drawn as a note instead of anything that could run, and ONE render test per component type
 * with its accessibility attributes (role, accessible name, state), through the real renderers in react-native-web.
 * `EXPECT` is typed over every component type, so a new type without a test does not compile.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KalamRecord } from '@/core/contracts';
import { validateSpec } from '@/core/spec';
import { COMPONENT_TYPES, type ComponentOf, type KalamComponent, type KalamComponentType, type KalamSpec } from '@/core/spec/schema';
import { createRuntimeState, getForm, screenFieldDefs } from './engine';
import { resolveAppTheme } from './engine/theme';
import { appT } from './engine/words';
import { COMPONENT_RENDERERS, isKnownComponentType, renderComponent, type RenderEnv } from './registry';

vi.mock('react-native', () => vi.importActual('react-native-web'));
vi.mock('lucide-react-native', () => {
  const icon = () => null;
  return Object.fromEntries(
    ('ArrowLeft Bell BellOff Camera ChartColumn Check ChevronDown ChevronLeft ChevronRight CircleAlert Ellipsis Eraser FileDown Info Keyboard '
      + 'Languages LayoutGrid ListChecks MessageCircleQuestion Mic Minus Pause PenLine Pencil Play Plus RefreshCw Repeat RotateCcw Search Send '
      + 'Share2 Square Trash2 TriangleAlert Users VolumeX X').split(' ').map((n) => [n, icon]),
  );
});
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  return { default: ({ children }: { children?: ReactNode }) => createElement('svg', null, children), Path: () => createElement('path') };
});
vi.mock('./layout', () => ({ useComponentBounds: () => ({}) }));
vi.mock('@/design', async () => {
  const { createElement } = await import('react');
  return { Stamp: ({ label }: { label: string }) => createElement('span', null, label) };
});
vi.mock('@/design/theme', () => ({
  useKalamTheme: () => ({ colors: { background: '#F4F5F0', surfaceAlt: '#EAEBE4', borderStrong: '#7E8497' }, elevation: { 2: {} } }),
  useReducedMotion: () => true,
}));
vi.mock('@/i18n/use-script-fonts', () => ({ useRuntimeFont: () => undefined }));
vi.mock('@/features/reports/ChartBlock', async () => {
  const { createElement } = await import('react');
  return { ChartBlock: ({ c }: { c: { label: string } }) => createElement('div', { 'data-chart': true }, `chart:${c.label}`) };
});

afterEach(cleanup);

/** One component of every type on one screen of a small valid app (checked valid below). */
const SINK = {
  id: 'app_sink', schemaVersion: '1.1.0', version: 1, name: 'Sink', lang: 'en', theme: { primary: '#2B5FA8', radius: 14, fontScale: 1 },
  collections: {
    people: {
      fields: {
        name: { type: 'text', label: 'Name', required: true }, age: { type: 'number', label: 'Age' }, born: { type: 'date', label: 'Born' },
        vip: { type: 'boolean', label: 'VIP' }, kind: { type: 'enum', label: 'Kind', options: ['A', 'B'] }, sig: { type: 'text', label: 'Sig' },
      },
    },
  },
  screens: [{
    id: 'home', title: 'Home', form: 'people',
    children: [
      { id: 'intro', type: 'text', label: 'Welcome text', a11yLabel: 'Welcome note' },
      { id: 'title', type: 'heading', label: 'Big heading' },
      { id: 'age_in', type: 'number', label: 'Age', field: 'age' },
      { id: 'name_in', type: 'textInput', label: 'Name', field: 'name', a11yLabel: 'Full name' },
      { id: 'born_in', type: 'date', label: 'Born', field: 'born' },
      { id: 'kind_in', type: 'choice', label: 'Kind', field: 'kind' },
      { id: 'vip_in', type: 'toggle', label: 'VIP', field: 'vip' },
      { id: 'visits', type: 'counter', label: 'Visits', min: 0, max: 5 },
      { id: 'save', type: 'bigButton', label: 'Save person', action: 'add' },
      { id: 'people_list', type: 'list', label: 'People', source: 'people', primary: 'name', allowDelete: true, detailScreen: 'detail' },
      { id: 'total', type: 'stat', label: 'People count', expr: 'count(people)', format: 'integer' },
      { id: 'snap', type: 'photo', label: 'Take photo' },
      { id: 'by_kind', type: 'chart', label: 'By kind', chart: 'bar', source: 'people', metric: 'count', groupBy: 'kind' },
      { id: 'rest', type: 'timer', label: 'Rest', mode: 'countdown', durationSec: 60 },
      { id: 'remind', type: 'reminder', label: 'Birthday reminder', source: 'people', dateField: 'born' },
      { id: 'sign', type: 'signature', label: 'Sign here', field: 'sig' },
    ],
  }, { id: 'detail', title: 'Person', children: [{ id: 'person_title', type: 'heading', label: 'Person page' }] }],
  initialScreen: 'home', actions: { add: { type: 'insert', collection: 'people' } }, aiBlocks: {}, intents: {},
  permissions: [{ kind: 'notifications', reason: 'To remind you' }], meta: { createdAt: 1 },
};

const sink = validateSpec(SINK).spec as KalamSpec;
const MODES = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const theme = resolveAppTheme(sink.theme, MODES);
const NOW = new Date(2026, 10, 25);
const person: KalamRecord = { id: 'p1', appId: sink.id, collectionId: 'people', createdAt: 1, updatedAt: 1, values: { name: 'Asha Rao', kind: 'A' } };

/** What the runtime would hand a renderer for the sink's one screen, with every callback a spy. */
function env(over: Partial<RenderEnv> = {}) {
  const screenDef = sink.screens[0];
  const calls = {
    focus: vi.fn(), setField: vi.fn(), step: vi.fn(), press: vi.fn(), openRecord: vi.fn(), toggleRecord: vi.fn(), deleteRecord: vi.fn(),
    switchReminder: vi.fn(), finishTimer: vi.fn(), pickPhoto: vi.fn(),
  };
  const value: RenderEnv = {
    spec: sink, appId: sink.id, screen: screenDef, defs: screenFieldDefs(sink, screenDef),
    rawForm: getForm(sink, createRuntimeState(sink), screenDef, NOW), form: {}, errors: {},
    records: { people: [person] }, collections: { people: [person.values] }, kv: {}, selected: null, busy: false,
    photos: {}, aiStatus: {}, reminderStatus: {}, tr: appT('en'), ...calls, ...over,
  };
  return { value, calls };
}
const component = <K extends KalamComponentType>(type: K): ComponentOf<K> =>
  sink.screens[0].children.find((c) => c.type === type) as ComponentOf<K>;
const draw = (c: KalamComponent, over: Partial<RenderEnv> = {}) => {
  const e = env(over);
  const view = render(h('div', null, renderComponent(c, theme, e.value)));
  return { ...view, calls: e.calls };
};

describe('the registry', () => {
  it('has a renderer for every component type in the schema, and no other', () => {
    expect(Object.keys(COMPONENT_RENDERERS).sort()).toEqual([...COMPONENT_TYPES].sort());
  });

  it('is checked against a sink app that is valid and holds every type', () => {
    expect(validateSpec(SINK).errors).toEqual([]);
    expect(new Set(sink.screens[0].children.map((c) => c.type))).toEqual(new Set(COMPONENT_TYPES));
  });

  it('knows a type only by its own key, never by one the object inherits', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'teleport', '']) expect(isKnownComponentType(name)).toBe(false);
    for (const type of COMPONENT_TYPES) expect(isKnownComponentType(type)).toBe(true);
    expect(isKnownComponentType(undefined)).toBe(false);
    expect(isKnownComponentType(42)).toBe(false);
  });

  it('draws a quiet note for a type from a newer Kalam and nothing that runs', () => {
    draw({ id: 'future', type: 'hologram', label: 'Never drawn' } as unknown as KalamComponent);
    expect(screen.getByText(/hologram/)).toBeTruthy();
    expect(screen.queryByText('Never drawn')).toBeNull();
  });

  it('does not look a hostile type name up in the registry, and cuts a long one down', () => {
    draw({ id: 'future', type: '__proto__' } as unknown as KalamComponent);
    expect(screen.getByText(/__proto__/)).toBeTruthy();
    cleanup();
    draw({ id: 'future2', type: 'x'.repeat(200) } as unknown as KalamComponent);
    expect(screen.getByText(/x{40}/).textContent).not.toContain('x'.repeat(41));
  });

  it('left the component switch out of KalamRuntime', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'KalamRuntime.tsx'), 'utf8');
    expect(source).not.toMatch(/switch\s*\(\s*c\.type\s*\)/);
    expect(source).toMatch(/renderComponent\(/);
  });
});

/** One test per component type: what a person using a screen reader or a keyboard is given. */
const EXPECT: { readonly [K in KalamComponentType]: (c: ComponentOf<K>) => void } = {
  text: (c) => {
    draw(c);
    expect(screen.getByText('Welcome text')).toBeTruthy();
    expect(screen.getByLabelText('Welcome note')).toBeTruthy();
  },
  heading: (c) => {
    draw(c);
    expect(screen.getByRole('heading', { name: 'Big heading' })).toBeTruthy();
  },
  number: (c) => {
    draw(c);
    const input = screen.getByLabelText('Age') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('aria-labelledby')).toBe('lbl_age_in');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  },
  textInput: (c) => {
    const { calls } = draw(c);
    const input = screen.getByLabelText('Full name') as HTMLInputElement;
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(input, { target: { value: 'Bela' } });
    expect(calls.setField).toHaveBeenCalledWith('name', 'Bela');
  },
  date: (c) => {
    draw(c);
    expect(screen.getByLabelText('Born, year-month-day')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set Born to today' })).toBeTruthy();
  },
  choice: (c) => {
    const { calls } = draw(c);
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-labelledby')).toBe('lbl_kind_in');
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['A', 'B']);
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(calls.setField).toHaveBeenCalledWith('kind', 'B');
  },
  toggle: (c) => {
    const { calls } = draw(c);
    fireEvent.click(screen.getByRole('switch', { name: 'VIP' }));
    expect(calls.setField).toHaveBeenCalledWith('vip', true);
  },
  counter: (c) => {
    const { calls } = draw(c);
    expect(screen.getByRole('slider', { name: 'Visits' })).toBeTruthy();
    // At its minimum, "decrease" is disabled for assistive technology as well.
    expect(screen.getByRole('button', { name: 'Decrease Visits' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Increase Visits' }));
    expect(calls.step).toHaveBeenCalledWith(c, 'increment');
  },
  bigButton: (c) => {
    const { calls } = draw(c);
    fireEvent.click(screen.getByRole('button', { name: 'Save person' }));
    expect(calls.press).toHaveBeenCalledWith('add');
    // A tap on the button is also read aloud when Read-aloud is on.
    expect(calls.focus).toHaveBeenCalledWith(c);
  },
  list: (c) => {
    const { calls } = draw(c);
    expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Asha Rao' }));
    expect(calls.openRecord).toHaveBeenCalledWith(c, person);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Asha Rao' }));
    expect(calls.deleteRecord).toHaveBeenCalledWith(c, person, 'Asha Rao');
  },
  stat: (c) => {
    draw(c, { collections: { people: [person.values] } });
    // One accessible sentence: the name and the value together.
    expect(screen.getByLabelText('People count: 1')).toBeTruthy();
  },
  photo: (c) => {
    const { calls } = draw(c);
    const button = screen.getByRole('button', { name: 'Take photo' });
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(button);
    expect(calls.pickPhoto).toHaveBeenCalledWith(c);
  },
  chart: (c) => {
    draw(c);
    expect(screen.getByText('chart:By kind')).toBeTruthy();
  },
  timer: (c) => {
    draw(c);
    expect(screen.getByRole('timer', { name: 'Rest: 1 minute left' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start Rest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset Rest' }).getAttribute('aria-disabled')).toBe('true');
  },
  reminder: (c) => {
    const { calls } = draw(c);
    const sw = screen.getByRole('switch', { name: 'Remind me: Birthday reminder' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(calls.switchReminder).toHaveBeenCalledWith(c, true);
  },
  signature: (c) => {
    draw(c);
    expect(screen.getByRole('img', { name: 'Sign here. Not signed yet.' }).getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('button', { name: 'Type your name instead: Sign here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear signature: Sign here' }).getAttribute('aria-disabled')).toBe('true');
  },
};

describe('each component type renders with its accessibility attributes', () => {
  for (const type of COMPONENT_TYPES) {
    it(type, () => (EXPECT[type] as (c: KalamComponent) => void)(component(type)));
  }

  it('says what is wrong with an input in the input itself', () => {
    draw(component('textInput'), { errors: { name: 'Name is needed' } });
    const input = screen.getByLabelText('Full name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('lbl_name_in_err');
    expect(screen.getByText('Name is needed')).toBeTruthy();
  });

  it('keeps a busy button from being pressed twice', () => {
    const { calls } = draw(component('bigButton'), { busy: true });
    const button = screen.getByRole('button', { name: 'Save person' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(calls.press).not.toHaveBeenCalled();
  });
});
