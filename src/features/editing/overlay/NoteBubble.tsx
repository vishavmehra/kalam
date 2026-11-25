/**
 * Text notes on the drawing layer: a small editor where the person tapped, and the placed note
 * that stays visible while its change is worked out and previewed.
 */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Button, Text, TextField, useKalamTheme } from '@/design';
import type { Point } from './geometry';

const WIDTH = 280;
const HEIGHT = 156;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function NoteBubble({ at, area, text, onText, onAdd, onCancel, reduced }: {
  at: Point;
  area: { width: number; height: number };
  text: string;
  onText(text: string): void;
  onAdd(): void;
  onCancel(): void;
  reduced: boolean;
}) {
  const { colors, radius, space, elevation } = useKalamTheme();
  const width = Math.min(WIDTH, Math.max(200, area.width - 24));
  const left = clamp(at.x - 20, 12, area.width - width - 12);
  const top = at.y + 16 + HEIGHT < area.height ? at.y + 16 : clamp(at.y - HEIGHT - 16, 12, area.height - HEIGHT - 12);
  return (
    <>
      <Dot at={at} />
      <Animated.View
        entering={reduced ? undefined : FadeIn.duration(140)}
        style={[styles.bubble, { left, top, width, gap: space[2], padding: space[3], borderRadius: radius.lg, backgroundColor: colors.surface, borderColor: colors.border }, elevation[2]]}
      >
        <TextField
          label="Note"
          labelHidden
          value={text}
          onChangeText={onText}
          placeholder="Closed on Sundays"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={onAdd}
        />
        <View style={[styles.row, { gap: space[2] }]}>
          <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
          <Button label="Add note" size="sm" disabled={!text.trim()} onPress={onAdd} />
        </View>
      </Animated.View>
    </>
  );
}

/** A placed note: marigold slip pinned where the person tapped. */
export function NotePin({ at, text, area }: { at: Point; text: string; area: { width: number; height: number } }) {
  const { colors, radius, space } = useKalamTheme();
  const left = clamp(at.x - 8, 8, area.width - 228);
  return (
    <>
      <Dot at={at} />
      <View
        pointerEvents="none"
        style={[styles.pin, { left, top: at.y + 10, paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: colors.accentSoft, borderColor: colors.accent }]}
      >
        <Text variant="bodySmall" numberOfLines={3}>{text}</Text>
      </View>
    </>
  );
}

function Dot({ at }: { at: Point }) {
  const { colors } = useKalamTheme();
  return <View pointerEvents="none" style={[styles.dot, { left: at.x - 5, top: at.y - 5, backgroundColor: colors.accent, borderColor: colors.surface }]} />;
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', justifyContent: 'flex-end' },
  pin: { position: 'absolute', maxWidth: 220, borderWidth: 1 },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
