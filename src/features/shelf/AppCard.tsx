import { Ellipsis, Pin } from 'lucide-react-native';
import { type ComponentRef, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import {
  clothForPreset, clothLabel, cloths, luminance, type MenuAnchor, OfflineIcon, palette, Register, Stamp, type StampKind, Text, useKalamTheme, webData, withAlpha,
} from '@/design';
import { InAccountBadge } from '@/features/account';
import { SyncStatusBadge } from '@/features/collab';
import { useFormat, useT } from '@/i18n/react';
import type { TranslationKey } from '@/i18n/keys';

/** How the app was built, as the stamp on its cover. Manual and imported apps get a plain stamp. */
const BUILT: Record<StoredApp['origin']['route'], { kind: StampKind; label: TranslationKey }> = {
  template: { kind: 'template', label: 'stamp.template' },
  'template+on_device': { kind: 'device', label: 'stamp.device' },
  cloud: { kind: 'cloud', label: 'stamp.cloud' },
  'cloud+repair': { kind: 'cloud', label: 'stamp.cloud' },
  specialist: { kind: 'cloud', label: 'stamp.cloud' },
  manual: { kind: 'plain', label: 'shelf.stamp.manual' },
  import: { kind: 'plain', label: 'shelf.stamp.import' },
};

export interface AppCardProps {
  app: StoredApp;
  /** Cover height; covers on one shelf vary a little, like real registers. */
  height: number;
  /** Saved entries in the app, once counted. */
  entries?: number;
  onOpen: (app: StoredApp) => void;
  onMenu: (app: StoredApp, anchor: MenuAnchor | null) => void;
}

/**
 * An app on the shelf, drawn as a cloth-bound register (DIRECTION §6): the cloth matches the app's own
 * theme, the name sits on the white label in the app's own script, entries in Courier Prime, then the stamp
 * for how it was built and "Opens offline". The actions menu sits on the cover's top corner, outside the
 * label, so it never covers the name.
 */
export function AppCard({ app, height, entries, onOpen, onMenu }: AppCardProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { relativeTime } = useFormat(theme.uiLanguage);
  const more = useRef<ComponentRef<typeof Pressable> | null>(null);
  const [pressed, setPressed] = useState(false);
  const { spec } = app;
  const cloth = clothForPreset(spec.theme.preset);
  const fg = cloths[cloth].fg;
  // Paper: stamps sit on the label white like the comp. Ink night: the stamp's own dark wash keeps its light ink readable.
  const coverWash = theme.scheme === 'dark' ? undefined : clothLabel.bg;
  const description = spec.description || spec.meta.description || t('shelf.screens', { count: spec.screens.length });
  const stat = entries === undefined ? undefined : entries === 0 ? t('shelf.noEntries') : t('shelf.entries', { count: entries });
  const when = app.lastOpenedAt
    ? t('shelf.opened', { when: relativeTime(app.lastOpenedAt) })
    : t('shelf.made', { when: relativeTime(app.createdAt) });
  const built = BUILT[app.origin.route];

  const openMenu = () => {
    const node = more.current;
    if (!node) return onMenu(app, null);
    node.measureInWindow((x, y, w, h) => onMenu(app, { x, y, width: w, height: h }));
  };

  const label = [spec.name, description, stat, when, built ? t(built.label) : null, t('shelf.opensOffline'), app.pinned ? t('shelf.pinned') : null]
    .filter(Boolean)
    .join('. ');

  // The cover and its menu button lift and sink together, so the button never slides over the cloth.
  // Hovering the button keeps the whole register lifted. Reduced motion: no lift, no sink.
  const motion = !theme.reducedMotion;
  return (
    <View
      {...webData({ kPress: '', kHover: motion ? 'lift' : 'none' })}
      style={[{ position: 'relative' }, pressed && motion ? { transform: [{ translateY: 4 }] } : null]}
    >
      <Pressable
        onPress={() => onOpen(app)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        role="button"
        accessibilityLabel={label}
        testID={`shelf-app-${app.id}`}
      >
        <Register
          cloth={cloth}
          name={spec.name}
          lang={spec.lang}
          subtitle={description}
          stat={stat}
          height={height}
          footer={
            <>
              {built ? <Stamp kind={built.kind} label={t(built.label)} size="sm" wash={coverWash} /> : null}
              {/* Each renders nothing unless the app is shared or the account holds a copy. No press handler: the cover is the button. */}
              <SyncStatusBadge appId={app.id} />
              <InAccountBadge app={app} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 }}>
                <OfflineIcon size={14} color={fg} strokeWidth={2.2} />
                <Text variant="caption" weight="semibold" style={{ color: fg }}>{t('shelf.opensOffline')}</Text>
                {app.pinned ? <Pin size={14} color={fg} strokeWidth={2.2} style={{ marginStart: 4 }} /> : null}
              </View>
            </>
          }
        />
      </Pressable>
      <Pressable
        ref={(n) => { more.current = n; }}
        onPress={openMenu}
        role="button"
        accessibilityLabel={t('shelf.menuFor', { name: spec.name })}
        hitSlop={4}
        {...webData({ kPress: '' })}
        style={{
          position: 'absolute', top: 4, end: 4,
          width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.press,
        }}
      >
        <View style={{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(luminance(fg) > 0.5 ? palette.paper.ink : palette.paper.sheet, 0.2) }}>
          <Ellipsis size={20} color={fg} strokeWidth={2.4} />
        </View>
      </Pressable>
    </View>
  );
}
