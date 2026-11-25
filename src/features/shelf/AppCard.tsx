import { Link } from 'expo-router';
import { Ellipsis, Pin, Sparkles } from 'lucide-react-native';
import { type ComponentRef, useRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { routes } from '@/components/shell/routes';
import type { StoredApp } from '@/core/contracts';
import { useFormat } from '@/i18n/react';
import {
  GLYPH_ICONS, type MenuAnchor, readableOn, safeColor, SourceBadge, type ExecutionSource, Text, useKalamTheme, webData, withAlpha,
} from '@/design';

const BUILT: Partial<Record<StoredApp['origin']['route'], { source: ExecutionSource; label: string }>> = {
  template: { source: 'deterministic', label: 'From a template' },
  'template+on_device': { source: 'on_device', label: 'Built on this device' },
  cloud: { source: 'cloud', label: 'Built in the cloud' },
  'cloud+repair': { source: 'cloud', label: 'Built in the cloud' },
  specialist: { source: 'cloud', label: 'Built by a specialist' },
};

export interface AppCardProps {
  app: StoredApp;
  width: number;
  index: number;
  onMenu: (app: StoredApp, anchor: MenuAnchor | null) => void;
}

/**
 * Shelf card drawn as a notebook: the cover is the app's OWN colour (never Kalam's), its icon is
 * printed on the cover, and the elastic band is the app's second colour. Below the cover: name,
 * description, last use and how it was built. Overflow menu on the cover.
 */
export function AppCard({ app, width, index, onMenu }: AppCardProps) {
  const theme = useKalamTheme();
  const c = theme.colors;
  const more = useRef<ComponentRef<typeof Pressable> | null>(null);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const { spec } = app;
  const description = spec.description || spec.meta.description || `${spec.screens.length} ${spec.screens.length === 1 ? 'screen' : 'screens'}`;
  const when = app.lastOpenedAt ? `Opened ${relativeTime(app.lastOpenedAt).toLowerCase()}` : `Made ${relativeTime(app.createdAt).toLowerCase()}`;
  const built = BUILT[app.origin.route];
  const compact = width < 220;

  const cover = safeColor(spec.icon?.background ?? spec.theme.primary, c.primary);
  const ink = safeColor(spec.icon?.foreground, readableOn(cover, '#13162E', '#FFFFFF'));
  const band = safeColor(spec.theme.secondary, withAlpha(ink, 0.35));
  const Glyph = GLYPH_ICONS[spec.icon?.glyph ?? 'sparkles'] ?? Sparkles;
  const coverH = compact ? 64 : 78;

  const openMenu = () => {
    const node = more.current;
    if (!node) return onMenu(app, null);
    node.measureInWindow((x, y, w, h) => onMenu(app, { x, y, width: w, height: h }));
  };

  const entering = Platform.OS === 'web' || theme.reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 10) * 40).duration(320);

  return (
    <Animated.View entering={entering} style={{ width, flex: 1 }} {...webData({ kCard: '' })}>
      <Link href={routes.app(app.id)} asChild>
        <Pressable
          role="link"
          accessibilityLabel={`${spec.name}. ${description}. ${when}${app.pinned ? '. Pinned' : ''}`}
          {...webData({ kPress: '', kHover: 'border' })}
          // Static style: Link asChild drops function styles on web. Press feedback = CSS (web) / ripple (Android).
          android_ripple={{ color: c.surfaceAlt, foreground: true }}
          style={{
            flex: 1,
            minHeight: compact ? 196 : 222,
            backgroundColor: c.surface,
            borderRadius: theme.radius.lg,
            borderWidth: theme.accessModes.highContrast ? 2 : 1,
            borderColor: c.border,
            overflow: 'hidden',
          }}
        >
          <View aria-hidden style={{ height: coverH, backgroundColor: cover, paddingHorizontal: compact ? 14 : 18, justifyContent: 'center' }}>
            <Glyph size={compact ? 26 : 30} color={ink} strokeWidth={1.9} />
            {/* The elastic band that keeps a notebook shut. */}
            <View style={{ position: 'absolute', top: 0, bottom: 0, right: compact ? 16 : 22, width: 7, backgroundColor: band }} />
          </View>
          <View style={{ flex: 1, padding: compact ? 14 : 18, paddingTop: compact ? 12 : 14, gap: 10 }}>
            <View style={{ gap: 4, flex: 1 }}>
              <Text variant={compact ? 'body' : 'h4'} weight="semibold" numberOfLines={2}>{spec.name}</Text>
              <Text variant="bodySmall" tone="secondary" numberOfLines={2}>{description}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {app.pinned ? <Pin size={13} color={c.textMuted} accessibilityLabel="Pinned" /> : null}
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{when}</Text>
              {built && !compact ? <SourceBadge source={built.source} label={built.label} /> : null}
            </View>
          </View>
        </Pressable>
      </Link>
      <Pressable
        ref={(n) => { more.current = n; }}
        onPress={openMenu}
        role="button"
        accessibilityLabel={`More actions for ${spec.name}`}
        {...webData({ kPress: '' })}
        style={{
          position: 'absolute', top: Math.round((coverH - theme.touchTarget) / 2), right: compact ? 28 : 36,
          width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md,
        }}
      >
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(ink === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.18) }}>
          <Ellipsis size={20} color={ink} strokeWidth={2.2} />
        </View>
      </Pressable>
    </Animated.View>
  );
}
