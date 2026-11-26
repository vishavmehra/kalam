import { router } from 'expo-router';
import { LogIn, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { Text, useKalamTheme, webData } from '@/design';
import { useT } from '@/i18n/react';

import { SignInSheet } from './SignInSheet';
import { publicName, useAuthUser } from './use-auth';

export interface AccountButtonProps {
  /** Colours for the royal ink field (the landing header sits on it at wide sizes). */
  onField?: boolean;
}

/**
 * The header's account control: the person's initial once signed in, which opens Account. On the welcome page,
 * before the first sign-in, it is a "Sign in" button that opens the sign-in sheet (every other route sits behind
 * the full-screen gate). Hidden when this build has no accounts. Mount it in any header; it owns its sheet.
 */
export function AccountButton({ onField }: AccountButtonProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const t = useT(theme.uiLanguage);
  const { user, restoring, configured } = useAuthUser();
  const [open, setOpen] = useState(false);
  const fg = onField ? c.onField : c.text;
  const ring = onField ? c.onField2 : c.borderStrong;

  // A known user shows at once; a saved session that is still being read gets an inert placeholder of the same
  // size, so a signed-in person never sees (or taps) Sign in over their own session.
  if (user) {
    const name = publicName(user);
    const initial = (name || user.email || '').trim().charAt(0).toUpperCase();
    const label = name ? t('auth.button.account', { name }) : t('auth.button.accountNoName');
    return (
      <Pressable
        role="link"
        accessibilityLabel={label}
        testID="account-button"
        onPress={() => router.push(routes.account)}
        {...webData({ kPress: 'scale', kHover: 'surface' })}
        style={{ width: theme.touchTarget, height: theme.touchTarget, borderRadius: theme.radius.press, alignItems: 'center', justifyContent: 'center' }}
      >
        <View
          style={{
            width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            backgroundColor: onField ? c.onField : c.primarySoft, borderWidth: 1.5, borderColor: onField ? c.onField2 : c.primary,
          }}
        >
          {initial ? (
            <Text weight="bold" style={{ color: onField ? c.field : c.primary, fontSize: 16, lineHeight: 20 }}>{initial}</Text>
          ) : (
            <UserRound size={18} color={onField ? c.field : c.primary} />
          )}
        </View>
      </Pressable>
    );
  }

  // No Firebase in this build: there is no account to sign in to, so no button that leads nowhere.
  if (!configured) return null;

  const signInStyle = {
    minHeight: theme.touchTarget, paddingHorizontal: 14, borderRadius: theme.radius.press,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    borderWidth: 1.5, borderColor: ring,
  };
  const signInContent = (
    <>
      <LogIn size={18} color={fg} strokeWidth={2} />
      <Text weight="semibold" style={{ color: fg }} numberOfLines={1}>{t('auth.button.signIn')}</Text>
    </>
  );

  if (restoring) {
    return (
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[signInStyle, { opacity: 0 }]}>
        {signInContent}
      </View>
    );
  }

  return (
    <>
      <Pressable
        role="button"
        testID="sign-in-button"
        aria-haspopup="dialog"
        accessibilityLabel={t('auth.button.signIn')}
        onPress={() => setOpen(true)}
        {...webData({ kPress: '', kHover: onField ? 'none' : 'surface' })}
        style={signInStyle}
      >
        {signInContent}
      </Pressable>
      <SignInSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
