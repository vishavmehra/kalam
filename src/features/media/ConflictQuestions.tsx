/**
 * Plain questions when inputs disagree (docs/06 §12.4-12.5, docs/16 R-019). Each answer is recorded as
 * a correction and sent with the request; a changed input asks again.
 */
import { View } from 'react-native';
import { Button, Chip, Stamp, Surface, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';
import { conflictCopy } from '@/core/media/copy';
import { answerConflictQuestion } from './media-actions';
import { useMediaStore } from './media-store';
import { useConflictWatch } from './use-conflicts';

export function ConflictQuestions() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space } = theme;
  useConflictWatch();
  const conflicts = useMediaStore((s) => s.session?.conflicts);
  if (!conflicts?.length) return null;

  return (
    <Surface tone="accentSoft" radius="paper" padded style={{ gap: space[3] }}>
      <Stamp kind="needs" label={t('stamp.needs')} size="sm" />
      <Text variant="h4" accessibilityRole="header">{conflictCopy.heading}</Text>
      {conflicts.map((c) => (
        <View key={c.id} style={{ gap: space[2] }} accessibilityLiveRegion="polite">
          <Text>{c.question}</Text>
          {c.resolution === 'resolved' ? <Chip label={`${conflictCopy.answered}: ${c.resolutionNote ?? ''}`} tone="success" /> : null}
          <View accessibilityRole="radiogroup" accessibilityLabel={c.question} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {c.options.map((o) => (
              <Button
                key={o.id}
                label={o.label}
                variant={c.resolutionNote === o.label ? 'primary' : 'outline'}
                onPress={() => answerConflictQuestion(c.id, o.id)}
              />
            ))}
          </View>
        </View>
      ))}
    </Surface>
  );
}
