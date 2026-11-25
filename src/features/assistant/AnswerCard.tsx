import { Info } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';

import { fontFamilies, SourceBadge, Surface, Text, useKalamTheme } from '@/design';

import type { Exchange } from './use-assistant';

/** One question and its answer: the words, the formula when there is one, and where it came from. */
export function AnswerCard({ item }: { item: Exchange }) {
  const theme = useKalamTheme();
  const a = item.answer;
  const numbered = !!a?.text.endsWith(':');
  return (
    <Surface padded={16} style={{ gap: 10 }} role="article">
      <Text variant="bodySmall" weight="medium" tone="secondary">{item.question}</Text>

      {!a ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="progressbar" accessibilityLabel="Working out your answer">
          <ActivityIndicator color={theme.colors.primary} />
          <Text tone="secondary">Working it out</Text>
        </View>
      ) : a.kind === 'refused' ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Info size={18} color={theme.colors.textMuted} style={{ marginTop: 2 }} />
          <Text tone="secondary" style={{ flex: 1 }}>{a.text}</Text>
        </View>
      ) : (
        <>
          <Text variant={a.kind === 'calculation' ? 'bodyLarge' : 'body'} weight={a.kind === 'calculation' ? 'semibold' : undefined}>{a.text}</Text>
          {a.lines?.length ? (
            <View style={{ gap: 6 }}>
              {a.lines.map((line, i) => (
                <View key={`${i}-${line}`} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text tone="muted" style={{ width: 20 }} numeric>{numbered ? `${i + 1}.` : '•'}</Text>
                  <Text style={{ flex: 1 }}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {a.formula ? (
            <View style={{ gap: 4 }}>
              <Text variant="caption" tone="muted">Formula</Text>
              <Surface tone="alt" bordered={false} padded={10} radius="md">
                <Text selectable variant="bodySmall" style={{ fontFamily: fontFamilies.mono }}>{a.formula}</Text>
              </Surface>
            </View>
          ) : null}
          {a.badge ? <SourceBadge source={a.source} label={a.badge} /> : null}
        </>
      )}
    </Surface>
  );
}
