import { CloudOff } from 'lucide-react-native';
import { View } from 'react-native';

import { useOnline } from '@/components/status/useHybridStatus';
import { Sheet, Text, useKalamTheme, useToast } from '@/design';
import { useT } from '@/i18n/react';

import { SignInPanel } from './SignInPanel';
import { useAuthUser } from './use-auth';

export interface SignInSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The sign-in sheet opened from the welcome page's header: Continue with Google, then email. The privacy
 * sentence is the sheet's description, so it sits under the title and is read without scrolling. Closes itself
 * once signed in. Every other route is behind the full-screen gate (SignInGate), not this sheet.
 */
export function SignInSheet({ visible, onClose }: SignInSheetProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const online = useOnline();
  const { user, configured } = useAuthUser();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('auth.sheet.title')}
      description={t('auth.sheet.privacy')}
      maxWidth={460}
      testID="sign-in-sheet"
    >
      <View style={{ gap: 16, paddingBottom: 8 }}>
        {!configured ? (
          <Text tone="secondary">{t('auth.errors.not_configured')}</Text>
        ) : (
          <>
            {!online ? (
              <View role="status" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: theme.radius.paper, backgroundColor: theme.colors.graphiteSoft }}>
                <CloudOff size={18} color={theme.colors.graphite} />
                <Text variant="bodySmall" style={{ flex: 1 }}>{t('auth.gate.offline')}</Text>
              </View>
            ) : null}
            <SignInPanel
              initialMode={user?.isAnonymous ? 'signup' : 'signin'}
              onDone={() => {
                onClose();
                toast.show({ message: t('auth.toast.signedIn'), tone: 'success' });
              }}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}
