import { router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';

import { Button, useKalamTheme } from '@/design';
import { useAuthUser } from '@/features/auth/use-auth';
import { useT } from '@/i18n/react';

import { useIsModerator } from './claim';
import { moderationRoute } from './routes';

/**
 * A button to the moderator page. It renders nothing for anyone without the `kalamModerator` claim, so other
 * people never see that the page exists. Uses the saved sign-in token, so it adds no network request.
 */
export function ModeratorLink() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { user } = useAuthUser();
  const { moderator } = useIsModerator(user?.uid);
  if (!moderator) return null;
  return <Button label={t('bazaar.mod.title')} variant="outline" size="sm" icon={ShieldCheck} onPress={() => router.push(moderationRoute)} />;
}
