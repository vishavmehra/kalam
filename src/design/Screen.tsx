import { createContext, type ReactNode, useContext } from 'react';
import { ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBreakpoint, useKalamTheme } from './theme';

/** True inside AppShell: its header already clears the status bar, so screens do not add the top inset again. */
export const InShellContext = createContext(false);

export interface ScreenProps {
  children: ReactNode;
  /** Wrap in a vertical ScrollView. Default true. */
  scroll?: boolean;
  /** Content column max width (docs/02 §7.2). Default workspace 1440. */
  maxWidth?: number;
  /** Add the top safe-area inset. Default true, or false inside AppShell (its header clears it). */
  safeTop?: boolean;
  /** Add the bottom safe-area inset (screens without a tab bar). Default false. */
  safeBottom?: boolean;
  /**
   * Where a column narrower than the page sits. Default `start` inside AppShell, so content begins at the normal
   * gutter beside the rail with no blank band on its left (owner, 2026-11-25); `center` outside the shell.
   */
  align?: 'start' | 'center';
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Page scaffold: ledger paper, normal page gutters (16, 32, 48 px; no margin column), a max-width column. */
export function Screen({ children, scroll = true, maxWidth, safeTop, safeBottom = false, align, contentStyle, testID }: ScreenProps) {
  const theme = useKalamTheme();
  const inShell = useContext(InShellContext);
  const topInset = safeTop ?? !inShell;
  const insets = useSafeAreaInsets();
  const { isPhone, isDesktop } = useBreakpoint();
  const gutter = isPhone ? 16 : isDesktop ? 48 : 32;
  const column = (
    <View style={[{ width: '100%', maxWidth: maxWidth ?? theme.layout.workspaceMax, alignSelf: (align ?? (inShell ? 'start' : 'center')) === 'start' ? 'flex-start' : 'center' }, contentStyle]}>
      {children}
    </View>
  );
  const padding = {
    paddingHorizontal: gutter,
    paddingTop: (topInset ? insets.top : 0) + (isPhone ? 16 : 32),
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
