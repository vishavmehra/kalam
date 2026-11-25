/**
 * What the overlay understood, drawn over the app: faint outlines on every part that can be
 * marked, a marigold highlight with a name tag on picked parts, and a highlighter wash on parts a
 * proposed change touched. Never takes touches.
 */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Text, useKalamTheme, withAlpha } from '@/design';
import type { Part } from './hit-test';

const OUTSET = 4;
const TAG_HEIGHT = 24;

export function MarksLayer({ parts, picked, changed, names, outlines, reduced }: {
  parts: readonly Part[];
  picked: ReadonlySet<string>;
  changed: ReadonlySet<string>;
  /** id → short tag, e.g. `Save button`. */
  names: Readonly<Record<string, string>>;
  /** Show faint outlines on parts that are not picked (idle and picking states). */
  outlines: boolean;
  reduced: boolean;
}) {
  const { colors, radius } = useKalamTheme();
  let shownTags = 0;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {parts.map((p, i) => {
        const box = { left: p.rect.x - OUTSET, top: p.rect.y - OUTSET, width: p.rect.width + OUTSET * 2, height: p.rect.height + OUTSET * 2 };
        if (picked.has(p.id)) {
          const tag = shownTags++ < 3 ? names[p.id] : undefined;
          return (
            <Animated.View
              key={`pick:${p.id}`}
              entering={reduced ? undefined : FadeIn.duration(160)}
              exiting={reduced ? undefined : FadeOut.duration(110)}
              style={[styles.box, box, { borderRadius: radius.md, borderWidth: 2, borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.16) }]}
            >
              {tag ? (
                <View style={[styles.tag, { backgroundColor: colors.primary, top: box.top >= TAG_HEIGHT + 2 ? -(TAG_HEIGHT + 4) : 4 }]}>
                  <Text variant="caption" tone="onPrimary" numberOfLines={1}>{tag}</Text>
                </View>
              ) : null}
            </Animated.View>
          );
        }
        if (changed.has(p.id)) {
          return (
            <Animated.View
              key={`changed:${p.id}`}
              entering={reduced ? undefined : FadeIn.duration(240)}
              style={[styles.box, box, { borderRadius: radius.sm, backgroundColor: withAlpha(colors.accent, 0.28) }]}
            />
          );
        }
        if (!outlines) return null;
        return (
          <Animated.View
            key={`part:${p.id}`}
            // One short reveal when the layer opens, so people see what can be marked.
            entering={reduced ? undefined : FadeIn.duration(180).delay(Math.min(i, 10) * 24)}
            style={[styles.box, box, { borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: withAlpha(colors.primary, 0.45) }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute' },
  tag: { position: 'absolute', left: -2, height: TAG_HEIGHT, maxWidth: 220, paddingHorizontal: 8, borderRadius: 999, justifyContent: 'center' },
});
