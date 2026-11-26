/** Photo component: pick an image, optionally run its AI block, show where the AI actually ran. */
import { Camera } from 'lucide-react-native';
import { memo } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import type { AIImage } from '@/core/contracts';
import type { ComponentOf } from '@/core/spec/schema';
import type { RuntimeTheme } from '../engine/theme';
import type { ExecutionBadge } from '../engine/types';
import { useComponentBounds } from '../layout';
import { useAppT } from '../use-app-t';
import { font, Pressy, SourceBadge } from './kit';

export interface AIRunStatus {
  phase: 'running' | 'done' | 'failed';
  badge?: ExecutionBadge;
  message?: string;
  latencyMs?: number;
}

export const PhotoBlock = memo(function PhotoBlock({ c, t, image, status, disabled, onPick }: {
  c: ComponentOf<'photo'>; t: RuntimeTheme; image?: AIImage; status?: AIRunStatus; disabled: boolean; onPick(): void;
}) {
  const bounds = useComponentBounds(c.id);
  const tr = useAppT();
  const running = status?.phase === 'running';
  return (
    <View {...bounds} style={{ gap: 8 }}>
      <Pressy
        accessibilityRole="button"
        accessibilityLabel={c.a11yLabel ?? c.label}
        accessibilityHint={c.a11yDescription ?? tr(c.aiBlock ? 'runtime.photo.hintAi' : 'runtime.photo.hint')}
        accessibilityState={{ busy: running, disabled: disabled || running }}
        disabled={disabled || running}
        onPress={onPick}
        style={[
          styles.zone,
          {
            minHeight: Math.max(t.target, 64),
            borderRadius: t.radius,
            borderColor: t.highContrast ? t.colors.text : t.colors.primaryText,
            borderWidth: Math.max(1.5, t.borderWidth),
            backgroundColor: t.colors.primarySoft,
            padding: t.space * 0.75,
          },
        ]}
      >
        {image ? (
          <Image
            alt=""
            source={{ uri: `data:${image.mimeType};base64,${image.base64}` }}
            accessibilityIgnoresInvertColors
            style={{ width: 56, height: 56, borderRadius: Math.min(t.radius, 12) }}
          />
        ) : (
          <View style={[styles.icon, { backgroundColor: t.colors.surface, borderRadius: Math.min(t.radius, 12) }]}>
            <Camera size={24 * t.fontScale} color={t.colors.primaryText} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font(t, 16, '600'), { color: t.colors.text }]}>{c.label}</Text>
          <Text style={[font(t, 13), { color: t.colors.textMuted }]}>
            {running ? tr('runtime.photo.reading') : image ? tr('runtime.photo.another') : tr('runtime.photo.choose')}
          </Text>
        </View>
        {running ? <ActivityIndicator color={t.colors.primaryText} /> : null}
      </Pressy>
      {status?.badge && !running ? (
        <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
          <SourceBadge t={t} source={status.badge} detail={status.latencyMs ? `${Math.round(status.latencyMs)} ms` : undefined} />
          {status.phase === 'failed' && status.message ? (
            <Text style={[font(t, 13), { color: t.colors.textMuted }]}>{status.message}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  zone: { flexDirection: 'row', alignItems: 'center', gap: 12, borderStyle: 'dashed' },
  icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
