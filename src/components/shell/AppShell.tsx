import { Link, type Href } from 'expo-router';
import { Activity, CircleUserRound, LibraryBig, type LucideIcon, Plus, Settings, Store } from 'lucide-react-native';
import { type ComponentRef, type ReactNode, useEffect, useRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { announce, InkUnderline, Logo, Text, useBreakpoint, useKalamTheme, webData } from '@/design';

import { routes } from './routes';

export type ShellDestination = 'shelf' | 'create' | 'bazaar' | 'activity' | 'settings' | 'account';

interface Destination { key: ShellDestination; label: string; icon: LucideIcon; href: Href }

const DESTINATIONS: Destination[] = [
  { key: 'shelf', label: 'Shelf', icon: LibraryBig, href: routes.shelf },
  { key: 'create', label: 'Create', icon: Plus, href: routes.create },
  { key: 'bazaar', label: 'Bazaar', icon: Store, href: routes.bazaar },
  { key: 'activity', label: 'Activity', icon: Activity, href: routes.activity },
  { key: 'settings', label: 'Settings', icon: Settings, href: routes.settings },
  { key: 'account', label: 'Account', icon: CircleUserRound, href: routes.account },
];

/** Phone order puts Create in the middle where the thumb rests. */
const PHONE_ORDER: ShellDestination[] = ['shelf', 'bazaar', 'create', 'activity', 'settings', 'account'];

/**
 * Kalam's primary navigation (docs/03 §3). At ≥768px a rail sits in the page's margin: its edge
 * is the notebook margin line, the one decorative motif of the shell. Phones get a bottom tab
 * bar with Create in the middle. Create is always the filled, most prominent destination.
 * Simple mode hides Activity.
 */
export function AppShell({ active, children }: { active: ShellDestination; children: ReactNode }) {
  const theme = useKalamTheme();
  const { hasRail } = useBreakpoint();
  const items = theme.accessModes.simple ? DESTINATIONS.filter((d) => d.key !== 'activity') : DESTINATIONS;
  const main = useRef<ComponentRef<typeof View>>(null);
  // Client-side navigation is silent for screen readers; name the page that opened (docs/10 §6.2).
  const label = DESTINATIONS.find((d) => d.key === active)?.label;
  useEffect(() => { if (label) announce(`${label} page`); }, [label]);
  return (
    <View style={{ flex: 1, flexDirection: hasRail ? 'row' : 'column', backgroundColor: theme.colors.background }}>
      {Platform.OS === 'web' ? (
        // Keyboard users skip the navigation (docs/10 §6.1). Hidden until it has focus (global CSS).
        <Pressable
          role="link"
          {...webData({ kSkip: '' })}
          onPress={() => (main.current as unknown as HTMLElement | null)?.focus()}
          style={{
            position: 'absolute', zIndex: 100, top: 8, left: 8, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center',
            borderRadius: theme.radius.md, backgroundColor: theme.colors.primary,
          }}
        >
          <Text weight="semibold" style={{ color: theme.colors.onPrimary }}>Skip to main content</Text>
        </Pressable>
      ) : null}
      {hasRail ? <Rail items={items} active={active} /> : null}
      <View ref={main} role="main" tabIndex={-1} style={{ flex: 1, minWidth: 0 }}>{children}</View>
      {hasRail ? null : <TabBar items={items} active={active} />}
    </View>
  );
}

function Rail({ items, active }: { items: Destination[]; active: ShellDestination }) {
  const theme = useKalamTheme();
  const insets = useSafeAreaInsets();
  const main = items.filter((d) => d.key !== 'account');
  const account = items.find((d) => d.key === 'account');
  return (
    <View
      role="navigation"
      aria-label="Kalam"
      style={{
        width: 96, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16, alignItems: 'center', gap: 20,
        borderRightWidth: 2, borderRightColor: theme.colors.marginLine, backgroundColor: theme.colors.background,
      }}
    >
      <Link href={routes.shelf} asChild>
        <Pressable role="link" aria-label="Kalam, go to your shelf" {...webData({ kPress: '' })} style={{ padding: 6, borderRadius: theme.radius.md }}>
          <Logo size={40} wordmark={false} />
        </Pressable>
      </Link>
      <View style={{ gap: 4, alignItems: 'center' }}>
        {main.map((d) => <NavItem key={d.key} item={d} active={d.key === active} vertical />)}
      </View>
      <View style={{ flex: 1 }} />
      {account ? <NavItem item={account} active={active === 'account'} vertical /> : null}
    </View>
  );
}

function TabBar({ items, active }: { items: Destination[]; active: ShellDestination }) {
  const theme = useKalamTheme();
  const insets = useSafeAreaInsets();
  const ordered = PHONE_ORDER.map((k) => items.find((d) => d.key === k)).filter((d): d is Destination => !!d);
  return (
    <View
      role="navigation"
      aria-label="Kalam"
      style={{
        flexDirection: 'row', paddingBottom: insets.bottom, paddingTop: 4, paddingHorizontal: 4,
        borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface,
      }}
    >
      {ordered.map((d) => <NavItem key={d.key} item={d} active={d.key === active} />)}
    </View>
  );
}

function NavItem({ item, active, vertical }: { item: Destination; active: boolean; vertical?: boolean }) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const isCreate = item.key === 'create';
  const Icon = item.icon;
  const iconColor = isCreate ? c.onPrimary : active ? c.primary : c.textSecondary;
  return (
    <Link href={item.href} asChild>
      <Pressable
        role="link"
        aria-current={active ? 'page' : undefined}
        accessibilityState={{ selected: active }}
        accessibilityLabel={item.label}
        {...webData({ kPress: '', kHover: isCreate ? 'none' : 'surface' })}
        style={{
          flex: vertical ? undefined : 1,
          width: vertical ? 80 : undefined,
          minHeight: vertical ? 68 : 58,
          paddingTop: vertical ? 8 : 6,
          alignItems: 'center', justifyContent: 'center', gap: 3,
          borderRadius: theme.radius.md,
        }}
      >
        <View
          style={{
            width: isCreate ? (vertical ? 52 : 50) : 40, height: isCreate ? (vertical ? 40 : 32) : 28,
            borderRadius: isCreate ? theme.radius.pill : theme.radius.md,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: isCreate ? (active ? c.primaryPressed : c.primary) : 'transparent',
          }}
        >
          <Icon size={Math.round(22 * Math.min(theme.fontScale, 1.25))} color={iconColor} strokeWidth={active || isCreate ? 2.3 : 1.9} />
        </View>
        <Text
          variant="caption"
          weight={active ? 'bold' : 'medium'}
          tone={active ? 'default' : 'secondary'}
          numberOfLines={1}
          // Phone tab labels grow less than body text in Large mode so all six still fit at 390px.
          style={vertical ? undefined : { fontSize: Math.round(11 * Math.min(theme.fontScale, 1.2)), lineHeight: Math.round(15 * Math.min(theme.fontScale, 1.2)) }}
        >
          {item.label}
        </Text>
        <View style={{ height: 6, opacity: active ? 1 : 0 }}>
          <InkUnderline width={vertical ? 34 : 26} />
        </View>
      </Pressable>
    </Link>
  );
}
