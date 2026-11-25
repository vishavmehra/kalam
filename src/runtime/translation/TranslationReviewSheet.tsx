/**
 * Lists every translatable label with its original text and its translation, so the person can review the
 * whole app and fix any wording (docs/10 §15.5). Labels that stayed in the original language are marked.
 */
import { Pencil } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { collectTranslatableLabels, languageLabel, type TranslatableLabel } from '@/core/i18n-labels';
import { Button, Sheet, Text, useKalamTheme } from '@/design';
import type { AppTranslation } from './use-app-translation';

export interface TranslationReviewSheetProps {
  visible: boolean;
  translation: AppTranslation;
  onClose(): void;
  /** Called with the label the person wants to change. The caller opens the correction sheet. */
  onEdit(label: TranslatableLabel): void;
}

export function TranslationReviewSheet({ visible, translation: tr, onClose, onEdit }: TranslationReviewSheetProps) {
  const theme = useKalamTheme();
  const labels = useMemo(() => (tr.original ? collectTranslatableLabels(tr.original) : []), [tr.original]);
  const name = languageLabel(tr.lang);
  const missing = useMemo(() => new Set(tr.missing), [tr.missing]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Review the ${name} labels`}
      description="Tap a row to change its wording. Your changes are saved on this device."
      maxWidth={560}
      footer={<Button label="Done" onPress={onClose} />}
    >
      <View style={{ gap: 4, paddingBottom: 4 }}>
        {labels.map((label) => {
          const shown = tr.strings[label.key];
          return (
            <Pressable
              key={label.key}
              role="button"
              accessibilityLabel={`Change ${label.where.toLowerCase()}: ${label.text}`}
              onPress={() => onEdit(label)}
              style={({ pressed }) => ({
                minHeight: theme.touchTarget,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 8,
                paddingHorizontal: 12,
                marginHorizontal: -12,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" tone="secondary">{label.where}</Text>
                <Text variant="bodySmall" tone="secondary">{label.text}</Text>
                {shown ? (
                  <Text weight="medium">{shown}</Text>
                ) : (
                  <Text tone={missing.has(label.key) ? 'warning' : 'muted'}>Not translated. The original shows.</Text>
                )}
              </View>
              <Pencil size={16} color={theme.colors.textMuted} strokeWidth={2} />
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
