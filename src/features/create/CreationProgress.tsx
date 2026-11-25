/**
 * Live compilation progress (docs/03 §12.2): the user's own inputs pulled into a phone screen
 * (three.js on web, the inked outline elsewhere), only the steps that really started, an honest
 * route indicator and Cancel.
 */
import { Check, Cloud, LayoutTemplate, Smartphone, Sparkles, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { announce, Button, Chip, Surface, Text, useBreakpoint, useKalamTheme } from '@/design';
import { draftModalities } from '@/features/input/normalize';
import { fragmentKinds } from '@/features/landing/scene/kinds';
import { selectDraft, useCreationStore } from '@/state/creation-store';

import { BuildStage } from './BuildStage';
import { inputParts, joinParts } from './input-summary';
import { liveRoute, type RouteBadge } from './stages';

const ROUTE_ICON: Record<RouteBadge, typeof Cloud> = {
  Template: LayoutTemplate, 'On-device': Smartphone, Cloud, Specialist: Sparkles, Checking: Check,
};
const ROUTE_TONE = { Template: 'neutral', 'On-device': 'success', Cloud: 'info', Specialist: 'accent', Checking: 'neutral' } as const;

export function CreationProgress({ onCancel }: { onCancel: () => void }) {
  const { colors, space } = useKalamTheme();
  const { isPhone } = useBreakpoint();
  const run = useCreationStore((s) => s.run);
  // Selectors return strings so the store snapshot stays stable between renders.
  const modalities = useCreationStore((s) => draftModalities(selectDraft(s)).join(','));
  const using = useCreationStore((s) => joinParts(inputParts(s)));
  const kinds = fragmentKinds(modalities ? (modalities.split(',') as Parameters<typeof fragmentKinds>[0]) : []);
  const route = liveRoute(run.stage, run.stageDetail);
  // Announce each new step once instead of re-reading the whole card (docs/10 §7.4).
  const activeStep = run.steps.find((st) => st.status === 'active')?.label;
  useEffect(() => { if (activeStep) announce(activeStep); }, [activeStep]);

  return (
    <Surface bordered padded={isPhone ? space[5] : space[8]} radius="xl">
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? space[4] : space[8], alignItems: isPhone ? 'center' : 'flex-start' }}>
        <BuildStage size={isPhone ? 120 : 150} kinds={kinds} />
        <View style={{ flex: isPhone ? undefined : 1, alignSelf: 'stretch', gap: space[4] }}>
          <View style={{ gap: space[2] }}>
            <Text variant="h3" display>Building your app</Text>
            <Text tone="secondary">
              {using ? `Reading your ${using}. ` : ''}Your inputs stay here, and you can cancel at any time.
            </Text>
          </View>
          {route ? (
            <View style={{ flexDirection: 'row' }}>
              <Chip label={`Route: ${route}`} icon={ROUTE_ICON[route]} tone={ROUTE_TONE[route]} />
            </View>
          ) : null}
          <View accessibilityRole="list" style={{ gap: space[3] }}>
            {run.steps.length === 0 ? (
              <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text tone="secondary">Getting your inputs ready</Text>
              </View>
            ) : run.steps.map((step) => (
              <View key={step.id} accessibilityRole="text" style={{ flexDirection: 'row', gap: space[3], alignItems: 'center', minHeight: 28 }}>
                {step.status === 'done'
                  ? <Check size={18} color={colors.success} accessibilityLabel="Done" />
                  : <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="In progress" />}
                <Text tone={step.status === 'done' ? 'secondary' : 'default'} weight={step.status === 'active' ? 'semibold' : 'regular'}>
                  {step.label}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', marginTop: space[2] }}>
            <Button label="Cancel" variant="outline" icon={X} onPress={onCancel} />
          </View>
        </View>
      </View>
    </Surface>
  );
}
