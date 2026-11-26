import { Eye } from 'lucide-react-native';

import { SwitchRow, useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';

import { useShareViews } from './consent';

/**
 * The opt-in for anonymous view counts. Off by default. When on, opening a listing or starting its preview adds
 * one to a number the maker can see; no name, account or device is sent with it (functions kalamBazaarCount).
 */
export function ShareViewsRow() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const { on, set } = useShareViews();
  return (
    <SwitchRow
      label={t('bazaar.mod.share.label')}
      description={t('bazaar.mod.share.hint')}
      icon={Eye}
      value={on}
      onValueChange={(next) => { void set(next).then((saved) => { if (!saved) toast.show({ message: t('bazaar.mod.error.failed'), tone: 'danger' }); }); }}
    />
  );
}
