import { Check } from 'lucide-react-native';
import { Platform, Pressable, View } from 'react-native';

import { Text, useKalamTheme, webData } from '@/design';

export interface ChoiceProps {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** `radio` for one of several, `checkbox` for any number. Default radio. */
  kind?: 'radio' | 'checkbox';
  testID?: string;
}

interface KeyLike {
  key?: string;
  preventDefault?: () => void;
}

/** On the web a Pressable answers Enter only, but radio and checkbox rows also promise Space. Other platforms have no key presses. */
function pressOnSpace(onPress: () => void): { onKeyDown?: (event: KeyLike) => void } {
  if (Platform.OS !== 'web') return {};
  return {
    onKeyDown: (event) => {
      if (event.key !== ' ') return;
      event.preventDefault?.();
      onPress();
    },
  };
}

/** One option of a list: radio or checkbox role, a check mark when chosen (never colour alone), at least the touch target tall. */
export function Choice({ label, description, selected, onPress, kind = 'radio', testID }: ChoiceProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  return (
    <Pressable
      role={kind}
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      onPress={onPress}
      testID={testID}
      {...pressOnSpace(onPress)}
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
          width: 24, height: 24, borderRadius: kind === 'radio' ? 12 : 6, alignItems: 'center', justifyContent: 'center',
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
