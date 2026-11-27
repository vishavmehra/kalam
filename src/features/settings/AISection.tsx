import { CircleAlert, CircleCheck, Cloud, Download, ShieldCheck, Smartphone, Wifi, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { describeOnDevice, useAIStatus, useOnline } from '@/components/status/useHybridStatus';
import type { KalamSettings } from '@/core/contracts';
import { Button, RadioGroup, Stamp, SwitchRow, Text, useKalamTheme, useToast } from '@/design';
import { ShareViewsRow } from '@/features/bazaar-moderation/ShareViewsRow';
import { useT } from '@/i18n/react';
import { appCheckStatus } from '@/infrastructure/firebase/app';
import { getServices } from '@/services';

import { Divider, Section, StatusRow } from './Section';

type Update = (patch: Partial<KalamSettings>) => void;

const ios = Platform.OS === 'ios';

/**
 * AI and privacy (DIRECTION §6): the three routes as stamps with one honest sentence each, the hybrid or
 * offline-only choice and cloud consent, on-device model preparation, and Firebase and App Check status.
 * iOS names Apple Intelligence instead of Gemini Nano (I1).
 */
export function AISection({ settings, set }: { settings: KalamSettings; set: Update }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const t = useT(theme.uiLanguage);
  const toast = useToast();
  const online = useOnline();
  const { status, error, refresh } = useAIStatus();
  const [progress, setProgress] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const offlineOnly = settings.aiMode === 'offline_only';
  const od = describeOnDevice(status?.onDevice);
  const ac = status ? appCheckStatus() : null;
  // Firebase starts lazily (first cloud request), so "not_configured" without a detail means "not started yet".
  const acPending = ac?.status === 'not_configured' && !ac.detail && !!process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY;

  // Must be called straight from the press handler: Chrome only downloads Gemini Nano after a user gesture.
  const prepare = () => {
    setPreparing(true);
    setProgress(null);
    getServices().ai.prepareOnDevice((p) => setProgress(p > 1 ? p / 100 : p))
      .then(async (s) => {
        await refresh();
        toast.show(s.availability === 'available'
          ? { message: t('settings.ai.readyToast'), tone: 'success' }
          : { message: s.detail ?? t('settings.ai.unavailableToast'), tone: 'info' });
      })
      .catch(() => toast.show({ message: t('settings.ai.prepareFailed'), tone: 'danger' }))
      .finally(() => { setPreparing(false); setProgress(null); });
  };

  const okIcon = (ok: boolean) => ok ? <CircleCheck size={16} color={c.success} /> : <CircleAlert size={16} color={c.warning} />;
  const acLabel = (s: string): string => {
    switch (s) {
      case 'active': return t('settings.cloud.acActive');
      case 'debug': return t('settings.cloud.acDebug');
      case 'not_configured': return t('settings.cloud.acNotConfigured');
      case 'unsupported_on_platform': return t('settings.cloud.acUnsupported');
      case 'error': return t('settings.cloud.acError');
      default: return s;
    }
  };
  const pct = progress != null ? Math.round(progress * 100) : 0;

  return (
    <>
      <Section title={t('settings.ai.title')} description={t('settings.ai.intro')} testID="settings-ai">
        <View style={{ gap: 14, paddingVertical: 8 }}>
          {([
            ['template', 'stamp.template', 'settings.ai.routeTemplate'],
            ['device', 'stamp.device', ios ? 'settings.ai.routeDeviceIos' : 'settings.ai.routeDevice'],
            ['cloud', 'stamp.cloud', 'settings.ai.routeCloud'],
          ] as const).map(([kind, label, line]) => (
            <View key={kind} style={{ flexDirection: theme.compact ? 'column' : 'row', gap: theme.compact ? 6 : 14, alignItems: theme.compact ? 'flex-start' : 'center' }}>
              <View style={{ width: theme.compact ? undefined : 132 }}><Stamp kind={kind} label={t(label)} /></View>
              <Text tone="secondary" style={{ flex: theme.compact ? undefined : 1 }}>{t(line)}</Text>
            </View>
          ))}
        </View>
        <Divider />
        <View style={{ paddingVertical: 8 }}>
          <RadioGroup
            label={t('settings.ai.mode')}
            value={settings.aiMode}
            onChange={(v) => set({ aiMode: v })}
            testID="settings-ai-mode"
            options={[
              { value: 'hybrid', label: t('settings.ai.hybrid'), description: t('settings.ai.hybridHint') },
              { value: 'offline_only', label: t('settings.ai.offlineOnly'), description: t('settings.ai.offlineOnlyHint') },
            ]}
          />
        </View>
        <Divider />
        <SwitchRow
          icon={Cloud}
          label={t('settings.ai.useCloud')}
          description={t(ios ? 'settings.ai.useCloudHintIos' : 'settings.ai.useCloudHint')}
          value={settings.allowCloud && !offlineOnly}
          disabled={offlineOnly}
          onValueChange={(v) => set({ allowCloud: v })}
        />
        <SwitchRow
          icon={ShieldCheck}
          label={t('settings.ai.specialists')}
          description={t('settings.ai.specialistsHint')}
          value={settings.allowExternalProviders && settings.allowCloud && !offlineOnly}
          disabled={offlineOnly || !settings.allowCloud}
          onValueChange={(v) => set({ allowExternalProviders: v })}
        />
        {/* Off until chosen: one anonymous count when someone opens a Bazaar listing (no name, account or device). */}
        <ShareViewsRow />
      </Section>

      <Section title={t('settings.ai.onDevice')} description={t(ios ? 'settings.ai.onDeviceIntroIos' : 'settings.ai.onDeviceIntro')} testID="settings-on-device-ai">
        <StatusRow
          label={t('settings.ai.status')}
          value={error ? t('settings.ai.checkFailed') : od.label}
          detail={error ? undefined : status?.onDevice.detail}
          icon={<Smartphone size={16} color={od.ready ? c.sourceOnDevice : c.textMuted} />}
        />
        <StatusRow
          label={t('settings.ai.platform')}
          value={status ? t(status.onDevice.apiExposed ? 'settings.ai.apiFound' : 'settings.ai.apiMissing', { platform: status.onDevice.platform }) : '…'}
        />
        {/* iOS gets its model from the system; preparing only re-reports status there (I1). */}
        {od.ready || ios ? null : (
          <View style={{ gap: 10, paddingTop: 14 }}>
            <Button
              label={preparing ? t('settings.ai.preparing') : t('settings.ai.prepare')}
              icon={Download}
              variant="secondary"
              onPress={prepare}
              loading={preparing}
              disabled={status?.onDevice.availability === 'unavailable'}
            />
            {progress != null ? (
              <View style={{ gap: 6 }} accessible role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} accessibilityLabel={t('settings.ai.progressLabel')}>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: c.primarySoft, overflow: 'hidden' }}>
                  <View style={{ width: `${pct}%`, height: 8, backgroundColor: c.primary, borderRadius: 4 }} />
                </View>
                <Text variant="bodySmall" tone="secondary" numeric>{t('settings.ai.downloading', { percent: pct })}</Text>
              </View>
            ) : null}
            <Text variant="bodySmall" tone="muted">
              {status?.onDevice.availability === 'unavailable' ? t('settings.ai.cannotRun') : t('settings.ai.downloadNote')}
            </Text>
          </View>
        )}
      </Section>

      <Section title={t('settings.cloud.title')} description={t('settings.cloud.intro')}>
        <StatusRow
          label={t('settings.cloud.network')}
          value={online ? t('network.online') : t('network.offline')}
          icon={online ? <Wifi size={16} color={c.textSecondary} /> : <WifiOff size={16} color={c.sourceOffline} />}
        />
        <StatusRow
          label="Firebase AI Logic"
          value={status ? (status.cloudConfigured ? t('settings.cloud.configured') : t('settings.cloud.notConfigured')) : '…'}
          icon={status ? okIcon(status.cloudConfigured) : undefined}
          detail={status && !status.cloudConfigured ? t('settings.cloud.firebaseHint') : undefined}
        />
        <StatusRow
          label="App Check"
          value={!ac ? '…' : acPending ? t('settings.cloud.acPending') : acLabel(ac.status)}
          icon={ac ? okIcon(acPending || ac.status === 'active' || ac.status === 'debug') : undefined}
          detail={ac?.detail ?? t('settings.cloud.appCheckHint')}
        />
        <StatusRow
          label={t('settings.cloud.specialists')}
          value={status ? (status.specialistConfigured ? t('settings.cloud.specialistsOn') : t('settings.cloud.specialistsOff')) : '…'}
          icon={status ? okIcon(status.specialistConfigured) : undefined}
        />
      </Section>
    </>
  );
}
