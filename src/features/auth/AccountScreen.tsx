import { router } from 'expo-router';
import { CloudOff, Heart, LogOut, ShieldCheck, Store, UserRound } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { bazaarRoutes } from '@/features/bazaar/routes';
import { useOnline } from '@/components/status/useHybridStatus';
import type { KalamUser } from '@/core/contracts';
import { Button, Chip, EmptyState, Screen, Surface, Text, TextField, useKalamTheme, useToast } from '@/design';
import { getServices } from '@/services';

import { SignInPanel } from './SignInPanel';
import { publicName, useAuthUser } from './use-auth';

const PROVIDER_LABELS: Record<string, string> = { password: 'email', 'google.com': 'Google' };

/** /account: optional account for Kalam Bazaar. Apps never need it (docs/04 §15.4, docs/11 §9). */
export function AccountScreen() {
  const theme = useKalamTheme();
  const { user, restoring, configured } = useAuthUser();
  const online = useOnline();

  return (
    <AppShell active="account">
      <Screen maxWidth={760}>
        <View style={{ gap: 6, marginBottom: 28 }}>
          <Text variant="h1">Account</Text>
          <Text tone="secondary">
            You do not need an account to make or use apps. An account lets you share apps in Kalam Bazaar and like other people's apps.
          </Text>
        </View>

        <View style={{ gap: 32 }}>
          {!configured ? (
            <EmptyState
              title="Accounts are not set up in this build"
              description="Your apps work the same without one. Kalam Bazaar needs Firebase to be configured."
            />
          ) : restoring ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text tone="secondary">Checking your account</Text>
            </View>
          ) : user && !user.isAnonymous ? (
            <Profile user={user} />
          ) : (
            <View style={{ gap: 16 }}>
              {!online ? (
                <Notice icon={<CloudOff size={18} color={theme.colors.warning} />} text="You are offline. You can sign in when you are back online. Your apps still work." />
              ) : null}
              {user?.isAnonymous ? <GuestCard /> : null}
              <Surface padded={24} style={{ gap: 16 }}>
                <Text variant="h3">{user?.isAnonymous ? 'Add your email' : 'Sign in or create an account'}</Text>
                {user?.isAnonymous ? (
                  <Text tone="secondary">Keep your likes and start sharing apps. Your guest likes move to the new account.</Text>
                ) : null}
                <SignInPanel initialMode={user?.isAnonymous ? 'signup' : 'signin'} allowGuest={!user} />
              </Surface>
            </View>
          )}

          <PrivacyNote />
        </View>
      </Screen>
    </AppShell>
  );
}

function Profile({ user }: { user: KalamUser }) {
  const theme = useKalamTheme();
  const toast = useToast();
  const [name, setName] = useState(publicName(user));
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => setName(publicName(user)), [user]);
  const initial = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
  const changed = name.trim() !== publicName(user);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const r = await getServices().auth.setDisplayName(name);
    setSaving(false);
    toast.show(r.ok ? { message: 'Name saved.', tone: 'success' } : { message: r.message ?? 'Could not save your name.', tone: 'danger' });
  };

  return (
    <View style={{ gap: 16 }}>
      <Surface padded={24} style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="h3" tone="primary">{initial}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h4" numberOfLines={1}>{user.displayName || 'No name yet'}</Text>
            {user.email ? <Text tone="secondary" numberOfLines={1}>{user.email}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {user.providers.map((p) => <Chip key={p} label={`Signed in with ${PROVIDER_LABELS[p] ?? p}`} tone="neutral" />)}
            </View>
          </View>
        </View>
        <View style={{ gap: 12 }}>
          <TextField
            label="Name shown on apps you share"
            helper="People see this name in Kalam Bazaar. Your email stays private."
            icon={UserRound}
            value={name}
            onChangeText={setName}
            maxLength={40}
          />
          {changed ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label="Save name" onPress={save} loading={saving} disabled={!name.trim()} />
            </View>
          ) : null}
        </View>
      </Surface>

      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Button label="Creator Studio" icon={Store} variant="outline" onPress={() => router.push(bazaarRoutes.mine)} />
        <Button label="My library" variant="ghost" onPress={() => router.push(bazaarRoutes.library)} />
        <Button label="Go to Kalam Bazaar" variant="ghost" onPress={() => router.push(routes.bazaar)} />
        <Button
          label="Sign out"
          icon={LogOut}
          variant="ghost"
          loading={signingOut}
          accessibilityHint="Your apps stay on this device."
          onPress={async () => {
            setSigningOut(true);
            await getServices().auth.signOut().catch(() => {});
            setSigningOut(false);
            toast.show({ message: 'Signed out. Your apps are still on this device.', tone: 'info' });
          }}
        />
      </View>
    </View>
  );
}

function GuestCard() {
  const theme = useKalamTheme();
  const toast = useToast();
  return (
    <Surface tone="alt" padded={20} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Heart size={18} color={theme.colors.accent} />
        <Text variant="h4">You are using Kalam Bazaar as a guest</Text>
      </View>
      <Text tone="secondary">
        Guests can like and report apps. To share your own apps, add an email or sign in with Google. If you sign out as a guest, your likes cannot be recovered.
      </Text>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          label="Sign out of guest account"
          variant="ghost"
          size="sm"
          onPress={async () => {
            await getServices().auth.signOut().catch(() => {});
            toast.show({ message: 'Signed out.', tone: 'info' });
          }}
        />
      </View>
    </Surface>
  );
}

function PrivacyNote() {
  const theme = useKalamTheme();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={20} color={theme.colors.primary} />
        <Text variant="h3">What an account stores</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Bullet>Your email and the name you choose. Firebase Authentication uses them to sign you in.</Bullet>
        <Bullet>Your apps and everything you type into them stay on this device. Signing in does not upload them.</Bullet>
        <Bullet>Apps you share in Kalam Bazaar are public. Only the app design is shared, never your records.</Bullet>
        <Bullet>Signing out keeps all your apps on this device.</Bullet>
      </View>
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textMuted, marginTop: 8 }} />
      <Text tone="secondary" style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

function Notice({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Surface tone="alt" padded={16} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
      {icon}
      <Text style={{ flex: 1 }}>{text}</Text>
    </Surface>
  );
}
