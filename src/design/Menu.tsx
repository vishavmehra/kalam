import type { LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useT } from '@/i18n/react';

import { usePresence } from './presence';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { useBreakpoint, useKalamTheme } from './theme';
import { webData } from './web';

export interface MenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
}

export interface MenuAnchor { x: number; y: number; width: number; height: number }

export interface MenuProps {
  visible: boolean;
  onClose: () => void;
  items: MenuItem[];
  /** Sheet title on phones; accessible name of the menu everywhere. */
  title: string;
  /** Trigger rectangle in window coordinates (from `measureInWindow`). Desktop shows a popover there. */
  anchor?: MenuAnchor | null;
}

/** Overflow menu: anchored popover on desktop, bottom sheet on phones (docs/03 §5.2). */
export function Menu({ visible, onClose, items, title, anchor }: MenuProps) {
  const { isDesktop } = useBreakpoint();
  if (!isDesktop || !anchor) {
    return (
      <Sheet visible={visible} onClose={onClose} title={title}>
        <View role="menu" aria-label={title} style={{ marginHorizontal: -12 }}>
          {items.map((item) => <MenuRow key={item.key} item={item} onClose={onClose} />)}
        </View>
      </Sheet>
    );
  }
  return <Popover visible={visible} onClose={onClose} items={items} title={title} anchor={anchor} />;
}

function Popover({ visible, onClose, items, title, anchor }: Required<Omit<MenuProps, 'anchor'>> & { anchor: MenuAnchor }) {
  const theme = useKalamTheme();
  const tr = useT(theme.uiLanguage);
  const { width, height } = useBreakpoint();
  const reduced = theme.reducedMotion;
  const { mounted, progress } = usePresence(visible, reduced ? 80 : 150, 100);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced ? [] : [{ scale: 0.97 + 0.03 * progress.value }],
  }));
  const menuW = 232;
  const estH = items.length * theme.touchTarget + 16;
  const below = anchor.y + anchor.height + 6;
  const top = below + estH > height - 12 ? Math.max(12, anchor.y - estH - 6) : below;
  const left = Math.min(Math.max(12, anchor.x + anchor.width - menuW), width - menuW - 12);
  return (
    <Modal transparent visible={mounted} onRequestClose={onClose} animationType="none">
      <Pressable role="button" style={StyleSheet.absoluteFill} onPress={onClose} tabIndex={-1} accessibilityLabel={tr('common.close')} />
      <Animated.View
        role="menu"
        aria-label={title}
        style={[
          {
            position: 'absolute', top, left, width: menuW, paddingVertical: 6,
            backgroundColor: theme.colors.surfaceElevated,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            transformOrigin: top < anchor.y ? 'bottom right' : 'top right',
          },
          theme.scheme === 'light' ? theme.elevation[2] : null,
          style,
        ]}
      >
        {items.map((item) => <MenuRow key={item.key} item={item} onClose={onClose} />)}
      </Animated.View>
    </Modal>
  );
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const theme = useKalamTheme();
  const color = item.destructive ? theme.colors.danger : theme.colors.text;
  const Icon = item.icon;
  return (
    <Pressable
      role="menuitem"
      onPress={() => { onClose(); item.onSelect(); }}
      {...webData({ kHover: 'surface' })}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16,
        marginHorizontal: 6,
        borderRadius: theme.radius.md,
        backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
      })}
    >
      {Icon ? <Icon size={18} color={color} strokeWidth={2} /> : null}
      <Text weight="medium" style={{ color }}>{item.label}</Text>
    </Pressable>
  );
}
