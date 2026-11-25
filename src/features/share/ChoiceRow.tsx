import { Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text, useKalamTheme, webData } from '@/design';

export interface ChoiceRowProps {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/** One option of a single-choice list: radio role, a check mark when chosen (never colour alone), 48px or taller. */
export function ChoiceRow({ label, description, selected, onPress, testID }: ChoiceRowProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      onPress={onPress}
      testID={testID}
      {...webData({ kPress: '', kHover: 'surface' })}
      style={{
        minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center', gap: theme.space[3],
        paddingVertical: theme.space[2], paddingHorizontal: theme.space[3], borderRadius: theme.radius.md,
        borderWidth: selected ? 2 : 1, borderColor: selected ? c.primary : c.borderStrong,
        backgroundColor: selected ? c.primarySoft : 'transparent',
      }}
    >
      <View
        style={{
          width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: selected ? c.primary : c.borderStrong, backgroundColor: selected ? c.primary : 'transparent',
        }}
      >
        {selected ? <Check size={14} color={c.onPrimary} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium">{label}</Text>
        {description ? <Text variant="bodySmall" tone="secondary">{description}</Text> : null}
      </View>
    </Pressable>
  );
}
