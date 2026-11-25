import {
  Bell, Book, Briefcase, Calculator, Calendar, Camera, Check, Clipboard, Coffee, Dumbbell, Flame, Globe, GraduationCap,
  Heart, House, Leaf, List, type LucideIcon, Mic, Notebook, Package, Pill, Plus, Ruler, Scissors, ShoppingCart, Sparkles,
  Star, Timer, Users, Wallet,
} from 'lucide-react-native';
import { View } from 'react-native';

import type { IconGlyph, KalamIcon } from '@/core/spec/schema';

import { readableOn, safeColor } from './color';
import { useKalamTheme } from './theme';

/** KalamSpec icon glyph → Lucide icon (docs/05 icon descriptor; no raw SVG from specs). */
export const GLYPH_ICONS: Record<IconGlyph, LucideIcon> = {
  calculator: Calculator, plus: Plus, check: Check, list: List, notebook: Notebook, wallet: Wallet, flame: Flame,
  users: Users, package: Package, clipboard: Clipboard, ruler: Ruler, bell: Bell, heart: Heart, pill: Pill,
  shopping_cart: ShoppingCart, scissors: Scissors, calendar: Calendar, book: Book, star: Star, home: House,
  briefcase: Briefcase, leaf: Leaf, dumbbell: Dumbbell, graduation_cap: GraduationCap, coffee: Coffee, camera: Camera,
  mic: Mic, globe: Globe, timer: Timer, sparkles: Sparkles,
};

export interface AppIconTileProps {
  /** The app's icon descriptor (optional in specs). */
  icon?: KalamIcon;
  /** The app's own primary colour (spec.theme.primary) — used when the icon has no background. */
  appColor?: string;
  size?: number;
}

/** An app's icon tile in the app's OWN colours (not Kalam's). Decorative: pair with the app name. */
export function AppIconTile({ icon, appColor, size = 48 }: AppIconTileProps) {
  const theme = useKalamTheme();
  const bg = safeColor(icon?.background ?? appColor, theme.colors.primary);
  const fg = safeColor(icon?.foreground, readableOn(bg));
  const Glyph = GLYPH_ICONS[icon?.glyph ?? 'sparkles'] ?? Sparkles;
  return (
    <View
      aria-hidden
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Glyph size={size * 0.5} color={fg} strokeWidth={2} />
    </View>
  );
}
