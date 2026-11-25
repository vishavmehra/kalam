/**
 * Floating tools for the drawing layer: draw, write a note, scroll the app, pick from a list,
 * start over, close. Sits on the right, or on the left in left-handed mode.
 */
import { Hand, ListChecks, PenLine, RotateCcw, StickyNote, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { IconButton, useKalamTheme } from '@/design';

export type OverlayTool = 'pen' | 'note' | 'scroll';

export function ToolRail({ tool, onTool, onPick, onClear, onClose, canClear, disabled, left, reduced }: {
  tool: OverlayTool;
  onTool(tool: OverlayTool): void;
  onPick(): void;
  onClear(): void;
  onClose(): void;
  canClear: boolean;
  /** True while a change is being worked out or previewed. */
  disabled: boolean;
  left: boolean;
  reduced: boolean;
}) {
  const { colors, radius, elevation, space } = useKalamTheme();
  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(200)}
      exiting={reduced ? undefined : FadeOut.duration(120)}
      style={[
        styles.rail,
        left ? { left: space[3] } : { right: space[3] },
        { top: space[3], gap: space[1], padding: space[1], borderRadius: radius.lg, backgroundColor: colors.surfaceElevated, borderColor: colors.border },
        elevation[2],
      ]}
      accessibilityRole="toolbar"
      accessibilityLabel="Drawing tools"
    >
      <IconButton icon={PenLine} label="Draw" selected={tool === 'pen'} disabled={disabled} onPress={() => onTool('pen')} />
      <IconButton icon={StickyNote} label="Write a note" selected={tool === 'note'} disabled={disabled} onPress={() => onTool('note')} />
      <IconButton icon={Hand} label="Scroll the app" selected={tool === 'scroll'} disabled={disabled} onPress={() => onTool('scroll')} />
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <IconButton icon={ListChecks} label="Pick from a list" disabled={disabled} onPress={onPick} />
      <IconButton icon={RotateCcw} label="Start over" disabled={disabled || !canClear} onPress={onClear} />
      <IconButton icon={X} label="Stop drawing" onPress={onClose} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  rule: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 2 },
});
