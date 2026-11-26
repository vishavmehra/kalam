// @vitest-environment jsdom
/**
 * <KalamRuntime> drawing KalamSpec 1.1 apps (react-native-web in jsdom): the render cases for chart, timer, reminder and
 * signature, layout groups with per-component style, links shown by name, the delete question with its consequences, the
 * Access Modes an app suggests, the start screen a widget asks for, and the app's own words. Icons, the SVG layer, the chart
 * renderer (tested with the reports feature) and the device edges (queue, notifications, lifecycle, settings) are stubbed;
 * the runtime, the engine and the memory stores are real.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../tests/fixtures/specs/load';
import type { AccessModes, KalamRecord, RuntimeServices } from '@/core/contracts';
import { validateSpec } from '@/core/spec';
import type { KalamSpec } from '@/core/spec/schema';
import { createMemoryStores } from './engine/memory-store';
import { SUGGESTED_MODES_KEY } from './engine/v11';
import { ConfirmSheet } from './ui/overlays';
import { resolveAppTheme } from './engine/theme';
import { KalamRuntime } from './KalamRuntime';

const settings = vi.hoisted(() => ({ update: vi.fn(async () => undefined), accessModes: { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false } }));
const device = vi.hoisted(() => ({ requestPermission: vi.fn(async () => ({ permission: 'granted' })), sync: vi.fn(async (_appId?: string) => ({ status: 'synced' })) }));

vi.mock('react-native', () => vi.importActual('react-native-web'));
vi.mock('lucide-react-native', () => {
  const icon = () => null;
  return {
    ChevronLeft: icon, Repeat: icon, Square: icon, Pause: icon, Play: icon, RotateCcw: icon, Bell: icon, BellOff: icon, Eraser: icon,
    Keyboard: icon, PenLine: icon, Check: icon, ChevronDown: icon, ChevronRight: icon, Search: icon, Trash2: icon, Camera: icon,
    CircleAlert: icon, Info: icon, TriangleAlert: icon,
  };
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
vi.mock('@/features/reminders/runtime', () => ({ syncReminders: (id: string) => device.sync(id) }));
vi.mock('@/infrastructure/platform/lifecycle', () => ({ lifecycle: { register: () => () => undefined } }));
vi.mock('@/infrastructure/platform/notifications', () => ({
  getNotificationAdapter: () => ({ requestPermission: device.requestPermission, openSettings: undefined }),
}));
vi.mock('@/state/settings-store', () => ({
  useSettingsStore: { getState: () => ({ settings: { accessModes: settings.accessModes }, update: settings.update }) },
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

const MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const app = (name: string) => validateSpec(loadFixture('valid', name, 'v11')).spec as KalamSpec;
const tailor = app('tailor-orders-linked');
const workout = app('workout-timer');

const row = (appId: string, collectionId: string, values: KalamRecord['values'], id: string): KalamRecord =>
  ({ id, appId, collectionId, createdAt: 1, updatedAt: 1, values });
const seed = (appId: string) => ({
  customers: [row(appId, 'customers', { name: 'Asha Rao' }, 'c_asha')],
  orders: [row(appId, 'orders', { customer: 'c_asha', garment: 'Kurta', delivery: '2026-12-01' }, 'o1')],
});

function services(spec: KalamSpec, records: Record<string, KalamRecord[]> = {}) {
  const stores = createMemoryStores(spec.id, { records });
  const confirm = vi.fn(async () => true);
  const svc = { ...stores, speak: vi.fn(), confirm, online: () => true, pickImage: async () => undefined, runAIBlock: vi.fn() } as unknown as RuntimeServices;
  return { stores, svc, confirm };
}

const run = (spec: KalamSpec, svc: RuntimeServices, extra: Partial<React.ComponentProps<typeof KalamRuntime>> = {}) =>
  render(h(KalamRuntime, { spec, appId: spec.id, services: svc, accessModes: MODES, mode: 'live', ...extra }));

beforeEach(() => {
  settings.update.mockClear();
  device.requestPermission.mockClear();
  device.sync.mockClear();
});
afterEach(cleanup);

describe('KalamRuntime with a 1.1 app', () => {
  it('draws the layout groups, charts, reminder and a link by its name, in the order the spec names them', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    run(tailor, svc);
    // The card group has its title as a heading; the grid holds both charts.
    expect(await screen.findByRole('heading', { name: 'Shortcuts' })).toBeTruthy();
    expect(screen.getAllByText(/^chart:/).map((n) => n.textContent)).toEqual(['chart:Advance by month', 'chart:Orders by garment']);
    // Both buttons are drawn inside the card; the reminder block says when it fires and starts switched off.
    expect(screen.getByRole('button', { name: 'New order' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New customer' })).toBeTruthy();
    expect(screen.getByText('Delivery reminder')).toBeTruthy();
    expect(screen.getByText(/1 day before delivery date/i)).toBeTruthy();
    // The order list shows the customer's name for the link, never the stored id.
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.queryByText('c_asha')).toBeNull();
  });

  it('keeps a component style on its own part only: a full-width button stretches, the others keep their size', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    const view = run(tailor, svc);
    const order = await screen.findByRole('button', { name: 'New order' });
    // `fullWidth` wraps the part in a frame that stretches; the plain button's wrapper does not.
    const widths = (el: HTMLElement) => getComputedStyle(el.parentElement as HTMLElement).width;
    expect(widths(order)).toBe('100%');
    expect(view.container.querySelectorAll('[role="button"]').length).toBeGreaterThan(1);
  });

  it('draws a part set to "large" bigger than the same part left at its size', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    run(tailor, svc);
    const label = async (name: string) => (await screen.findByRole('button', { name })).querySelector('div[dir="auto"], span') as HTMLElement;
    const size = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize);
    // "New order" has style.size large; "New customer" has only a tone and an alignment.
    expect(size(await label('New order'))).toBeGreaterThan(size(await label('New customer')));
  });

  it('switches the reminder on from the person\'s own tap, asks the device once, and says what happened', async () => {
    const { svc, stores } = services(tailor, seed(tailor.id));
    run(tailor, svc);
    const sw = await screen.findByRole('switch', { name: /Remind me: Delivery reminder/ });
    expect(screen.getByText(/Off\. Nothing is scheduled/)).toBeTruthy();
    expect(device.requestPermission).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(sw);
    });
    await waitFor(() => expect(screen.getByText(/On\. Reminders stay on this device/)).toBeTruthy());
    expect(device.requestPermission).toHaveBeenCalledTimes(1);
    expect(device.sync).toHaveBeenCalledWith(tailor.id);
    expect((await stores.state.all(tailor.id)).delivery_reminder).toBe(true);
  });

  it('never schedules anything from a preview', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    run(tailor, svc, { mode: 'preview' });
    const sw = await screen.findByRole('switch', { name: /Remind me/ });
    await act(async () => {
      fireEvent.click(sw);
    });
    await waitFor(() => expect(screen.getByText(/On\. Reminders stay on this device/)).toBeTruthy());
    expect(device.requestPermission).not.toHaveBeenCalled();
    expect(device.sync).not.toHaveBeenCalled();
    // The preview note is Kalam's own stamp.
    expect(document.querySelector('[data-stamp]')?.textContent).toMatch(/^Preview\./);
  });

  it('opens on the screen a widget or link asked for, and goes there again when asked while open', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    const used = vi.fn();
    const view = run(tailor, svc, { startScreen: 'add', onStartScreenUsed: used });
    expect(await screen.findByRole('heading', { name: 'New order' })).toBeTruthy();
    expect(used).toHaveBeenCalled();
    view.rerender(h(KalamRuntime, { spec: tailor, appId: tailor.id, services: svc, accessModes: MODES, mode: 'live', startScreen: 'customer_add' }));
    expect(await screen.findByRole('heading', { name: 'New customer' })).toBeTruthy();
    // An unknown screen leaves the app where it is.
    view.rerender(h(KalamRuntime, { spec: tailor, appId: tailor.id, services: svc, accessModes: MODES, mode: 'live', startScreen: 'nope' }));
    expect(screen.getByRole('heading', { name: 'New customer' })).toBeTruthy();
  });

  it('draws the signature pad on an entry page, with a way to type a name instead', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    run(tailor, svc, { startScreen: 'order_detail' });
    expect(await screen.findByLabelText('Customer signature. Not signed yet.')).toBeTruthy();
    const typeInstead = screen.getByRole('button', { name: 'Type your name instead: Customer signature' });
    await act(async () => {
      fireEvent.click(typeInstead);
    });
    expect(await screen.findByLabelText(/Type your full name to sign/)).toBeTruthy();
  });

  it('draws a long list one page at a time and says how many more it will show', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row(tailor.id, 'orders', { customer: 'c_asha', garment: 'Kurta', advance: i }, `o${i}`));
    const { svc } = services(tailor, { customers: seed(tailor.id).customers, orders: many });
    run(tailor, svc);
    const rows = () => screen.getAllByRole('listitem');
    await screen.findByText('All orders');
    expect(rows()).toHaveLength(50);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    });
    expect(rows()).toHaveLength(60);
    expect(screen.queryByRole('button', { name: /^Show d+ more$/ })).toBeNull();
  });

  it('hands saved confirmations to the caller and stays quiet itself when asked', async () => {
    const { svc } = services(tailor, seed(tailor.id));
    const onToast = vi.fn();
    run(tailor, svc, { onToast });
    const sw = await screen.findByRole('switch', { name: /Remind me/ });
    await act(async () => {
      fireEvent.click(sw);
    });
    await waitFor(() => expect(screen.getByText(/On\. Reminders stay on this device/)).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('KalamRuntime with a timer and a suggested mode', () => {
  it('offers the Access Mode the app suggests, never turns it on by itself, and remembers "Not now"', async () => {
    const { svc, stores } = services(workout);
    run(workout, svc);
    expect(await screen.findByText(/This app suggests Large text\. Turn it on\?/)).toBeTruthy();
    expect(settings.update).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    });
    await waitFor(async () => expect((await stores.state.all(workout.id))[SUGGESTED_MODES_KEY]).toBe('dismissed'));
    await waitFor(() => expect(screen.queryByText(/This app suggests/)).toBeNull());
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('turns the suggested mode on in the person\'s own settings when they say so', async () => {
    const { svc } = services(workout);
    run(workout, svc);
    const turnOn = await screen.findByRole('button', { name: 'Turn on' });
    await act(async () => {
      fireEvent.click(turnOn);
    });
    expect(settings.update).toHaveBeenCalledWith({ accessModes: { ...MODES, large: true } });
  });

  it('shows no offer in a preview, and none for a mode the person already uses', async () => {
    const { svc } = services(workout);
    const view = run(workout, svc, { mode: 'preview' });
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.queryByText(/This app suggests/)).toBeNull();
    view.unmount();
    run(workout, svc, { accessModes: { ...MODES, large: true } });
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.queryByText(/This app suggests/)).toBeNull();
  });

  it('draws the timer with its words and a chart for the same screen', async () => {
    const { svc } = services(workout);
    run(workout, svc);
    expect(await screen.findByRole('button', { name: 'Start Rest' })).toBeTruthy();
    expect(screen.getByText('chart:Minutes per day')).toBeTruthy();
  });
});

describe('the delete question', () => {
  const t = resolveAppTheme(tailor.theme, MODES);
  it('puts the question first and each thing the delete also changes on its own line', () => {
    render(h(ConfirmSheet, { request: { message: 'Delete this order?\nThis also deletes 2 linked entries.\n1 linked entry loses the link.', resolve: () => undefined }, t, wide: false }));
    expect(screen.getByRole('heading', { name: 'Delete this order?' })).toBeTruthy();
    expect(screen.getByText('This also deletes 2 linked entries.')).toBeTruthy();
    expect(screen.getByText('1 linked entry loses the link.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, do it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
