/**
 * Clarifying questions after a build that needed more detail (docs/14 §6.3): answer them in place.
 * Answers are added to the description as plain sentences, then the build runs again. Nothing is
 * sent until the person presses the button.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Text, TextField, useKalamTheme } from '@/design';
import { MAX_TEXT_CHARS } from '@/features/input/normalize';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';

import { answersToText } from './input-summary';

export function ClarifyQuestions({ questions, onRetry }: { questions: string[]; onRetry: () => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { space } = theme;
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const setText = useCreationStore((s) => s.setText);
  const added = answersToText(questions, answers);

  const apply = () => {
    if (!added) return;
    const base = useCreationStore.getState().text.trim();
    setText(`${base}${base ? '\n\n' : ''}${added}`.slice(0, MAX_TEXT_CHARS));
    onRetry();
  };

  return (
    <View style={{ gap: space[3], marginTop: space[1] }}>
      <Text weight="semibold">{t('create.clarify.intro')}</Text>
      {questions.map((q, i) => (
        <TextField
          key={q}
          label={q}
          value={answers[i]}
          onChangeText={(t) => setAnswers((prev) => prev.map((a, j) => (j === i ? t : a)))}
        />
      ))}
      <View style={{ flexDirection: 'row' }}>
        <Button label={t('create.clarify.submit')} onPress={apply} disabled={!added} />
      </View>
    </View>
  );
}
