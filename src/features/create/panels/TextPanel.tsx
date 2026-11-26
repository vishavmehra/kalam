/**
 * Type modality (docs/03 §7, DIRECTION §6): the composer is a raised sheet with royal ruling, so typing
 * feels like writing on a page. No margin rule or gutter (owner override 1): text starts at the normal
 * padding. Example ideas while it is empty (an example never replaces what the person wrote, §7.2-7.3)
 * and a clear action with undo.
 */
import { useRouter } from 'expo-router';
import { Eraser, LayoutTemplate } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

import { splitInstructions } from '@/core/media/text';
import { Button, Text, fontFamily, useBreakpoint, useKalamTheme, useToast, withAlpha } from '@/design';
import { MAX_TEXT_CHARS } from '@/features/input/normalize';
import { shelfRoutes } from '@/features/shelf/routes';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';
import { useCreationStore } from '@/state/creation-store';

/**
 * Example ideas. Labels are translated; the example text itself stays in English on purpose: it is content the
 * person edits, and the offline template matcher (src/core/classifier) reads English words, so a translated
 * example would leave the device for the cloud instead of building from a template.
 */
export const EXAMPLE_PROMPTS: ReadonlyArray<{ label: TranslationKey; prompt: string }> = [
  { label: 'create.examples.calculator', prompt: 'A simple calculator with big buttons for quick sums.' },
  { label: 'create.examples.expense', prompt: "An expense tracker in ₹ with amount, category and date, showing this month's total." },
  {
    label: 'create.examples.tailor',
    prompt: 'A tailor order book with customer name, phone, chest, waist and length measurements, delivery date and advance paid.',
  },
  {
    label: 'create.examples.kirana',
    prompt: 'A kirana udhaar ledger: customer name, amount given on credit, date, and whether it is paid back, with the total still pending.',
  },
];

/** Ruling every LINE px (before the font scale). */
const LINE = 34;

export function TextPanel() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const router = useRouter();
  const { colors, space, radius } = theme;
  const { isPhone } = useBreakpoint();
  const text = useCreationStore((s) => s.text);
  const setText = useCreationStore((s) => s.setText);
  const toast = useToast();
  const [focused, setFocused] = useState(false);
  // Web: a textarea does not grow by itself, so the box follows its content and the ruling never drifts
  // from the text. ponytail: grows but never shrinks until Clear, a textarea reports scrollHeight >= its height.
  const [contentH, setContentH] = useState(0);
  if (!text && contentH) setContentH(0); // cleared from anywhere (Clear, the tray, Start over)
  const empty = !text.trim();
  // The description stays whole; Kalam also reads it as an ordered list of instructions (docs/06 §6.3).
  const instructions = useMemo(() => splitInstructions(text).length, [text]);
  const line = Math.round(LINE * Math.min(theme.fontScale, 1.5));
  const top = isPhone ? 14 : 18;
  const pad = isPhone ? 14 : 22;
  const minH = line * (isPhone ? 5 : 6) + top;
  const height = Math.max(minH, contentH);
  const lines = Math.ceil(height / line) + 1;

  const clear = () => {
    const before = text;
    setText('');
    toast.show({ message: t('create.compose.cleared'), action: { label: t('common.undo'), onPress: () => setText(before) } });
  };

  return (
    <View style={{ gap: space[4] }}>
      <View
        style={{
          borderRadius: radius.press, overflow: 'hidden', backgroundColor: colors.surfaceElevated,
          // Rule-strong edge (3:1, WCAG 1.4.11); the sindoor focus ring sits on the frame, as in TextField.
          borderWidth: focused ? 2 : 1.5, margin: focused ? 0 : 0.5, borderColor: focused ? colors.focusRing : colors.borderStrong,
        }}
      >
        <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {Array.from({ length: lines }, (_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: top + (i + 1) * line - 1, height: 1, backgroundColor: withAlpha(colors.primary, 0.16) }} />
          ))}
        </View>
        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          maxLength={MAX_TEXT_CHARS}
          placeholder={t('create.compose.placeholder')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('create.text.placeholder')}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onContentSizeChange={Platform.OS === 'web' ? (e) => setContentH(Math.ceil(e.nativeEvent.contentSize.height)) : undefined}
          style={{
            minHeight: minH,
            ...(Platform.OS === 'web' ? { height } : null),
            paddingTop: top, paddingBottom: 8, paddingHorizontal: pad,
            fontFamily: fontFamily('medium', false, theme.script),
            fontSize: Math.round((isPhone ? 16.5 : 18) * theme.fontScale),
            lineHeight: line,
            color: colors.text,
            textAlignVertical: 'top',
            // The frame carries the focus ring (see above), not the textarea.
            outlineStyle: 'none',
          } as object}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space[2], minHeight: 36, paddingLeft: pad, paddingRight: 8, paddingBottom: 4 }}>
          <Text variant="caption" tone="muted" numeric style={{ flex: 1, textAlign: 'right' }}>
            {text.length ? t('create.compose.count', { count: text.length, max: MAX_TEXT_CHARS }) : ''}
          </Text>
          {empty ? null : <Button label={t('common.clear')} icon={Eraser} variant="ghost" size="sm" onPress={clear} />}
        </View>
      </View>
      {instructions > 1 ? <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">{t('create.text.instructions', { count: instructions })}</Text> : null}
      {empty ? (
        <View style={{ gap: space[2] }}>
          <Text variant="bodySmall" tone="secondary">{t('create.text.examples')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {EXAMPLE_PROMPTS.map((e) => (
              <Button
                key={e.label}
                label={t(e.label)}
                size="sm"
                variant="secondary"
                accessibilityHint={t('create.compose.exampleHint')}
                onPress={() => setText(e.prompt)}
              />
            ))}
            {/* Ready-made apps and starter packs, for someone who would rather start from one. */}
            <Button label={t('create.templates.open')} icon={LayoutTemplate} size="sm" variant="outline" onPress={() => router.push(shelfRoutes.templates)} testID="create-templates-examples" />
          </View>
        </View>
      ) : null}
    </View>
  );
}
