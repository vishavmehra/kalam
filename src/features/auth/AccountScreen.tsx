import { router } from 'expo-router';
import { CloudOff, LogOut, ShieldCheck, Store, UserRound } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppShell } from '@/components/shell/AppShell';
import { routes } from '@/components/shell/routes';
import { useOnline } from '@/components/status/useHybridStatus';
import type { KalamUser } from '@/core/contracts';
import { Button, ConfirmSheet, EmptyState, LedgerRule, Screen, Stamp, Surface, Text, TextField, useKalamTheme, useToast } from '@/design';
import { bazaarRoutes } from '@/features/bazaar/routes';
import { useT } from '@/i18n/react';
import { getServices } from '@/services';

import { noteSignedOut } from './gate-notice';
import { SignInPanel } from './SignInPanel';
import { publicName, useAuthUser } from './use-auth';

/** /account: who is signed in, the name shown on shared apps, and sign-out (docs/04 §15.4, docs/11 §9). */
export function AccountScreen() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { user, restoring, configured } = useAuthUser();
  const online = useOnline();

  return (
    <AppShell active="account">
      <Screen maxWidth={760}>
        <View style={{ gap: 6, marginBottom: 28 }}>
          <Text variant="h1">{t('account.title')}</Text>
          <LedgerRule />
          <Text tone="secondary" style={{ marginTop: 10, maxWidth: 620 }}>{t('account.lede')}</Text>
        </View>

        <View style={{ gap: 32 }}>
          {!configured ? (
            <EmptyState title={t('account.notConfiguredTitle')} description={t('account.notConfiguredBody')} />
          ) : restoring ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text tone="secondary">{t('account.checking')}</Text>
            </View>
          ) : user && !user.isAnonymous ? (
            <Profile user={user} />
          ) : (
            <View style={{ gap: 16 }}>
              {!online ? <Notice icon={<CloudOff size={18} color={theme.colors.graphite} />} text={t('auth.gate.offline')} /> : null}
              <Surface padded={24} style={{ gap: 16 }}>
                <Text variant="h3" level={2}>{t('auth.sheet.title')}</Text>
                <SignInPanel initialMode={user?.isAnonymous ? 'signup' : 'signin'} />
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
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const [name, setName] = useState(publicName(user));
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  useEffect(() => setName(publicName(user)), [user]);
  const initial = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
  const changed = name.trim() !== publicName(user);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const r = await getServices().auth.setDisplayName(name);
    setSaving(false);
    toast.show(r.ok ? { message: t('account.nameSaved'), tone: 'success' } : { message: t('account.nameFailed'), tone: 'danger' });
  };

  return (
    <View style={{ gap: 16 }}>
      <Surface padded={24} style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primarySoft, borderWidth: 1.5, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="h3" level={0} tone="primary">{initial}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h4" level={2} numberOfLines={1}>{user.displayName || t('account.noName')}</Text>
            {user.email ? <Text tone="secondary" numberOfLines={1}>{user.email}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {user.providers.map((p) => (
                <Stamp key={p} kind="plain" size="sm" icon={null} label={p === 'google.com' ? t('account.viaGoogle') : p === 'password' ? t('account.viaEmail') : p} />
              ))}
            </View>
          </View>
        </View>
        <View style={{ gap: 12 }}>
          <TextField
            label={t('account.nameLabel')}
            helper={t('account.nameHelp')}
            icon={UserRound}
            value={name}
            onChangeText={setName}
            maxLength={40}
          />
          {changed ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label={t('account.saveName')} onPress={save} loading={saving} disabled={!name.trim()} />
            </View>
          ) : null}
        </View>
      </Surface>

      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Button label={t('account.studio')} icon={Store} variant="outline" onPress={() => router.push(bazaarRoutes.mine)} />
        <Button label={t('account.library')} variant="ghost" onPress={() => router.push(bazaarRoutes.library)} />
        <Button label={t('account.bazaar')} variant="ghost" onPress={() => router.push(routes.bazaar)} />
        <Button
          label={t('account.signOut')}
          icon={LogOut}
          variant="ghost"
          loading={signingOut}
          accessibilityHint={t('account.signOutHint')}
          onPress={() => setConfirmOut(true)}
        />
      </View>
      <ConfirmSheet
        visible={confirmOut}
        title={t('account.signOutConfirm.title')}
        message={t('account.signOutConfirm.message')}
        confirmLabel={t('account.signOut')}
        onCancel={() => setConfirmOut(false)}
        onConfirm={async () => {
          setSigningOut(true);
          await getServices().auth.signOut().catch(() => {});
          setSigningOut(false);
          setConfirmOut(false);
          noteSignedOut(); // the sign-in screen says it, so nothing sits on top of its logo
        }}
      />
    </View>
  );
}

function PrivacyNote() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={20} color={theme.colors.primary} />
        <Text variant="h3" level={2}>{t('account.storesTitle')}</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Bullet>{t('account.stores1')}</Bullet>
        <Bullet>{t('account.stores2')}</Bullet>
        <Bullet>{t('account.stores3')}</Bullet>
        <Bullet>{t('account.stores4')}</Bullet>
      </View>
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.mark, marginTop: 9 }} />
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
