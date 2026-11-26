import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { COLLAB_COPY } from './copy';
import { announce, Button, Text, useKalamTheme } from '@/design';

export interface InlineAskProps {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** A confirmation inside the sheet it belongs to, so a sheet never opens on top of a sheet. */
export function InlineAsk({ title, message, confirmLabel, destructive, onConfirm, onCancel }: InlineAskProps) {
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
    <View style={{ gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt }}>
      <Text weight="semibold">{title}</Text>
      <Text variant="bodySmall" tone="secondary">{message}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        <Button label={confirmLabel} variant={destructive ? 'destructive' : 'primary'} onPress={confirm} loading={busy} />
        <Button label={COLLAB_COPY.cancel} variant="outline" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}
