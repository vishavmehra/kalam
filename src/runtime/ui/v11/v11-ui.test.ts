// @vitest-environment jsdom
/**
 * The 1.1 renderers, drawn with react-native-web in jsdom. Icons, the SVG layer, the shared field
 * shell and the press wrapper are stubbed (they load native modules); everything the renderers
 * decide themselves (labels, values written, offers, grid widths) is real.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../../../tests/fixtures/specs/load';
import type { AccessModes, KalamRecord } from '@/core/contracts';
import { validateSpec } from '@/core/spec';
import type { ComponentOf, KalamComponent, KalamSpec } from '@/core/spec/schema';
import { resolveAppTheme } from '../../engine/theme';
import { arrangeScreen } from '../../engine/v11';
import { clearKeptTimers, LayoutView, RelationPicker, ReminderBlock, SignaturePad, SuggestedModesNotice, TimerBlock } from './index';

vi.mock('react-native', () => vi.importActual('react-native-web'));
vi.mock('lucide-react-native', () => {
  const icon = () => null;
  return { Pause: icon, Play: icon, RotateCcw: icon, Bell: icon, BellOff: icon, Eraser: icon, Keyboard: icon, PenLine: icon, Check: icon, ChevronDown: icon, Search: icon };
});
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  return { default: ({ children }: { children?: ReactNode }) => createElement('svg', null, children), Path: () => createElement('path') };
});
vi.mock('../../layout', () => ({ useComponentBounds: () => ({}) }));
vi.mock('../kit', async () => {
  const { createElement } = await import('react');
  type P = { onPress?: () => void; accessibilityLabel?: string; accessibilityRole?: string; accessibilityState?: { checked?: boolean }; disabled?: boolean; children?: ReactNode };
  return {
    font: () => ({}),
    tabular: {},
    Pressy: ({ onPress, accessibilityLabel, accessibilityRole, accessibilityState, disabled, children }: P) =>
      createElement('button', {
        type: 'button', onClick: onPress, disabled, 'aria-label': accessibilityLabel,
        ...(accessibilityRole === 'radio' ? { role: 'radio', 'aria-checked': !!accessibilityState?.checked } : {}),
      }, children),
  };
});
vi.mock('../inputs', async () => {
  const { createElement } = await import('react');
  return {
    FieldShell: ({ label, error, children }: { label: string; error?: string; children?: ReactNode }) =>
      createElement('div', null, createElement('span', null, label), children, error ? createElement('p', { role: 'alert' }, error) : null),
    fieldBox: () => ({}),
    invalidProps: () => ({}),
  };
});

// onLayout in react-native-web needs a ResizeObserver; this one reports a 328 px wide phone column.
class FakeResizeObserver {
  constructor(private cb: (entries: Array<{ target: Element }>) => void) {}
  observe(target: Element) {
    queueMicrotask(() => this.cb([{ target }]));
  }
  unobserve() {}
  disconnect() {}
}
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 328 });

const MODES: AccessModes = { large: false, highContrast: false, simple: false, readAloud: false, leftHanded: false };
const tailor = validateSpec(loadFixture('valid', 'tailor-orders-linked', 'v11')).spec as KalamSpec;
const t = resolveAppTheme(tailor.theme, MODES);
const find = <T extends KalamComponent['type']>(type: T, id?: string) =>
  tailor.screens.flatMap((s) => s.children).find((c) => c.type === type && (!id || c.id === id)) as ComponentOf<T>;

afterEach(() => {
  cleanup();
  clearKeptTimers();
  vi.useRealTimers();
});

describe('TimerBlock', () => {
  const stopwatch: ComponentOf<'timer'> = { id: 'session', type: 'timer', label: 'Session', mode: 'stopwatch', field: 'minutes', unit: 'seconds' };
  const countdown: ComponentOf<'timer'> = { id: 'rest', type: 'timer', label: 'Rest', mode: 'countdown', durationSec: 2 };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 9));
  });

  it('writes the running time into the form every second, so Save never stores an old value', () => {
    const onValue = vi.fn();
    const onFocus = vi.fn();
    render(h(TimerBlock, { c: stopwatch, t, appId: 'a', onValue, onFocus }));
    fireEvent.click(screen.getByLabelText('Start Session'));
    expect(onFocus).toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(3000));
    expect(onValue).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByLabelText('Pause Session'));
    expect(screen.getByLabelText('Resume Session')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Reset Session'));
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it('keeps a running timer when the screen goes away and comes back', () => {
    const first = render(h(TimerBlock, { c: stopwatch, t, appId: 'a', onValue: vi.fn() }));
    fireEvent.click(screen.getByLabelText('Start Session'));
    first.unmount();
    act(() => void vi.advanceTimersByTime(5000));
    const onValue = vi.fn();
    render(h(TimerBlock, { c: stopwatch, t, appId: 'a', onValue }));
    expect(onValue).toHaveBeenCalledWith(5);
    expect(screen.getByLabelText('Pause Session')).toBeTruthy();
  });

  it('says time is up and offers Start, not Resume, after a countdown ends', () => {
    const onFinish = vi.fn();
    render(h(TimerBlock, { c: countdown, t, appId: 'a', onFinish }));
    fireEvent.click(screen.getByLabelText('Start Rest'));
    act(() => void vi.advanceTimersByTime(2500));
    expect(onFinish).toHaveBeenCalledWith('Rest: time is up.');
    expect(screen.getByLabelText('Start Rest')).toBeTruthy();
    expect(screen.queryByLabelText('Resume Rest')).toBeNull();
  });
});

describe('ReminderBlock', () => {
  const c = find('reminder');

  it('explains why before asking, and reports the switch', () => {
    const onToggle = vi.fn();
    const onFocus = vi.fn();
    render(h(ReminderBlock, { c, t, spec: tailor, enabled: false, onToggle, onFocus }));
    expect(screen.getByText('Why it asks: To remind you a day before each delivery')).toBeTruthy();
    expect(screen.getByText('Off. Nothing is scheduled until you switch it on.')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onFocus).toHaveBeenCalled();
  });

  it('never says "On" alone when notifications are blocked', () => {
    const onOpenSettings = vi.fn();
    render(h(ReminderBlock, { c, t, spec: tailor, enabled: true, status: 'no_permission', onToggle: vi.fn(), onOpenSettings }));
    expect(screen.getByText(/notifications are blocked/)).toBeTruthy();
    expect(screen.queryByText('On. Reminders stay on this device.')).toBeNull();
    fireEvent.click(screen.getByLabelText('Open settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('RelationPicker', () => {
  const c = find('textInput', 'customer_input');
  const relation = { collection: 'customers', display: 'name' };
  const people = (names: string[]): KalamRecord[] =>
    names.map((name, i) => ({ id: `c${i}`, appId: tailor.id, collectionId: 'customers', createdAt: i, updatedAt: i, values: { name } }));

  it('lists entries by name and stores the picked id, never text', () => {
    const onChange = vi.fn();
    render(h(RelationPicker, { c, t, spec: tailor, relation, records: people(['Ravi', 'Asha']), value: undefined, onChange, onFocus: vi.fn() }));
    fireEvent.click(screen.getByLabelText(/^Customer: None chosen/));
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Asha', 'Ravi']);
    fireEvent.click(screen.getByLabelText('Ravi'));
    expect(onChange).toHaveBeenCalledWith('c0');
  });

  it('searches a long list and can clear an optional link', () => {
    const onChange = vi.fn();
    const many = people(['Asha', 'Ravi', 'Meena', 'Arjun', 'Kiran', 'Lata', 'Mohan', 'Neha', 'Om', 'Pooja']);
    render(h(RelationPicker, { c: { ...c, required: false }, t, spec: tailor, relation, records: many, value: 'c1', onChange, onFocus: vi.fn() }));
    fireEvent.click(screen.getByLabelText(/^Customer: Ravi/));
    fireEvent.change(screen.getByLabelText('Search Customers'), { target: { value: 'as' } });
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Asha', 'Clear']);
    fireEvent.click(screen.getByLabelText('Clear'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('SignaturePad', () => {
  const c = find('signature');

  it('lets someone who cannot draw type their name, which counts as signed', () => {
    const onChange = vi.fn();
    render(h(SignaturePad, { c, t, value: undefined, onChange, onFocus: vi.fn() }));
    fireEvent.click(screen.getByLabelText('Type your name instead: Customer signature'));
    fireEvent.change(screen.getByLabelText(/Type your full name to sign/), { target: { value: 'Asha Rao' } });
    expect(onChange).toHaveBeenLastCalledWith('sigt:Asha Rao');
  });

  it('shows a typed signature and clears it', () => {
    const onChange = vi.fn();
    render(h(SignaturePad, { c, t, value: 'sigt:Asha Rao', onChange, onFocus: vi.fn() }));
    fireEvent.click(screen.getByLabelText('Draw instead: Customer signature'));
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByLabelText('Customer signature. Signed.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Clear signature: Customer signature'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('LayoutView', () => {
  it('draws groups in order, titles cards as headers, and fits a 4 column grid onto a phone', async () => {
    const home = structuredClone(tailor.screens[0]);
    const grid = home.layout?.[1];
    if (grid) grid.columns = 4;
    const items = arrangeScreen(home, home.children);
    render(h(LayoutView, { items, t, render: (c: KalamComponent) => h('span', { 'data-testid': c.id }, c.id) }));
    expect(screen.getByRole('heading').textContent).toBe('Shortcuts');
    expect(screen.getAllByTestId(/./).map((e) => e.dataset.testid)).toEqual([
      'open_orders', 'advance_total', 'advance_chart', 'garment_chart', 'delivery_reminder', 'order_list', 'add_order', 'add_customer',
    ]);
    // Observer callback (microtask), then react-native-web measures on a 0 ms timer.
    await act(async () => await new Promise((r) => setTimeout(r, 20)));
    const cell = (id: string) => screen.getByTestId(id).parentElement as HTMLElement;
    // 328 px wide: one column, each cell the full width, never a squeezed quarter.
    expect(cell('advance_chart').style.width).toBe('328px');
    expect(cell('garment_chart').style.width).toBe('328px');
  });
});

describe('SuggestedModesNotice', () => {
  it('offers the modes and changes nothing until the person answers', () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(h(SuggestedModesNotice, { t, modes: ['large', 'highContrast'], onAccept, onDismiss }));
    expect(screen.getByText('This app suggests Large text and High contrast. Turn them on? You can switch them off again in Settings.')).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Turn on'));
    expect(onAccept).toHaveBeenCalledWith(['large', 'highContrast']);
    fireEvent.click(screen.getByLabelText('Not now'));
    expect(onDismiss).toHaveBeenCalled();
    rerender(h(SuggestedModesNotice, { t, modes: [], onAccept, onDismiss }));
    expect(screen.queryByText(/This app suggests/)).toBeNull();
  });
});
