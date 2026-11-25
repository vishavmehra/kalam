import type { ReactNode } from 'react';
import { ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBreakpoint, useKalamTheme } from './theme';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap in a vertical ScrollView. Default true. */
  scroll?: boolean;
  /** Content column max width (docs/02 §7.2). Default workspace 1440. */
  maxWidth?: number;
  /** Add the top safe-area inset. Default true. */
  safeTop?: boolean;
  /** Add the bottom safe-area inset (screens without a tab bar). Default false. */
  safeBottom?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Page scaffold: paper background, responsive gutters, centred max-width column. */
export function Screen({ children, scroll = true, maxWidth, safeTop = true, safeBottom = false, contentStyle, testID }: ScreenProps) {
  const theme = useKalamTheme();
  const insets = useSafeAreaInsets();
  const { isPhone, isDesktop } = useBreakpoint();
  const gutter = isPhone ? 16 : isDesktop ? 48 : 32;
  const column = (
    <View style={[{ width: '100%', maxWidth: maxWidth ?? theme.layout.workspaceMax, alignSelf: 'center' }, contentStyle]}>
      {children}
    </View>
  );
  const padding = {
    paddingHorizontal: gutter,
    paddingTop: (safeTop ? insets.top : 0) + (isPhone ? 12 : 32),
    paddingBottom: (safeBottom ? insets.bottom : 0) + 48,
  };
  if (!scroll) {
    return <View testID={testID} style={[{ flex: 1, backgroundColor: theme.colors.background }, padding]}>{column}</View>;
  }
  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
    >
      {column}
    </ScrollView>
  );
}
