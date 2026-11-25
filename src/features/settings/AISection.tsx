import { CircleAlert, CircleCheck, Cloud, CloudOff, Download, ShieldCheck, Smartphone, Sparkles, Wifi, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { describeOnDevice, useAIStatus, useOnline } from '@/components/status/useHybridStatus';
import type { KalamSettings } from '@/core/contracts';
import { Button, SegmentedControl, SwitchRow, Text, useKalamTheme, useToast } from '@/design';
import { appCheckStatus } from '@/infrastructure/firebase/app';
import { getServices } from '@/services';

import { Divider, Section, StatusRow } from './Section';

type Update = (patch: Partial<KalamSettings>) => void;

/** AI & privacy consent, on-device model preparation, and Firebase / App Check status. */
export function AISection({ settings, set }: { settings: KalamSettings; set: Update }) {
  const theme = useKalamTheme();
  const c = theme.colors;
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
          ? { message: 'On-device AI is ready. Simple requests now stay on this device.', tone: 'success' }
          : { message: s.detail ?? 'On-device AI is not available on this device.', tone: 'info' });
      })
      .catch((e: unknown) => toast.show({ message: e instanceof Error ? e.message : 'Could not prepare on-device AI.', tone: 'danger' }))
      .finally(() => { setPreparing(false); setProgress(null); });
  };

  const okIcon = (ok: boolean) => ok ? <CircleCheck size={16} color={c.success} /> : <CircleAlert size={16} color={c.warning} />;
  const acLabel: Record<string, string> = {
    active: 'Active', debug: 'Active (debug token, development only)', not_configured: 'Not configured',
    unsupported_on_platform: 'Not available on this platform', error: 'Failed to start',
  };

  return (
    <>
      <Section
        title="AI and privacy"
        description="Kalam builds simple apps with templates and on-device AI first. Using your apps never needs the internet."
      >
        <View style={{ paddingVertical: 8 }}>
          <SegmentedControl
            label="When Kalam builds or edits an app"
            value={settings.aiMode}
            onChange={(v) => set({ aiMode: v })}
            options={[
              { value: 'hybrid', label: 'Hybrid', icon: Sparkles },
              { value: 'offline_only', label: 'Offline only', icon: CloudOff },
            ]}
          />
          <Text variant="bodySmall" tone="muted" style={{ marginTop: 8 }}>
            {offlineOnly
              ? 'Kalam never goes online. Requests that need a bigger model will explain why they cannot run.'
              : 'Kalam tries templates and on-device AI first, and only goes online for work that needs it.'}
          </Text>
        </View>
        <Divider />
        <SwitchRow
          icon={Cloud}
          label="Use cloud AI when needed"
          description="Complex apps and reading sketches use Gemini through Firebase. What you describe and any photo, drawing or recording you attach is sent. Records saved in your apps are never sent."
          value={settings.allowCloud && !offlineOnly}
          disabled={offlineOnly}
          onValueChange={(v) => set({ allowCloud: v })}
        />
        <SwitchRow
          icon={ShieldCheck}
          label="Allow specialist models"
          description="For rare, very hard requests, Kalam's server may ask Claude or Nebius models. Only your app description is sent, through Kalam's server. Your records and keys are never sent."
          value={settings.allowExternalProviders && settings.allowCloud && !offlineOnly}
          disabled={offlineOnly || !settings.allowCloud}
          onValueChange={(v) => set({ allowExternalProviders: v })}
        />
      </Section>

      <Section
        title="On-device AI"
        description="Gemini Nano runs inside the browser or phone. Nothing it handles leaves this device."
      >
        <StatusRow
          label="Status"
          value={error ? 'Could not check' : od.label}
          detail={error ?? status?.onDevice.detail}
          icon={<Smartphone size={16} color={od.ready ? c.sourceOnDevice : c.textMuted} />}
        />
        <StatusRow label="Platform" value={status ? (status.onDevice.apiExposed ? `${status.onDevice.platform}: on-device API found` : `${status.onDevice.platform}: no on-device API`) : '…'} />
        {od.ready ? null : (
          <View style={{ gap: 10, paddingTop: 14 }}>
            <Button
              label={preparing ? 'Preparing on-device AI' : 'Prepare on-device AI'}
              icon={Download}
              variant="secondary"
              onPress={prepare}
              loading={preparing}
              disabled={status?.onDevice.availability === 'unavailable'}
            />
            {progress != null ? (
              <View style={{ gap: 6 }} accessible role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} accessibilityLabel="Download progress">
                <View style={{ height: 8, borderRadius: 4, backgroundColor: c.primarySoft, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: 8, backgroundColor: c.primary, borderRadius: 4 }} />
                </View>
                <Text variant="bodySmall" tone="secondary" numeric>Downloading model: {Math.round(progress * 100)}%</Text>
              </View>
            ) : null}
            <Text variant="bodySmall" tone="muted">
              {status?.onDevice.availability === 'unavailable'
                ? 'This browser or device cannot run Gemini Nano. Kalam will use templates and, if you allow it, the cloud.'
                : 'The first download can be large and needs Wi-Fi. Afterwards it works offline.'}
            </Text>
          </View>
        )}
      </Section>

      <Section title="Cloud and security" description="How Kalam connects to Firebase when you allow cloud AI.">
        <StatusRow label="Network" value={online ? 'Online' : 'Offline'} icon={online ? <Wifi size={16} color={c.textSecondary} /> : <WifiOff size={16} color={c.sourceOffline} />} />
        <StatusRow
          label="Firebase AI Logic"
          value={status ? (status.cloudConfigured ? 'Configured' : 'Not configured') : '…'}
          icon={status ? okIcon(status.cloudConfigured) : undefined}
          detail={status && !status.cloudConfigured ? 'Add the EXPO_PUBLIC_FIREBASE_* values to enable cloud building.' : undefined}
        />
        <StatusRow
          label="App Check"
          value={!ac ? '…' : acPending ? 'Set up. Starts with the first cloud request' : acLabel[ac.status] ?? ac.status}
          icon={ac ? okIcon(acPending || ac.status === 'active' || ac.status === 'debug') : undefined}
          detail={ac?.detail ?? 'Proves requests come from the real Kalam app, so nobody else can spend its AI quota.'}
        />
        <StatusRow
          label="Specialist models"
          value={status ? (status.specialistConfigured ? 'Available through Kalam server' : 'Not set up') : '…'}
          icon={status ? okIcon(status.specialistConfigured) : undefined}
        />
      </Section>
    </>
  );
}
