import { View } from 'react-native';

import { Text, TextField, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

export interface PassphraseFieldsProps {
  value: string;
  onChange: (v: string) => void;
  /** Second field to catch typos when the passphrase is new. Omit when unlocking. */
  again?: string;
  onAgainChange?: (v: string) => void;
  error?: string;
}

/** Passphrase entry with the lost-passphrase warning (docs/11 §12.8). The text is never stored. */
export function PassphraseFields({ value, onChange, again, onAgainChange, error }: PassphraseFieldsProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <View style={{ gap: 12 }}>
      <TextField
        label={t('accountSync.passphrase.label')}
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        helper={t('accountSync.passphrase.help')}
        error={again === undefined ? error : undefined}
      />
      {onAgainChange ? (
        <TextField
          label={t('accountSync.passphrase.again')}
          value={again ?? ''}
          onChangeText={onAgainChange}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          error={error}
        />
      ) : null}
      <Text variant="bodySmall" tone="warning">{t('accountSync.passphrase.warning')}</Text>
    </View>
  );
}
