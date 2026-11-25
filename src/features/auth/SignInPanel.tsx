import { KeyRound, Mail, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { AuthResult, KalamUser } from '@/core/contracts';
import { Button, SegmentedControl, Text, TextField, useKalamTheme } from '@/design';
import { getServices } from '@/services';

export interface SignInPanelProps {
  /** Start on "Create account" (used to upgrade a guest). */
  initialMode?: 'signin' | 'signup';
  /** Offer "Continue as a guest" (likes and reports only). */
  allowGuest?: boolean;
  onDone?: (user: KalamUser) => void;
}

/** Email/password, Google (web) and optional guest sign-in. Errors are plain sentences. */
export function SignInPanel({ initialMode = 'signin', allowGuest, onDone }: SignInPanelProps) {
  const theme = useKalamTheme();
  const auth = getServices().auth;
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | 'guest' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (r: AuthResult) => {
    setBusy(null);
    if (r.ok && r.user) {
      setError(null);
      onDone?.(r.user);
    } else if (r.errorCode !== 'cancelled') {
      setError(r.message ?? 'Sign-in did not work. Please try again.');
    }
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy('email');
    finish(mode === 'signup'
      ? await auth.signUpWithEmail(email, password, name)
      : await auth.signInWithEmail(email, password));
  };

  return (
    <View style={{ gap: 16 }}>
      {auth.supportsGoogle() ? (
        <>
          <Button
            label="Continue with Google"
            variant="outline"
            loading={busy === 'google'}
            disabled={!!busy}
            fullWidth
            onPress={async () => { setBusy('google'); finish(await auth.signInWithGoogle()); }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
            <Text variant="caption" tone="muted">or use email</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
          </View>
        </>
      ) : null}

      <SegmentedControl
        label="Account"
        labelHidden
        value={mode}
        onChange={(m) => { setMode(m); setError(null); }}
        options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]}
      />
      {mode === 'signup' ? (
        <TextField
          label="Your name"
          helper="Shown on apps you share. Your email is never shown."
          icon={UserRound}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          maxLength={40}
        />
      ) : null}
      <TextField
        label="Email"
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
        label="Password"
        helper={mode === 'signup' ? 'At least 6 characters.' : undefined}
        icon={KeyRound}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        autoCapitalize="none"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {error ? <Text tone="danger" role="alert">{error}</Text> : null}
      <Button
        label={mode === 'signup' ? 'Create account' : 'Sign in'}
        loading={busy === 'email'}
        disabled={!!busy}
        fullWidth
        onPress={submit}
      />
      {allowGuest ? (
        <Button
          label="Continue as a guest"
          variant="ghost"
          loading={busy === 'guest'}
          disabled={!!busy}
          accessibilityHint="Lets you like and report apps. You can add an email later."
          onPress={async () => { setBusy('guest'); finish(await auth.signInAsGuest()); }}
        />
      ) : null}
    </View>
  );
}
