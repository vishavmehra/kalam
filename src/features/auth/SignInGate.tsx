import { CloudOff, LogOut, ShieldCheck } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOnline } from '@/components/status/useHybridStatus';
import { LedgerRule, Logo, Seal, Text, useBreakpoint, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

import { clearSignedOutNote, useSignedOutNote } from './gate-notice';
import { SignInPanel } from './SignInPanel';
import { useAuthUser } from './use-auth';

/**
 * The full-screen sign-in that stands in front of every route (owner, 2026-11-25). Google first, then email
 * sign-in and sign-up, no guest. The privacy sentence sits above the form so it is read without scrolling.
 * On wide screens the left third is the ink field with three plain facts; phones show the form alone.
 */
export function SignInGate() {
  const theme = useKalamTheme();
  const c = theme.colors;
  const t = useT(theme.uiLanguage);
  const insets = useSafeAreaInsets();
  const { width, isPhone } = useBreakpoint();
  const online = useOnline();
  const { user } = useAuthUser();
  const signedOut = useSignedOutNote();
  useEffect(() => clearSignedOutNote, []); // gone for good once the gate closes
  const wide = width >= 900;
  const gutter = isPhone ? 16 : 32;

  return (
    <View testID="sign-in-gate" style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: c.background }}>
      {wide ? (
        <View style={{ flex: 5, backgroundColor: c.field, justifyContent: 'center', padding: 56, paddingTop: 56 + insets.top, gap: 28 }}>
          <Text variant="display" level={0} style={{ color: c.onField, maxWidth: 420 }}>{t('app.tagline')}</Text>
          <View style={{ gap: 14, maxWidth: 420 }}>
            {(['auth.gate.fact1', 'auth.gate.fact2', 'auth.gate.fact3'] as const).map((k) => (
              <View key={k} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <View style={{ width: 8, height: 8, marginTop: 9, backgroundColor: c.accent }} />
                <Text style={{ color: c.onField2, flex: 1 }}>{t(k)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <ScrollView
        style={{ flex: wide ? 6 : 1 }}
        contentContainerStyle={{
          flexGrow: 1, alignItems: 'center', justifyContent: wide ? 'center' : 'flex-start',
          paddingHorizontal: gutter, paddingTop: insets.top + (isPhone ? 20 : 40), paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth: 440, gap: 18 }}>
          <Logo size={isPhone ? 30 : 36} compact={isPhone} />
          <View style={{ gap: 6 }}>
            <Text variant="h1" accessibilityRole="header">{t('auth.gate.title')}</Text>
            <LedgerRule />
          </View>
          {signedOut ? (
            <View role="status" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: theme.radius.paper, backgroundColor: c.graphiteSoft }}>
              <LogOut size={18} color={c.graphite} />
              <Text variant="bodySmall" style={{ flex: 1 }}>{t('account.signedOut')}</Text>
            </View>
          ) : null}
          <Text tone="secondary">{t('auth.gate.lede')}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <ShieldCheck size={18} color={c.primary} style={{ marginTop: 2 }} />
            <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>{t('auth.sheet.privacy')}</Text>
          </View>
          {!online ? (
            <View role="status" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: theme.radius.paper, backgroundColor: c.graphiteSoft }}>
              <CloudOff size={18} color={c.graphite} />
              <Text variant="bodySmall" style={{ flex: 1 }}>{t('auth.gate.offline')}</Text>
            </View>
          ) : null}
          <SignInPanel initialMode={user?.isAnonymous ? 'signup' : 'signin'} />
        </View>
      </ScrollView>
    </View>
  );
}

/** The quiet moment while a saved session is read from this device. Shown instead of the form, never with it. */
export function SignInChecking() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <View testID="sign-in-checking" role="status" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: theme.colors.background }}>
      <Seal size={56} />
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text tone="secondary">{t('auth.gate.checking')}</Text>
      </View>
    </View>
  );
}
