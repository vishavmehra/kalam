/**
 * AI blocks (docs/07 §13): what each block does, where it runs, and a "Verify on this device"
 * check whose result is saved into the spec as a new version.
 */
import { ShieldCheck } from 'lucide-react-native';
import { View } from 'react-native';
import type { AIBlockVerificationOutcome } from '@/core/contracts';
import type { KalamSpec } from '@/core/spec/schema';
import { Button, Chip, Surface, Text } from '@/design';
import { blockKindLabel, humanize } from './edit-model';

export interface BlockCheck {
  running: boolean;
  outcome?: AIBlockVerificationOutcome;
  error?: string;
}

const STATUS = {
  onDevice: { label: 'Runs on this device', tone: 'success' },
  cloudPreferred: { label: 'Prefers the cloud', tone: 'info' },
  unverified: { label: 'Not verified', tone: 'neutral' },
} as const;

export function AIBlocksPanel({ spec, checks, blocked, onVerify }: {
  spec: KalamSpec;
  checks: Record<string, BlockCheck>;
  blocked: boolean;
  onVerify(blockId: string): void;
}) {
  const blocks = Object.entries(spec.aiBlocks);
  if (!blocks.length) {
    return (
      <Text tone="secondary">
        This app doesn't use AI. Everything in it runs with ordinary app logic, on this device.
      </Text>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Text variant="bodySmall" tone="secondary">
        A check writes five sample cases online, then runs them with this device's own AI model. If at least four pass, the block runs on this device, even offline.
      </Text>
      {blocked ? (
        <Text variant="bodySmall" tone="muted">Keep or discard the proposed change before running a check.</Text>
      ) : null}
      {blocks.map(([id, block]) => {
        const check = checks[id];
        const s = STATUS[block.verified];
        const v = block.verification;
        return (
          <Surface key={id} padded style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text variant="h4" style={{ flexShrink: 1 }}>{humanize(id)}</Text>
              <Chip label={s.label} tone={s.tone} />
            </View>
            <Text variant="bodySmall" tone="secondary">{blockKindLabel(block.kind)}</Text>
            <Text variant="bodySmall" tone="muted" numberOfLines={2}>“{block.prompt}”</Text>
            {v ? (
              <Text variant="caption" tone="muted" numeric>
                Last check: {v.passCount} of {v.testCount} passed{v.model ? ` with ${v.model}` : ''}
              </Text>
            ) : null}
            {check?.outcome ? (
              <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
                <Text variant="bodySmall" weight="semibold" numeric>
                  {check.outcome.passCount} of {check.outcome.testCount} passed: {STATUS[check.outcome.status].label.toLowerCase()}
                </Text>
                {check.outcome.message ? <Text variant="bodySmall" tone="secondary">{check.outcome.message}</Text> : null}
              </View>
            ) : null}
            {check?.error ? <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite">{check.error}</Text> : null}
            <Button
              label="Verify on this device"
              variant="secondary"
              size="sm"
              icon={ShieldCheck}
              loading={check?.running}
              disabled={blocked || Object.values(checks).some((c) => c.running)}
              onPress={() => onVerify(id)}
              style={{ alignSelf: 'flex-start' }}
            />
          </Surface>
        );
      })}
    </View>
  );
}
