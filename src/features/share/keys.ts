import { Platform } from 'react-native';

interface KeyLike {
  key?: string;
  preventDefault?: () => void;
}

/**
 * Props for a row that has a checkbox or radio role. On the web a row built from a Pressable answers Enter
 * only, but the checkbox and radio patterns also promise Space. Spread this on the row. Other platforms
 * have no keyboard presses to add, so it gives nothing there.
 */
export function pressOnSpace(onPress: () => void): { onKeyDown?: (event: KeyLike) => void } {
  if (Platform.OS !== 'web') return {};
  return {
    onKeyDown: (event) => {
      if (event.key !== ' ') return;
      // Space would otherwise scroll the sheet.
      event.preventDefault?.();
      onPress();
    },
  };
}
