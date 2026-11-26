/**
 * Keyboard and screen-reader path for edit by drawing (docs/14 §4.7): pick parts of the current
 * screen from a list instead of drawing around them.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Sheet, Text, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

export function PartPicker({ visible, parts, initial, onClose, onPick }: {
  visible: boolean;
  parts: ReadonlyArray<{ id: string; label: string }>;
  initial: readonly string[];
  onClose(): void;
  onPick(ids: string[]): void;
}) {
  const { space, uiLanguage } = useKalamTheme();
  const t = useT(uiLanguage);
  const [chosen, setChosen] = useState<string[]>([...initial]);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  // Start from the current selection each time the sheet opens.
  useEffect(() => {
    if (visible) setChosen([...initialRef.current]);
  }, [visible]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('edit.draw.picker.title')}
      description={t('edit.draw.picker.description')}
      footer={
        <>
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
          <Button label={t('edit.draw.picker.pick')} disabled={!chosen.length} onPress={() => onPick(parts.filter((p) => chosen.includes(p.id)).map((p) => p.id))} />
        </>
      }
    >
      {parts.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {parts.map((p) => <Chip key={p.id} label={p.label} role="checkbox" selected={chosen.includes(p.id)} onPress={() => toggle(p.id)} />)}
        </View>
      ) : (
        <Text tone="secondary">{t('edit.draw.picker.none')}</Text>
      )}
    </Sheet>
  );
}
