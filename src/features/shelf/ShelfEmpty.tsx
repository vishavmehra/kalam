import { Link, router } from 'expo-router';
import { ChevronRight, ClipboardCheck, Flame, LayoutTemplate, type LucideIcon, PenLine, Ruler, Wallet } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { routes } from '@/components/shell/routes';
import { Button, fontFamily, handFamily, ShelfPlank, Slip, Text, useBreakpoint, useHandwritingFont, useKalamTheme, webData } from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { useT } from '@/i18n/react';

import { shelfRoutes } from './routes';

/** Starter ideas (docs/03 §4.4). Choosing one fills in Create; it never makes an app by itself. */
const IDEAS: Array<{ icon: LucideIcon; title: TranslationKey; prompt: TranslationKey }> = [
  { icon: Wallet, title: 'shelf.empty.expenses', prompt: 'shelf.empty.prompt.expenses' },
  { icon: Ruler, title: 'shelf.empty.measurements', prompt: 'shelf.empty.prompt.measurements' },
  { icon: Flame, title: 'shelf.empty.habits', prompt: 'shelf.empty.prompt.habits' },
  { icon: ClipboardCheck, title: 'shelf.empty.attendance', prompt: 'shelf.empty.prompt.attendance' },
];

/**
 * The empty shelf (DIRECTION §6): an empty plank with a ghost register outline, one handwritten line on a
 * blank slip and one action. Starter ideas sit quietly underneath.
 */
export function ShelfEmpty() {
  const theme = useKalamTheme();
  const c = theme.colors;
  const t = useT(theme.uiLanguage);
  const { isPhone } = useBreakpoint();
  useHandwritingFont();
  const ghostH = Math.round(232 * Math.min(theme.fontScale, 1.25));
  // Kalam, the hand face, covers Latin and Devanagari only. Other scripts get their own display face, never a fallback.
  const lineFace = theme.script === 'latin' || theme.script === 'devanagari' ? handFamily() : fontFamily('regular', true, theme.script);
  return (
    <View style={{ gap: 36, paddingTop: isPhone ? 4 : 12 }}>
      <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 20 : 40, alignItems: isPhone ? 'stretch' : 'flex-end' }}>
        <View style={{ width: isPhone ? '100%' : 300, gap: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingHorizontal: 12 }}>
            {/* A ghost register: where the first app will stand. */}
            <View
              aria-hidden
              style={{
                width: 150, height: ghostH, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.borderStrong,
                borderTopStartRadius: 4, borderBottomStartRadius: 4, borderTopEndRadius: 9, borderBottomEndRadius: 9,
                paddingTop: 30, paddingHorizontal: 16, paddingStart: 24,
              }}
            >
              <View style={{ height: 64, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border, borderRadius: 7 }} />
            </View>
          </View>
          <ShelfPlank />
        </View>
        <Slip tint="kraft" style={{ flex: isPhone ? undefined : 1, maxWidth: 560 }}>
          <Text
            accessibilityRole="header"
            style={{ fontFamily: lineFace, fontSize: Math.round(26 * theme.fontScale), lineHeight: Math.round(34 * theme.fontScale), color: c.text }}
          >
            {t('shelf.empty.line')}
          </Text>
          <Text tone="secondary">{t('shelf.empty.body')}</Text>
          <View style={{ alignSelf: isPhone ? 'stretch' : 'flex-start', marginTop: 4, gap: 10, flexDirection: isPhone ? 'column' : 'row', flexWrap: 'wrap' }}>
            <Button label={t('shelf.empty.cta')} icon={PenLine} size="lg" onPress={() => router.push(routes.create)} fullWidth={isPhone} testID="shelf-empty-make" />
            <Button label={t('shelfMore.browseTemplates')} variant="outline" size="lg" icon={LayoutTemplate} onPress={() => router.push(shelfRoutes.templates)} fullWidth={isPhone} testID="shelf-empty-templates" />
          </View>
        </Slip>
      </View>

      <View style={{ gap: 4, maxWidth: 620 }}>
        <Text variant="bodySmall" weight="semibold" tone="secondary" style={{ marginBottom: 4 }}>{t('shelf.empty.ideas')}</Text>
        {IDEAS.map(({ icon: Icon, title, prompt }) => (
          <Link key={title} href={routes.createWithPrompt(t(prompt))} asChild>
            <Pressable
              role="link"
              accessibilityLabel={t('shelf.empty.ideaHint', { title: t(title) })}
              {...webData({ kPress: '', kHover: 'surface' })}
              android_ripple={{ color: c.surfaceAlt }}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 14,
                minHeight: theme.touchTarget + 12, paddingVertical: 8, paddingHorizontal: 12, marginHorizontal: -12,
                borderRadius: theme.radius.press,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: theme.radius.paper, backgroundColor: theme.tints.haldi, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color={c.text} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text weight="semibold">{t(title)}</Text>
                <Text variant="bodySmall" tone="secondary" numberOfLines={1}>{t(prompt)}</Text>
              </View>
              <ChevronRight size={18} color={c.textMuted} />
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}
