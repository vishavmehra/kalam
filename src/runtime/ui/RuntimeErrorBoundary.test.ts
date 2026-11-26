// @vitest-environment jsdom
/**
 * A generated app that fails to draw shows Kalam's own recovery card (src/design, in Kalam's words), not the app's theme,
 * and "Try again" draws the app from scratch.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement as h, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslator } from '@/i18n/active';
import { RuntimeErrorBoundary } from './RuntimeErrorBoundary';

vi.mock('react-native', () => vi.importActual('react-native-web'));
vi.mock('@/i18n/react', () => ({ useT: () => getTranslator('en').t }));
vi.mock('@/design', async () => {
  const { createElement } = await import('react');
  type P = { children?: ReactNode; label?: string; onPress?: () => void; accessibilityRole?: string };
  return {
    useKalamTheme: () => ({ space: { 1: 4, 2: 8, 3: 12, 6: 24 }, colors: { background: '#F4F5F0' } }),
    Surface: ({ children }: P) => createElement('section', null, children),
    Text: ({ children, accessibilityRole }: P) => createElement(accessibilityRole === 'header' ? 'h2' : 'p', null, children),
    Button: ({ label, onPress }: P) => createElement('button', { type: 'button', onClick: onPress }, label),
  };
});

afterEach(cleanup);

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom');
  return h('p', null, 'the app is fine');
}

describe('RuntimeErrorBoundary', () => {
  it('shows Kalam\'s recovery card in plain words, with a way out, and the records untouched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exit = vi.fn();
    render(h(RuntimeErrorBoundary, { appName: 'Tailor Orders', onRetry: () => undefined, onExit: exit }, h(Bomb, { explode: true })));
    expect(screen.getByRole('heading', { name: 'Tailor Orders stopped on this screen' })).toBeTruthy();
    expect(screen.getByText(/Your saved records are safe/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('draws the app again from scratch on "Try again"', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let fix = false;
    function Host() {
      const [attempt, setAttempt] = useState(0);
      return h(RuntimeErrorBoundary, { appName: 'Tailor Orders', onRetry: () => { fix = true; setAttempt((a) => a + 1); } }, h(Bomb, { key: attempt, explode: !fix }));
    }
    render(h(Host));
    expect(screen.queryByText('the app is fine')).toBeNull();
    // No way out is offered when the caller gave none.
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('the app is fine')).toBeTruthy();
  });
});
