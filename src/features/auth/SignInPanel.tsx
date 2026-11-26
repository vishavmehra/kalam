import { CircleAlert, KeyRound, Mail, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { AuthErrorCode, AuthResult, KalamUser } from '@/core/contracts';
import { Button, SegmentedControl, Text, TextField, useKalamTheme, webData } from '@/design';
import { useT } from '@/i18n/react';
import { getServices } from '@/services';

export interface SignInPanelProps {
  /** Start on "Create account". */
  initialMode?: 'signin' | 'signup';
  onDone?: (user: KalamUser) => void;
}

const ERROR_KEY: Record<AuthErrorCode, `auth.errors.${AuthErrorCode}`> = {
  not_configured: 'auth.errors.not_configured',
  offline: 'auth.errors.offline',
  cancelled: 'auth.errors.cancelled',
  invalid_credentials: 'auth.errors.invalid_credentials',
  email_in_use: 'auth.errors.email_in_use',
  weak_password: 'auth.errors.weak_password',
  invalid_email: 'auth.errors.invalid_email',
  popup_blocked: 'auth.errors.popup_blocked',
  unsupported: 'auth.errors.unsupported',
  too_many_requests: 'auth.errors.too_many_requests',
  not_allowed: 'auth.errors.not_allowed',
  unauthorized_domain: 'auth.errors.unauthorized_domain',
  requires_recent_login: 'auth.errors.requires_recent_login',
  unknown: 'auth.errors.unknown',
};

/** Google's "G", in its own four colours, as Google asks sign-in buttons to show it. Decorative. */
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

/**
 * Sign-in choices, in the owner's order: Continue with Google first, then email sign-in and sign-up. There is
 * no guest. Errors are plain sentences.
 */
export function SignInPanel({ initialMode = 'signin', onDone }: SignInPanelProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const t = useT(theme.uiLanguage);
  const auth = getServices().auth;
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const google = auth.supportsGoogle();

  const finish = (r: AuthResult) => {
    setBusy(null);
    if (r.ok && r.user) {
      setError(null);
      onDone?.(r.user);
    } else if (r.errorCode !== 'cancelled') {
      setError(t(ERROR_KEY[r.errorCode ?? 'unknown']));
    }
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.errors.missing'));
      return;
    }
    setBusy('email');
    finish(mode === 'signup'
      ? await auth.signUpWithEmail(email, password, name)
      : await auth.signInWithEmail(email, password));
  };

  const divider = (label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
      <Text variant="caption" tone="muted">{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
    </View>
  );

  return (
    <View style={{ gap: 18 }}>
      {google ? (
        <>
          <Pressable
            role="button"
            testID="sign-in-google"
            aria-disabled={!!busy}
            accessibilityState={{ disabled: !!busy, busy: busy === 'google' }}
            onPress={busy ? undefined : async () => { setBusy('google'); finish(await auth.signInWithGoogle()); }}
            {...webData({ kPress: '', kHover: busy ? 'none' : 'surface' })}
            style={{
              minHeight: Math.max(54, theme.touchTarget), borderRadius: theme.radius.press,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20,
              backgroundColor: c.surfaceElevated, borderWidth: 1.5, borderColor: c.borderStrong,
              opacity: busy && busy !== 'google' ? 0.5 : 1,
            }}
          >
            <GoogleMark />
            <Text weight="semibold" style={{ fontSize: Math.round(17 * theme.fontScale) }}>
              {busy === 'google' ? t('auth.googleBusy') : t('auth.google')}
            </Text>
          </Pressable>
          {divider(t('auth.orEmail'))}
        </>
      ) : null}

      <SegmentedControl
        label={t('auth.modeLabel')}
        labelHidden
        value={mode}
        onChange={(m) => { setMode(m); setError(null); }}
        options={[{ value: 'signin', label: t('auth.signIn') }, { value: 'signup', label: t('auth.createAccount') }]}
      />
      {mode === 'signup' ? (
        <TextField
          label={t('auth.name')}
          helper={t('auth.nameHelp')}
          icon={UserRound}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          maxLength={40}
        />
      ) : null}
      <TextField
        label={t('auth.email')}
        icon={Mail}
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="email"
      />
      <TextField
        label={t('auth.password')}
        helper={mode === 'signup' ? t('auth.passwordHelp') : undefined}
        icon={KeyRound}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        autoCapitalize="none"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? (
        <View role="alert" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: theme.radius.paper, backgroundColor: c.dangerSoft }}>
          <CircleAlert size={18} color={c.danger} style={{ marginTop: 2 }} />
          <Text tone="danger" style={{ flex: 1 }}>{error}</Text>
        </View>
      ) : null}
      <Button
        label={mode === 'signup' ? t('auth.createAccount') : t('auth.signInEmail')}
        variant="primary"
        size="lg"
        loading={busy === 'email'}
        disabled={!!busy}
        fullWidth
        onPress={submit}
      />
    </View>
  );
}
