/**
 * Floating tools for the drawing layer: draw, write a note, scroll the app, pick from a list,
 * start over, close. Sits on the right, or on the left in left-handed mode.
 */
import { Hand, ListChecks, PenLine, RotateCcw, StickyNote, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { IconButton, useKalamTheme } from '@/design';
import { useT } from '@/i18n/react';

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
  const { colors, radius, elevation, space, uiLanguage } = useKalamTheme();
  const t = useT(uiLanguage);
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
      accessibilityLabel={t('edit.draw.tools.label')}
    >
      <IconButton icon={PenLine} label={t('edit.draw.tools.draw')} selected={tool === 'pen'} disabled={disabled} onPress={() => onTool('pen')} />
      <IconButton icon={StickyNote} label={t('edit.draw.tools.note')} selected={tool === 'note'} disabled={disabled} onPress={() => onTool('note')} />
      <IconButton icon={Hand} label={t('edit.draw.tools.scroll')} selected={tool === 'scroll'} disabled={disabled} onPress={() => onTool('scroll')} />
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <IconButton icon={ListChecks} label={t('edit.draw.pickFromList')} disabled={disabled} onPress={onPick} />
      <IconButton icon={RotateCcw} label={t('edit.draw.tools.startOver')} disabled={disabled || !canClear} onPress={onClear} />
      <IconButton icon={X} label={t('edit.stopDrawing')} onPress={onClose} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  rule: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 2 },
});
