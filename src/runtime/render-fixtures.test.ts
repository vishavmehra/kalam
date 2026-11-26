// @vitest-environment jsdom
/**
 * Every valid fixture app drawn by <KalamRuntime> (docs/05 §19, docs/09 §23.4, docs/13 §5.4): each screen of each app opens, each
 * visible component has the control a person using a screen reader or a keyboard needs, a form screen really saves an entry
 * into the local store through its own inputs and button, and Simple mode folds secondary parts behind "Show more". The
 * runtime, the engine and the memory stores are real; icons, the SVG layer, the chart renderer and the device edges are stubbed.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFixtures } from '../../tests/fixtures/specs/load';
import type { AccessModes, RuntimeServices } from '@/core/contracts';
import { validateSpec } from '@/core/spec';
import type { KalamComponent, KalamScreen, KalamSpec } from '@/core/spec/schema';
import { createMemoryStores } from './engine/memory-store';
import { KalamRuntime } from './KalamRuntime';

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
  return { Stamp: ({ label }: { label: string }) => createElement('span', { 'data-stamp': true }, label) };
});
vi.mock('@/design/theme', () => ({
  useKalamTheme: () => ({ colors: { background: '#F4F5F0', surfaceAlt: '#EAEBE4', borderStrong: '#7E8497' }, elevation: { 2: {} } }),
  useReducedMotion: () => true,
}));
vi.mock('@/features/reports/ChartBlock', async () => {
  const { createElement } = await import('react');
  return { ChartBlock: ({ c }: { c: { label: string } }) => createElement('div', { 'data-chart': true }, `chart:${c.label}`) };
});
vi.mock('@/features/queue/QueueAiOffer', () => ({ QueueAiOffer: () => null }));
vi.mock('@/features/queue/queue-service', () => ({ getOperationQueue: () => ({ dismiss: async () => undefined }) }));
vi.mock('@/features/queue/snapshot', () => ({ readAiStepResult: () => undefined }));
vi.mock('@/features/queue/use-queue', () => ({ useQueuedAiResults: () => [] }));
vi.mock('@/features/reminders/runtime', () => ({ syncReminders: async () => ({ status: 'synced' }) }));
vi.mock('@/infrastructure/platform/lifecycle', () => ({ lifecycle: { register: () => () => undefined } }));
vi.mock('@/infrastructure/platform/notifications', () => ({
  getNotificationAdapter: () => ({ requestPermission: async () => ({ permission: 'granted' }), openSettings: undefined }),
}));
vi.mock('@/state/settings-store', () => ({
  useSettingsStore: { getState: () => ({ settings: { accessModes: {} }, update: async () => undefined }) },
}));
vi.mock('@/i18n/use-script-fonts', () => ({ useRuntimeFont: () => undefined }));
vi.mock('./voice', () => ({ stopSpeakingAloud: () => undefined, VoiceControl: () => null }));

class FakeResizeObserver {
  constructor(private cb: (entries: Array<{ target: Element }>) => void) {}
  observe(target: Element) {
    queueMicrotask(() => this.cb([{ target }]));
  }
  unobserve() {}
  disconnect() {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 390 });

afterEach(cleanup);

const OFF: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const SIMPLE: AccessModes = { ...OFF, simple: true };

const FIXTURES = [
  ...loadFixtures('valid').map((f) => ({ name: f.name, json: f.json })),
  ...loadFixtures('valid', 'v11').map((f) => ({ name: f.name, json: f.json })),
].map(({ name, json }) => {
  const result = validateSpec(json);
  if (!result.ok) throw new Error(`fixture ${name} is not valid: ${JSON.stringify(result.errors)}`);
  return { name, spec: result.spec as KalamSpec };
});

function open(spec: KalamSpec, over: Partial<React.ComponentProps<typeof KalamRuntime>> = {}, records = {}) {
  const stores = createMemoryStores(spec.id, { records });
  const svc = {
    ...stores, speak: vi.fn(), confirm: vi.fn(async () => true), online: () => true, pickImage: async () => undefined, runAIBlock: vi.fn(),
  } as unknown as RuntimeServices;
  const view = render(h(KalamRuntime, { spec, appId: spec.id, services: svc, accessModes: OFF, mode: 'live', ...over }));
  return { ...view, stores, svc };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameOf = (c: KalamComponent) => (c as { a11yLabel?: string }).a11yLabel ?? (c as { label?: string }).label ?? '';

/** The control a person using this component finds, by its role and accessible name. Throws when it is not there. */
function expectDrawn(c: KalamComponent, spec: KalamSpec): void {
  const label = (c as { label?: string }).label ?? '';
  switch (c.type) {
    case 'text': expect(screen.getAllByText(label).length, c.id).toBeGreaterThan(0); break;
    case 'heading': expect(screen.getAllByRole('heading', { name: label }).length, c.id).toBeGreaterThan(0); break;
    case 'number': case 'textInput': case 'date': case 'choice': case 'toggle':
      // A link is drawn as a picker button; every other input is labelled by the text above it.
      expect(document.getElementById(`lbl_${c.id}`) ?? screen.queryByRole('switch', { name: nameOf(c) }), c.id).toBeTruthy();
      break;
    case 'counter': expect(screen.getAllByRole('slider', { name: nameOf(c) }).length, c.id).toBeGreaterThan(0); break;
    case 'bigButton': expect(screen.getAllByRole('button', { name: nameOf(c) }).length, c.id).toBeGreaterThan(0); break;
    case 'list': if (c.label) expect(screen.getAllByRole('heading', { name: c.label }).length, c.id).toBeGreaterThan(0); break;
    case 'stat': expect(screen.getAllByLabelText(new RegExp(`^${esc(nameOf(c))}: `)).length, c.id).toBeGreaterThan(0); break;
    case 'photo': expect(screen.getAllByRole('button', { name: nameOf(c) }).length, c.id).toBeGreaterThan(0); break;
    case 'chart': expect(screen.getAllByText(`chart:${label}`).length, c.id).toBeGreaterThan(0); break;
    case 'timer': expect(screen.getAllByRole('timer').length, c.id).toBeGreaterThan(0); break;
    case 'reminder': expect(screen.getAllByRole('switch', { name: `Remind me: ${nameOf(c)}` }).length, c.id).toBeGreaterThan(0); break;
    case 'signature': expect(screen.getAllByLabelText(new RegExp(`^${esc(nameOf(c))}`)).length, c.id).toBeGreaterThan(0); break;
    default: throw new Error(`no render expectation for ${(c as { type: string }).type} in ${spec.id}`);
  }
}

describe('every valid fixture app draws every screen', () => {
  for (const { name, spec } of FIXTURES) {
    describe(name, () => {
      for (const screenDef of spec.screens) {
        it(`screen "${screenDef.id}" opens with its title and a control for each visible component`, async () => {
          open(spec, { startScreen: screenDef.id });
          expect(await screen.findAllByRole('heading', { name: screenDef.title })).toBeTruthy();
          // No part from a newer Kalam, and no recovery card.
          expect(screen.queryByText(/newer version of Kalam/i)).toBeNull();
          for (const c of screenDef.children) if (c.visible !== false) expectDrawn(c, spec);
        });
      }
    });
  }

  it('covers every component type that the fixtures hold, so the check is not empty', () => {
    const types = new Set(FIXTURES.flatMap((f) => f.spec.screens.flatMap((s) => s.children.map((c) => c.type))));
    // The per-type render tests (registry.test.ts) cover all of them; here the fixtures must still hold a wide spread.
    for (const wanted of ['heading', 'number', 'textInput', 'date', 'choice', 'counter', 'bigButton', 'list', 'stat', 'timer', 'reminder', 'signature', 'chart']) {
      expect(types.has(wanted as never), wanted).toBe(true);
    }
  });
});

/** Fills one screen's inputs through the DOM the way a person would, then presses the button that saves. */
async function fillAndSave(spec: KalamSpec, screenDef: KalamScreen, button: KalamComponent & { type: 'bigButton' }): Promise<void> {
  for (const c of screenDef.children) {
    if (c.visible === false) continue;
    if (c.type === 'number') fireEvent.change(screen.getByLabelText(nameOf(c)), { target: { value: '12' } });
    if (c.type === 'textInput') fireEvent.change(screen.getByLabelText(nameOf(c)), { target: { value: 'Sample' } });
    if (c.type === 'date') {
      // A date that starts empty has a "today" button; one that starts on today needs nothing.
      const today = screen.queryByRole('button', { name: new RegExp(`^Set ${esc((c as { label: string }).label)} to today`) });
      if (today) {
        await act(async () => {
          fireEvent.click(today);
        });
      }
    }
    if (c.type === 'choice') {
      const group = document.getElementById(`lbl_${c.id}`)?.parentElement as HTMLElement;
      fireEvent.click(within(group).getAllByRole('radio')[0]);
    }
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: nameOf(button) }));
  });
}

describe('a form screen of a fixture app saves a real entry into the local store', () => {
  const cases = FIXTURES.flatMap(({ name, spec }) =>
    spec.screens.flatMap((screenDef) => {
      // A screen with a link picker needs entries to link to; those are covered by the linked-app tests.
      const hasLink = screenDef.children.some((c) => c.type === 'textInput' && spec.collections[screenDef.form ?? '']?.fields[c.field]?.type === 'text'
        && (spec.collections[screenDef.form ?? ''].fields[c.field] as { ref?: unknown }).ref);
      const buttons = screenDef.children.flatMap((c) => {
        const a = c.type === 'bigButton' ? spec.actions[c.action] : undefined;
        return c.type === 'bigButton' && a?.type === 'insert' && a.collection === screenDef.form ? [c] : [];
      });
      return screenDef.form && buttons.length && !hasLink && !screenDef.children.some((c) => c.type === 'signature')
        ? [{ name, spec, screenDef, button: buttons[0] }]
        : [];
    }),
  );

  it('has screens to try', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  for (const { name, spec, screenDef, button } of cases) {
    it(`${name}, screen "${screenDef.id}": fill the inputs, press "${button.label}", find one new entry`, async () => {
      const { stores } = open(spec, { startScreen: screenDef.id });
      await screen.findAllByRole('heading', { name: screenDef.title });
      await fillAndSave(spec, screenDef, button);
      const collection = screenDef.form as string;
      await waitFor(async () => expect(await stores.records.list(spec.id, collection)).toHaveLength(1));
    });
  }
});

describe('Simple mode in a drawn app', () => {
  const expense = FIXTURES.find((f) => f.name === 'expense-tracker')!.spec;
  const home = expense.screens.find((s) => s.children.some((c) => c.type === 'stat'))!;
  const stat = home.children.find((c) => c.type === 'stat')!;
  const folded = (importance: 'secondary' | 'essential' = 'secondary'): KalamSpec => ({
    ...expense,
    screens: expense.screens.map((s) => (s.id === home.id
      ? { ...s, children: s.children.map((c) => (c.id === stat.id ? { ...c, importance, secondary: undefined } : c)) }
      : s)),
  });
  const statLabel = () => new RegExp(`^${esc(nameOf(stat))}: `);

  it('folds a secondary part away, says how many, and brings it back with "Show more", then folds it again', async () => {
    open(folded(), { accessModes: SIMPLE, startScreen: home.id });
    await screen.findAllByRole('heading', { name: home.title });
    expect(screen.queryByLabelText(statLabel())).toBeNull();
    // The fixture's own secondary button is folded too, so there is more than one part behind the button.
    const more = screen.getByRole('button', { name: /^Show more \(\d+\)$/ });
    expect(more.getAttribute('aria-expanded')).not.toBe('true');
    await act(async () => {
      fireEvent.click(more);
    });
    expect(screen.getByLabelText(statLabel())).toBeTruthy();
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      fireEvent.click(less);
    });
    expect(screen.queryByLabelText(statLabel())).toBeNull();
    expect(screen.getByRole('button', { name: /^Show more \(\d+\)$/ })).toBeTruthy();
  });

  it('draws everything and no button when Simple mode is off', async () => {
    open(folded(), { accessModes: OFF, startScreen: home.id });
    await screen.findAllByRole('heading', { name: home.title });
    expect(screen.getByLabelText(statLabel())).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Show more/ })).toBeNull();
  });

  it('never folds an essential part, and shows no button when nothing is folded', async () => {
    const spec = folded('essential');
    // The fixture's helper button is still secondary, so strip that too and nothing is left to fold.
    const clean: KalamSpec = {
      ...spec,
      screens: spec.screens.map((s) => ({ ...s, children: s.children.map((c) => ({ ...c, secondary: typeof c.secondary === 'boolean' ? undefined : c.secondary })) })),
    } as KalamSpec;
    open(clean, { accessModes: SIMPLE, startScreen: home.id });
    await screen.findAllByRole('heading', { name: home.title });
    expect(screen.getByLabelText(statLabel())).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Show more/ })).toBeNull();
  });

  it('forgets the opened screens when Simple mode is turned off and on again', async () => {
    const spec = folded();
    const view = open(spec, { accessModes: SIMPLE, startScreen: home.id });
    await screen.findAllByRole('heading', { name: home.title });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Show more/ }));
    });
    expect(screen.getByLabelText(statLabel())).toBeTruthy();
    const again = (modes: AccessModes) =>
      view.rerender(h(KalamRuntime, { spec, appId: spec.id, services: view.svc, accessModes: modes, mode: 'live' }));
    again(OFF);
    again(SIMPLE);
    await waitFor(() => expect(screen.queryByLabelText(statLabel())).toBeNull());
  });
});
