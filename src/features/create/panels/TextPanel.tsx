/**
 * Describe modality (docs/03 §7): a generous writing surface, example ideas while it is empty
 * (an example never replaces what the person wrote, §7.2-7.3) and a clear action with undo.
 */
import { Eraser } from 'lucide-react-native';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Text, fontFamily, useBreakpoint, useKalamTheme, useToast } from '@/design';
import { MAX_TEXT_CHARS } from '@/features/input/normalize';
import { useCreationStore } from '@/state/creation-store';

export const EXAMPLE_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Calculator', prompt: 'A simple calculator with big buttons for quick sums.' },
  { label: 'Expense tracker in ₹', prompt: 'An expense tracker in ₹ with amount, category and date, showing this month\'s total.' },
  {
    label: 'Tailor order book',
    prompt: 'A tailor order book with customer name, phone, chest, waist and length measurements, delivery date and advance paid.',
  },
  {
    label: 'Kirana udhaar ledger',
    prompt: 'A kirana udhaar ledger: customer name, amount given on credit, date, and whether it is paid back, with the total still pending.',
  },
];

export function TextPanel() {
  const theme = useKalamTheme();
  const { colors, space, radius } = theme;
  const { isPhone } = useBreakpoint();
  const text = useCreationStore((s) => s.text);
  const setText = useCreationStore((s) => s.setText);
  const toast = useToast();
  const [focused, setFocused] = useState(false);
  const empty = !text.trim();

  const clear = () => {
    const before = text;
    setText('');
    toast.show({ message: 'Description cleared.', action: { label: 'Undo', onPress: () => setText(before) } });
  };

  return (
    <View style={{ gap: space[4] }}>
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: focused ? 2 : 1,
          margin: focused ? 0 : 1,
          borderColor: focused ? colors.primary : colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: space[5],
          paddingTop: space[4],
          paddingBottom: space[3],
        }}
      >
        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          maxLength={MAX_TEXT_CHARS}
          placeholder={'Describe the app you want to create.\nFor example: a tailoring order book with customer name, measurements, delivery date and advance paid.'}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Describe the app you want to create"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            minHeight: isPhone ? 168 : 240,
            fontFamily: fontFamily('regular'),
            fontSize: Math.round(17 * theme.fontScale),
            lineHeight: Math.round(26 * theme.fontScale),
            color: colors.text,
            textAlignVertical: 'top',
            outlineStyle: 'none',
          } as object}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space[2], minHeight: 24 }}>
          <Text variant="caption" tone="muted" numeric style={{ flex: 1 }}>
            {text.length > MAX_TEXT_CHARS * 0.8 ? `${text.length} / ${MAX_TEXT_CHARS}` : ''}
          </Text>
          {empty ? null : <Button label="Clear" icon={Eraser} variant="ghost" size="sm" onPress={clear} />}
        </View>
      </View>
      {empty ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" tone="secondary">Or start from an example</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {EXAMPLE_PROMPTS.map((e) => (
              <Button
                key={e.label}
                label={e.label}
                size="sm"
                variant="secondary"
                accessibilityHint="Puts this example in the box so you can change it"
                onPress={() => setText(e.prompt)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
