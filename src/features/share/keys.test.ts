import { describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', () => ({ Platform: platform }));

import { pressOnSpace } from './keys';

describe('pressing a checkbox or radio row with the keyboard', () => {
  it('Space presses the row on the web, and does not scroll the sheet', () => {
    platform.OS = 'web';
    const onPress = vi.fn();
    const preventDefault = vi.fn();
    pressOnSpace(onPress).onKeyDown?.({ key: ' ', preventDefault });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('other keys are left alone (Enter already works on a pressable)', () => {
    platform.OS = 'web';
    const onPress = vi.fn();
    const handler = pressOnSpace(onPress).onKeyDown;
    for (const key of ['Enter', 'a', 'Tab', 'Spacebar']) handler?.({ key, preventDefault: vi.fn() });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('adds nothing on phones, which have no keyboard presses to handle', () => {
    platform.OS = 'android';
    expect(pressOnSpace(vi.fn())).toEqual({});
  });
});
