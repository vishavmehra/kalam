/**
 * A small cloth-bound register for a template or a pack: the cover colour of the app it makes, a darker spine
 * with stitching, and a white label carrying the app's glyph (DIRECTION §6, §7). The same object as a cover on
 * the shelf, drawn small so a long list stays easy to scan. Decorative: the card's text carries the meaning.
 */
import { View } from 'react-native';

import type { IconGlyph, ThemePreset } from '@/core/spec/schema';
import { clothForPreset, clothLabel, cloths, GLYPH_ICONS } from '@/design';

export function MiniRegister({ preset, glyph, width = 52 }: { preset: ThemePreset; glyph: IconGlyph; width?: number }) {
  const cl = cloths[clothForPreset(preset)];
  const Glyph = GLYPH_ICONS[glyph] ?? GLYPH_ICONS.sparkles;
  return (
    <View
      aria-hidden
      style={{
        width, height: Math.round(width * 1.25), backgroundColor: cl.cloth, paddingLeft: Math.round(width * 0.2), paddingRight: 5, justifyContent: 'center',
        borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 6, borderBottomRightRadius: 6,
      }}
    >
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '16%', backgroundColor: 'rgba(0,0,0,0.22)', borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }} />
      <View style={{ position: 'absolute', left: 5, top: 5, bottom: 5, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' }} />
      <View style={{ backgroundColor: clothLabel.bg, borderRadius: 3, borderWidth: 1.5, borderColor: cl.cloth, paddingVertical: Math.round(width * 0.14), alignItems: 'center' }}>
        <Glyph size={Math.round(width * 0.34)} color={clothLabel.fg} strokeWidth={2} />
      </View>
    </View>
  );
}
