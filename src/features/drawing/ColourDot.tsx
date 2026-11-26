import { View } from 'react-native';

import { useKalamTheme } from '@/design';

/**
 * One colour in a palette. The chosen one is ringed in ink with a paper gap, so the ring still shows on an
 * ink-coloured dot. Same outer size either way, so choosing never moves the row.
 */
export function ColourDot({ value, selected, size = 28, square }: { value: string; selected: boolean; size?: number; square?: boolean }) {
  const { colors } = useKalamTheme();
  const outer = size + 4;
  const inner = selected ? size - 6 : size;
  const round = (d: number) => (square ? 6 : d / 2);
  return (
    <View
      style={{
        width: outer, height: outer, borderRadius: round(outer), alignItems: 'center', justifyContent: 'center',
        borderWidth: selected ? 2.5 : 0, borderColor: colors.text,
      }}
    >
      <View style={{ width: inner, height: inner, borderRadius: round(inner), backgroundColor: value, borderWidth: 1, borderColor: colors.borderStrong }} />
    </View>
  );
}
