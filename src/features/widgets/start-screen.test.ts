/**
 * A widget tap names a screen of the app (`kalam://app/<id>?screen=<screen>`). It must work when the app starts, and again
 * when the app is already open, which is the common case: the person taps the widget while Kalam sits in the background.
 */
import { describe, expect, it } from 'vitest';
import { startStack } from '@/core/widgets';
import { chaiSpec } from '@/core/widgets/test-kit';
import { createRuntimeState } from '@/runtime/engine/state';
import { applyStartScreen } from './start-screen';

const spec = chaiSpec('app_chai01', {
  screens: [
    { id: 'home', title: 'Home', children: [] },
    { id: 'add', title: 'Add', form: 'orders', children: [] },
    { id: 'more', title: 'More', children: [] },
  ],
});

describe('a widget opens a screen', () => {
  it('on a cold start, with the first screen behind it', () => {
    const cold = applyStartScreen(spec, createRuntimeState(spec), 'add');
    expect(cold.stack).toEqual(['home', 'add']);
    expect(cold.stack).toEqual(startStack(spec, 'add'));
  });

  it('on a cold start with no screen, or one that is not in the app, stays on the first screen', () => {
    const fresh = createRuntimeState(spec);
    expect(applyStartScreen(spec, fresh, undefined)).toBe(fresh);
    expect(applyStartScreen(spec, fresh, 'gone')).toBe(fresh);
    expect(applyStartScreen(spec, fresh, 'home').stack).toEqual(['home']);
  });

  it('again when the app is already open: a second widget asks for a different screen', () => {
    const open = applyStartScreen(spec, createRuntimeState(spec), 'add');
    const second = applyStartScreen(spec, open, 'more');
    expect(second.stack).toEqual(['home', 'add', 'more']);
    // Asking for a screen already on the way goes back to it instead of piling up.
    expect(applyStartScreen(spec, second, 'add').stack).toEqual(['home', 'add']);
    expect(applyStartScreen(spec, second, 'home').stack).toEqual(['home']);
  });

  it('never changes the state it was given', () => {
    const before = createRuntimeState(spec);
    const copy = JSON.parse(JSON.stringify(before));
    applyStartScreen(spec, before, 'add');
    expect(before).toEqual(copy);
  });
});
