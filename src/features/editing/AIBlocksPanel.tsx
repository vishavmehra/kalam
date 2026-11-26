/**
 * AI blocks (docs/07 §13): what each block does, where it runs, and a "Check on this device"
 * run whose result is saved into the spec as a new version. Where a block runs is a stamp.
 */
import { ShieldCheck } from 'lucide-react-native';
import { View } from 'react-native';
import type { AIBlockVerificationOutcome } from '@/core/contracts';
import type { KalamAIBlockKind, KalamSpec } from '@/core/spec/schema';
import { Button, Slip, Stamp, type StampKind, Text, useKalamTheme } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';
import { humanize } from './edit-model';

export interface BlockCheck {
  running: boolean;
  outcome?: AIBlockVerificationOutcome;
  error?: string;
}

const STATUS: Record<AIBlockVerificationOutcome['status'], { label: TranslationKey; kind: StampKind }> = {
  onDevice: { label: 'edit.ai.status.onDevice', kind: 'device' },
  cloudPreferred: { label: 'edit.ai.status.cloud', kind: 'cloud' },
  unverified: { label: 'edit.ai.status.unverified', kind: 'needs' },
};

const KIND: Record<KalamAIBlockKind, TranslationKey> = {
  extractFromPhoto: 'edit.ai.kind.extractFromPhoto',
  classify: 'edit.ai.kind.classify',
  summarise: 'edit.ai.kind.summarise',
  translate: 'edit.ai.kind.translate',
};

export function AIBlocksPanel({ spec, checks, blocked, onVerify }: {
  spec: KalamSpec;
  checks: Record<string, BlockCheck>;
  blocked: boolean;
  onVerify(blockId: string): void;
}) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const blocks = Object.entries(spec.aiBlocks);
  if (!blocks.length) return <Text tone="secondary">{t('edit.ai.none')}</Text>;
  return (
    <View style={{ gap: 14 }}>
      <Text variant="bodySmall" tone="secondary">{t('edit.ai.explain')}</Text>
      {blocked ? <Text variant="bodySmall" tone="muted">{t('edit.ai.blocked')}</Text> : null}
      {blocks.map(([id, block]) => {
        const check = checks[id];
        const s = STATUS[block.verified];
        const v = block.verification;
        return (
          <Slip key={id} tint="violet" behind={theme.colors.surface}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text variant="h4" style={{ flexShrink: 1 }}>{humanize(id)}</Text>
              <Stamp kind={s.kind} label={t(s.label)} size="sm" />
            </View>
            <Text variant="bodySmall" tone="secondary">{t(KIND[block.kind])}</Text>
            <Text variant="bodySmall" tone="muted" numberOfLines={2}>“{block.prompt}”</Text>
            {v ? (
              <Text variant="caption" tone="muted" mono>
                {v.model ? t('edit.ai.lastCheckModel', { pass: v.passCount, total: v.testCount, model: v.model }) : t('edit.ai.lastCheck', { pass: v.passCount, total: v.testCount })}
              </Text>
            ) : null}
            {check?.outcome ? (
              <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
                <Text variant="bodySmall" weight="semibold" numeric>
                  {t('edit.ai.result', { pass: check.outcome.passCount, total: check.outcome.testCount, status: t(STATUS[check.outcome.status].label) })}
                </Text>
                {check.outcome.message ? <Text variant="bodySmall" tone="secondary">{check.outcome.message}</Text> : null}
              </View>
            ) : null}
            {check?.error ? <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite">{check.error}</Text> : null}
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                label={t('edit.ai.verify')}
                variant="secondary"
                size="sm"
                icon={ShieldCheck}
                loading={check?.running}
                disabled={blocked || Object.values(checks).some((c) => c.running)}
                onPress={() => onVerify(id)}
              />
            </View>
          </Slip>
        );
      })}
    </View>
  );
}
