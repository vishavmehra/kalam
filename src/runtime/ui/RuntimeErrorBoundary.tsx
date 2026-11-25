/**
 * Catches a render error inside a generated app so one broken screen never takes Kalam down
 * (docs/04 §3.7, docs/09). Shows a calm recovery card: try again, or leave the app. Saved
 * records are untouched because rendering never writes data.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontFamilies } from '@/design/tokens';

interface Props {
  appName: string;
  /** Remounts the app (the parent bumps a key). */
  onRetry: () => void;
  onExit?: () => void;
  children: ReactNode;
}

interface State { failed: boolean }

export class RuntimeErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept on this device only; never sent anywhere.
    console.warn('[kalam] a generated app failed to render', error.message, info.componentStack?.split('\n')[1]?.trim());
  }

  private retry = () => {
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { appName, onExit } = this.props;
    return (
      <View style={styles.root} accessibilityRole="alert">
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">{appName} stopped on this screen</Text>
          <Text style={styles.body}>
            Something in this screen could not be shown. Your saved records are safe. Try again, or go back and
            restore an earlier version from Edit.
          </Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" onPress={this.retry} style={[styles.button, styles.primary]}>
              <Text style={[styles.label, { color: '#FFFFFF' }]}>Try again</Text>
            </Pressable>
            {onExit ? (
              <Pressable accessibilityRole="button" onPress={onExit} style={[styles.button, styles.outline]}>
                <Text style={[styles.label, { color: '#161A3D' }]}>Go back</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }
}

// Neutral, self-contained colours: the app's own theme may be what failed.
const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F7F7F4' },
  card: {
    width: '100%', maxWidth: 420, gap: 12, padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#DCDEEA', backgroundColor: '#FFFFFF',
  },
  title: { fontFamily: fontFamilies.uiSemibold, fontSize: 20, lineHeight: 26, color: '#161A3D' },
  body: { fontFamily: fontFamilies.ui, fontSize: 15, lineHeight: 22, color: '#454B6E' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: { minHeight: 48, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#283080' },
  outline: { borderWidth: 1, borderColor: '#858AAB' },
  label: { fontFamily: fontFamilies.uiSemibold, fontSize: 15 },
});
