/**
 * Correct the wording of one translated label (docs/10 §15.5: review, keep the source, allow manual fixes).
 * Shows the original text, checks the new wording against the same rules the model output must pass
 * (placeholders, numbers, script, length), and saves it through `onSave`.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { checkTranslation, describeRejection, languageLabel, type TranslatableLabel } from '@/core/i18n-labels';
import { Button, Sheet, Text, TextField, useBreakpoint } from '@/design';

export interface CorrectionSheetProps {
  visible: boolean;
  label: TranslatableLabel | null;
  lang: string;
  /** What the screen shows now for this label, if it is translated. */
  current?: string;
  onSave(text: string): Promise<void>;
  onClose(): void;
}

export function CorrectionSheet({ visible, label, lang, current, onSave, onClose }: CorrectionSheetProps) {
  const { isDesktop } = useBreakpoint();
  const [text, setText] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  // Start from the current wording each time a label is opened.
  useEffect(() => {
    if (visible) {
      setText(current ?? '');
      setFailure(undefined);
    }
  }, [visible, label?.key, current]);

  const name = languageLabel(lang);
  const checked = label ? checkTranslation(label.text, text, lang) : undefined;
  const problem = text.trim() && checked && !checked.ok ? describeRejection(checked.reason) : undefined;
  const unchanged = text.trim() === (current ?? '').trim();

  const save = async () => {
    if (!checked?.ok) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await onSave(checked.text);
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'This could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible && !!label}
      onClose={onClose}
      title="Change this label"
      description={label ? `Write the label in ${name}. People will see it exactly as you write it.` : undefined}
      dismissible={!busy}
      footer={
        <>
          <Button label="Cancel" variant="ghost" onPress={onClose} disabled={busy} fullWidth={!isDesktop} />
          <Button
            label="Save wording"
            onPress={save}
            loading={busy}
            disabled={!checked?.ok || unchanged}
            fullWidth={!isDesktop}
            testID="correction-save"
          />
        </>
      }
    >
      {label ? (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 2 }}>
            <Text variant="caption" tone="secondary">{`Original, ${label.where.toLowerCase()}`}</Text>
            <Text selectable>{label.text}</Text>
          </View>
          <TextField
            label={`Wording in ${name}`}
            value={text}
            onChangeText={setText}
            error={problem ?? failure}
            multiline={label.text.length > 60}
            autoFocus
            testID="correction-input"
          />
        </View>
      ) : null}
    </Sheet>
  );
}
