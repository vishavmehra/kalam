import { Link, type Href } from 'expo-router';
import { Activity, LibraryBig, type LucideIcon, PenLine, Settings, Store } from 'lucide-react-native';
import { type ComponentRef, type ReactNode, useEffect, useRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { announce, InkUnderline, InShellContext, Logo, Text, useBreakpoint, useKalamTheme, webData } from '@/design';
import { AccountButton } from '@/features/auth/AccountButton';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

import { routes } from './routes';
import { shellSides, tabOrder } from './shell-layout';
import { ThemeToggle } from './ThemeToggle';

export type ShellDestination = 'shelf' | 'create' | 'bazaar' | 'activity' | 'settings' | 'account';

interface Destination { key: Exclude<ShellDestination, 'account'>; label: TranslationKey; icon: LucideIcon; href: Href }

/** Shelf, Make, Bazaar, Activity, Settings. Account lives in the header (Sign in, or the person's initial). */
const DESTINATIONS: Destination[] = [
  { key: 'shelf', label: 'nav.shelf', icon: LibraryBig, href: routes.shelf },
  { key: 'create', label: 'shell.make', icon: PenLine, href: routes.create },
  { key: 'bazaar', label: 'nav.bazaar', icon: Store, href: routes.bazaar },
  { key: 'activity', label: 'nav.activity', icon: Activity, href: routes.activity },
  { key: 'settings', label: 'nav.settings', icon: Settings, href: routes.settings },
];

/** How far the phone Make key rises above the tab bar's top rule. */
const RAISE = 18;

const PAGE_NAME: Record<ShellDestination, TranslationKey> = {
  shelf: 'nav.shelf', create: 'shell.make', bazaar: 'nav.bazaar', activity: 'nav.activity', settings: 'nav.settings', account: 'nav.account',
};

/**
 * Kalam's app shell ("Khata and Kalam"): a header with the seal, the theme toggle and a visible Sign in button
 * (or the person's initial), then a rail at 768 px and wider or a phone tab bar with a raised Make key.
 * Content starts at the normal page edge: no margin column, no red margin rule (owner, 2026-11-25).
 * Simple mode hides Activity.
 */
export function AppShell({ active, children }: { active: ShellDestination; children: ReactNode }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { hasRail } = useBreakpoint();
  const sides = shellSides(!!theme.accessModes.leftHanded);
  const items = theme.accessModes.simple ? DESTINATIONS.filter((d) => d.key !== 'activity') : DESTINATIONS;
  const main = useRef<ComponentRef<typeof View>>(null);
  // Client-side navigation is silent for screen readers; name the page that opened (docs/10 §6.2).
  const page = t(PAGE_NAME[active]);
  useEffect(() => { announce(t('shell.pageOpened', { page })); }, [page, t]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {Platform.OS === 'web' ? (
        // Keyboard users skip the navigation (docs/10 §6.1). Hidden until it has focus (global CSS).
        <Pressable
          role="link"
          {...webData({ kSkip: '' })}
          onPress={() => (main.current as unknown as HTMLElement | null)?.focus()}
          style={{
            position: 'absolute', zIndex: 100, top: 8, start: 8, minHeight: theme.touchTarget, paddingHorizontal: 16, justifyContent: 'center',
            borderRadius: theme.radius.press, backgroundColor: theme.colors.actionBg,
          }}
        >
          <Text weight="semibold" style={{ color: theme.colors.actionFg }}>{t('shell.skip')}</Text>
        </Pressable>
      ) : null}
      <Header />
      <View style={{ flex: 1, flexDirection: hasRail ? sides.direction : 'column', minHeight: 0 }}>
        {hasRail ? <Rail items={items} active={active} edge={sides.railEdge} /> : null}
        <View ref={main} role="main" tabIndex={-1} style={{ flex: 1, minWidth: 0 }}>
          <InShellContext.Provider value>{children}</InShellContext.Provider>
        </View>
        {hasRail ? null : <TabBar items={items} active={active} />}
      </View>
    </View>
  );
}

/** Seal and wordmark on the left; theme and account on the right. It clears the status bar on phones. */
function Header() {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const insets = useSafeAreaInsets();
  const { isPhone, hasRail } = useBreakpoint();
  const sides = shellSides(!!theme.accessModes.leftHanded);
  return (
    <View
      role="banner"
      style={{
        paddingTop: insets.top,
        // The logo side keeps the wide padding and the action side the narrow one, mirrored or not.
        ...(sides.headerDirection === 'row' ? { paddingStart: hasRail ? 20 : 16, paddingEnd: isPhone ? 8 : 20 } : { paddingStart: isPhone ? 8 : 20, paddingEnd: hasRail ? 20 : 16 }),
        backgroundColor: theme.colors.background,
        borderBottomWidth: hasRail ? 0 : 1, borderBottomColor: theme.colors.border,
      }}
    >
      <View style={{ minHeight: Math.max(isPhone ? 60 : 68, theme.touchTarget + 8), flexDirection: sides.headerDirection, alignItems: 'center', gap: 8 }}>
        <Link href={routes.shelf} asChild>
          <Pressable role="link" aria-label={t('nav.home')} {...webData({ kPress: 'scale' })} style={{ minHeight: theme.touchTarget, justifyContent: 'center', paddingEnd: 8, borderRadius: theme.radius.press }}>
            <Logo size={isPhone ? 30 : 34} compact={isPhone} />
          </Pressable>
        </Link>
        <View style={{ flex: 1 }} />
        <ThemeToggle />
        <AccountButton />
      </View>
    </View>
  );
}

function Rail({ items, active, edge }: { items: Destination[]; active: ShellDestination; edge: 'borderEndWidth' | 'borderStartWidth' }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const insets = useSafeAreaInsets();
  return (
    <View
      role="navigation"
      aria-label={t('shell.navLabel')}
      style={{
        width: 84, paddingTop: 8, paddingBottom: insets.bottom + 16, alignItems: 'center', gap: 6,
        [edge]: 1, [edge === 'borderEndWidth' ? 'borderEndColor' : 'borderStartColor']: theme.colors.border, backgroundColor: theme.colors.background,
      }}
    >
      {items.map((d) => <NavItem key={d.key} item={d} active={d.key === active} vertical />)}
    </View>
  );
}

function TabBar({ items, active }: { items: Destination[]; active: ShellDestination }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const insets = useSafeAreaInsets();
  const ordered = tabOrder(!!theme.accessModes.leftHanded).map((k) => items.find((d) => d.key === k)).filter((d): d is Destination => !!d);
  return (
    <View
      role="navigation"
      aria-label={t('shell.navLabel')}
      style={{
        flexDirection: 'row', alignItems: 'flex-end', paddingBottom: insets.bottom + 4, paddingTop: RAISE + 6, paddingHorizontal: 4,
        backgroundColor: theme.colors.background,
      }}
    >
      {/* The top rule sits RAISE below the bar's edge so the raised Make key pokes above it while staying inside
          the bar's layout bounds: Android and iOS only deliver taps inside a parent's bounds. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: RAISE, start: 0, end: 0, height: 1, backgroundColor: theme.colors.border }} />
      {ordered.map((d) => <NavItem key={d.key} item={d} active={d.key === active} />)}
    </View>
  );
}

function NavItem({ item, active, vertical }: { item: Destination; active: boolean; vertical?: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const c = theme.colors;
  const make = item.key === 'create';
  const Icon = item.icon;
  const label = t(item.label);
  const iconColor = make ? c.actionFg : active ? c.primary : c.textMuted;
  const iconSize = Math.round(21 * Math.min(theme.fontScale, 1.25));
  // Phone labels grow less than body text in Large mode so all five keys still fit at 390 px.
  const labelSize = Math.round((vertical ? 12.5 : 11.5) * Math.min(theme.fontScale, 1.2));
  return (
    <Link href={item.href} asChild>
      <Pressable
        role="link"
        aria-current={active ? 'page' : undefined}
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        testID={`nav-${item.key}`}
        {...webData({ kPress: 'scale', kHover: make || active ? 'none' : 'surface' })}
        style={{
          flex: vertical ? undefined : 1,
          width: vertical ? 68 : undefined,
          minHeight: Math.max(theme.touchTarget, vertical ? 64 : 56),
          // The whole Pressable rises with the key (into the bar's top padding), so its top edge takes taps too.
          marginTop: make && !vertical ? -RAISE : 0,
          paddingTop: vertical ? 10 : 4, paddingBottom: vertical ? 6 : 0,
          alignItems: 'center', justifyContent: 'flex-end', gap: 3,
          borderRadius: theme.radius.press,
          backgroundColor: vertical && active && !make ? c.primarySoft : 'transparent',
        }}
      >
        {make ? (
          <View
            style={[
              {
                width: vertical ? 44 : 46, height: vertical ? 40 : 46,
                borderRadius: vertical ? theme.radius.press : 14, alignItems: 'center', justifyContent: 'center',
                backgroundColor: active ? c.actionBgPressed : c.actionBg,
                borderWidth: theme.accessModes.highContrast ? 2 : 0, borderColor: c.borderStrong,
              },
              vertical ? null : theme.elevation[2],
            ]}
          >
            <Icon size={iconSize} color={iconColor} strokeWidth={2.2} />
          </View>
        ) : (
          <Icon size={iconSize} color={iconColor} strokeWidth={active ? 2.3 : 1.9} />
        )}
        <Text
          weight={active ? 'bold' : 'semibold'}
          numberOfLines={1}
          style={{ fontSize: labelSize, lineHeight: Math.round(labelSize * 1.3), color: active ? c.primary : make ? c.textSecondary : c.textMuted }}
        >
          {label}
        </Text>
        {vertical ? null : (
          <View style={{ height: 6, opacity: active ? 1 : 0 }}>
            <InkUnderline width={24} />
          </View>
        )}
      </Pressable>
    </Link>
  );
}
