/**
 * The haldi strip with a waveform: how a recording looks as a thing on the desk (DIRECTION §6 "the tray").
 * Colours are the theme's haldi highlight and its ink, so it reads in Paper and in Ink night. Decorative.
 */
import { View } from 'react-native';
import { useKalamTheme } from '@/design';

const BARS = [0.35, 0.6, 0.9, 0.55, 0.8, 1, 0.65, 0.4, 0.75, 0.95, 0.5, 0.3];

export function WaveStrip({ size = 56 }: { size?: number }) {
  const { colors, radius } = useKalamTheme();
  const bar = Math.max(2, Math.round(size / 22));
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: radius.paper, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Math.max(1, bar - 1) }}>
      {BARS.slice(0, Math.floor(size / (bar * 2.2))).map((h, i) => (
        <View key={i} style={{ width: bar, height: Math.round(size * 0.62 * h), borderRadius: bar / 2, backgroundColor: colors.onAccent }} />
      ))}
    </View>
  );
}
