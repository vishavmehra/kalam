/**
 * Catches a render error inside a generated app so one broken screen never takes Kalam down
 * (docs/04 §3.7, docs/09). Shows a calm recovery card: try again, or leave the app. Saved
 * records are untouched because rendering never writes data.
 *
 * The card is Kalam's, drawn in Kalam's own paper and ink (src/design), never in the app's theme:
 * the app's theme may be what failed.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button, Surface, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

interface Props {
  appName: string;
  /** Remounts the app (the parent bumps a key). */
  onRetry: () => void;
  onExit?: () => void;
  children?: ReactNode;
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
    return <FailureCard appName={this.props.appName} onRetry={this.retry} onExit={this.props.onExit} />;
  }
}

function FailureCard({ appName, onRetry, onExit }: { appName: string; onRetry: () => void; onExit?: () => void }) {
  const theme = useKalamTheme();
  const t = useT();
  return (
    <View
      accessibilityRole="alert"
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[6], backgroundColor: theme.colors.background }}
    >
      <Surface padded={theme.space[6]} elevation={2} style={{ width: '100%', maxWidth: 420, gap: theme.space[3] }}>
        <Text variant="h4" accessibilityRole="header">{t('runtime.failed.title', { name: appName })}</Text>
        <Text tone="secondary">{t('runtime.failed.body')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], marginTop: theme.space[1] }}>
          <Button label={t('runtime.failed.retry')} onPress={onRetry} />
          {onExit ? <Button label={t('runtime.failed.back')} variant="outline" onPress={onExit} /> : null}
        </View>
      </Surface>
    </View>
  );
}
