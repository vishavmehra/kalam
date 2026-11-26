import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { announce, Button, Text, useKalamTheme } from '@/design';
import { SHARE_UI } from './copy';

export interface InlineConfirmProps {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  /** May be async. The button shows progress and cannot be pressed twice. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * A question that sits inside the card or panel it belongs to, so a sheet never opens on top of a sheet.
 * Screen readers hear the question once, through `announce`, because focus does not move. (An alert role as
 * well would read it twice on the web, and iOS ignores that role when something appears.)
 */
export function InlineConfirm({ title, message, confirmLabel, destructive, onConfirm, onCancel }: InlineConfirmProps) {
  const theme = useKalamTheme();
  const [busy, setBusy] = useState(false);
  useEffect(() => announce(`${title} ${message}`), [title, message]);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{ gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt }}
    >
      <Text weight="semibold">{title}</Text>
      <Text variant="bodySmall" tone="secondary">{message}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        <Button label={confirmLabel} variant={destructive ? 'destructive' : 'primary'} onPress={confirm} loading={busy} />
        <Button label={SHARE_UI.cancel} variant="outline" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}
