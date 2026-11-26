import { Camera, Check, Cloud, Mic, PenLine, PenTool, Smartphone, Type, Video, WifiOff, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Image, ScrollView, View } from 'react-native';
import Svg, { Path, Rect as SvgRect } from 'react-native-svg';

import {
  Button, CheckedImpression, LedgerRule, Register, ShelfPlank, Slip, Stamp, Text, useBreakpoint, useKalamTheme,
  type ClothKind, type StampKind, type TintKind,
  palette,
} from '@/design';
import type { TranslationKey } from '@/i18n/keys';
import { localeFor } from '@/i18n/languages';
import { useT } from '@/i18n/react';

import { SKETCH } from './HeroPoster';
import { FONT_FAMILY, PEN_INK, stampDate } from './story';


/** Example text in its own script (example data, not interface copy). */
function Deva({ children, size = 14, weight = 'deva', color, lines }: { children: string; size?: number; weight?: 'deva' | 'devaSemi'; color?: string; lines?: number }) {
  const theme = useKalamTheme();
  return (
    <Text {...({ lang: 'hi' } as object)} numberOfLines={lines} style={{ fontFamily: FONT_FAMILY[weight], fontSize: size * theme.fontScale, lineHeight: size * 1.45 * theme.fontScale, color: color ?? theme.colors.text }}>
      {children}
    </Text>
  );
}

/** A section heading with the ledger total rule under it, and a short lede. */
export function SectionHead({ title, lede, nativeID }: { title: string; lede: string; nativeID: string }) {
  const { isPhone } = useBreakpoint();
  return (
    <View style={{ gap: 14, maxWidth: 760 }}>
      <View>
        <Text variant="display" level={2} nativeID={nativeID} style={isPhone ? undefined : { maxWidth: 680 }}>{title}</Text>
        <LedgerRule />
      </View>
      <Text variant="bodyLarge" tone="secondary" style={{ maxWidth: 640 }}>{lede}</Text>
    </View>
  );
}

/** The page column: content starts at the normal page edge up to 1440 px, and the column centres beyond that. */
const COLUMN = { width: '100%', maxWidth: 1440, alignSelf: 'center' } as const;

/** Page width and gutters shared by every section. */
export function Section({ children, labelledBy, onLayout }: { children: ReactNode; labelledBy: string; onLayout?: (y: number) => void }) {
  const { isPhone, isDesktop } = useBreakpoint();
  return (
    <View
      role="region"
      aria-labelledby={labelledBy}
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.y) : undefined}
      style={{ ...COLUMN, paddingHorizontal: isPhone ? 16 : 32, paddingVertical: isDesktop ? 96 : 64, gap: isPhone ? 32 : 44 }}
    >
      {children}
    </View>
  );
}

// ─── How it works: five numbered slips ───────────────────────────────────────────────────────────────────

function Material({ icon: Icon, label, children, dark }: { icon: LucideIcon; label: string; children: ReactNode; dark?: boolean }) {
  const theme = useKalamTheme();
  return (
    <View role="listitem" style={{ width: theme.compact ? 104 : 112, gap: 8 }}>
      <View
        style={{
          height: 78, borderRadius: 6, overflow: 'hidden', backgroundColor: dark ? palette.paper.ink : '#FBFAF5',
          shadowColor: palette.paper.ink, shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2,
        }}
      >
        {children}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon size={15} color={theme.colors.textSecondary} strokeWidth={2} />
        <Text variant="bodySmall" weight="semibold" tone="secondary">{label}</Text>
      </View>
    </View>
  );
}

const WAVE = [0.35, 0.6, 0.9, 0.55, 0.8, 1, 0.65, 0.4, 0.75, 0.95, 0.5, 0.3, 0.6, 0.85, 0.45, 0.7, 0.5];

function Waveform() {
  return (
    <View style={{ flex: 1, backgroundColor: palette.paper.haldi, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2.5 }}>
      {WAVE.map((h, i) => <View key={i} style={{ width: 2.5, height: 54 * h, borderRadius: 2, backgroundColor: palette.paper.ink }} />)}
    </View>
  );
}

function RuledSnippet({ text }: { text: string }) {
  return (
    <View style={{ flex: 1, padding: 8, paddingTop: 6 }}>
      {[0, 1, 2, 3].map((i) => <View key={i} style={{ position: 'absolute', start: 0, end: 0, top: 22 + i * 17, height: 1, backgroundColor: 'rgba(31,58,147,0.18)' }} />)}
      <Deva size={11} lines={3} color={palette.paper.ink}>{text}</Deva>
    </View>
  );
}

function PagePhoto() {
  return (
    <View style={{ flex: 1, backgroundColor: '#D9D3C4', padding: 6 }}>
      <View style={{ flex: 1, overflow: 'hidden', borderRadius: 2, transform: [{ rotate: '-3deg' }] }}>
        <Image source={SKETCH} aria-hidden resizeMode="cover" style={{ width: '100%', height: 150 }} />
      </View>
    </View>
  );
}

function FilmFrames() {
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 4, padding: 8, paddingVertical: 12 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flex: 1, borderRadius: 2, overflow: 'hidden', backgroundColor: '#C9C3B4' }}>
          <Image source={SKETCH} aria-hidden resizeMode="cover" style={{ width: 90, height: 110, marginStart: -12 - i * 18, marginTop: -8 - i * 12 }} />
        </View>
      ))}
    </View>
  );
}

function DrawnSheet() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={92} height={64} viewBox="0 0 100 70" fill="none" stroke={PEN_INK} strokeWidth={2} strokeLinecap="round">
        <SvgRect x={28} y={4} width={44} height={62} rx={7} />
        <Path d="M35 16h22M35 27h30M35 38h26" />
        <SvgRect x={35} y={48} width={18} height={9} rx={3} />
      </Svg>
    </View>
  );
}

function UnderstoodRow({ label, kind, last }: { label: string; kind: ReactNode; last?: boolean }) {
  const theme = useKalamTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.border }}>
      <Deva weight="devaSemi" size={14.5}>{label}</Deva>
      {typeof kind === 'string' ? <Text variant="bodySmall" tone="muted">{kind}</Text> : kind}
    </View>
  );
}

function RouteLine({ kind, label, note }: { kind: StampKind; label: string; note: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Stamp kind={kind} label={label} />
      <Text variant="bodySmall" tone="secondary">{note}</Text>
    </View>
  );
}

function Checklist({ items }: { items: string[] }) {
  const theme = useKalamTheme();
  return (
    <View role="list" style={{ gap: 10, flexShrink: 1 }}>
      {items.map((item) => (
        <View key={item} role="listitem" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Check size={18} color={theme.colors.success} strokeWidth={2.4} />
          <Text weight="semibold" style={{ flexShrink: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** A numbered slip whose title is a level-3 heading under the section's level-2 title. */
function Step({ n, title, tint, children }: { n: number; title: string; tint: TintKind; children: ReactNode }) {
  return (
    <Slip number={n} tint={tint} style={{ flex: 1 }}>
      <Text variant="h2" level={3}>{title}</Text>
      {children}
    </Slip>
  );
}

export function HowItWorks({ onLayout }: { onLayout?: (y: number) => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { isDesktop, isPhone } = useBreakpoint();
  const s1 = (
    <Step key="s1" n={1} title={t('landing.how.s1Title')} tint="kraft">
      <Text tone="secondary" style={{ maxWidth: 440 }}>{t('landing.how.s1Body')}</Text>
      <View role="list" aria-label={t('landing.how.trayLabel')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <Material icon={Type} label={t('landing.how.type')}><RuledSnippet text="ग्राहक, नाप, डिलीवरी की तारीख, एडवांस और बाकी" /></Material>
        <Material icon={Camera} label={t('landing.how.photo')}><PagePhoto /></Material>
        <Material icon={Mic} label={t('landing.how.voice')}><Waveform /></Material>
        <Material icon={Video} label={t('landing.how.video')} dark><FilmFrames /></Material>
        <Material icon={PenTool} label={t('landing.how.draw')}><DrawnSheet /></Material>
      </View>
    </Step>
  );
  const s2 = (
    <Step key="s2" n={2} title={t('landing.how.s2Title')} tint="carbon">
      <Text tone="secondary" style={{ maxWidth: 420 }}>{t('landing.how.s2Body')}</Text>
      <View style={{ marginTop: 8, paddingHorizontal: 16, paddingVertical: 4, borderRadius: 8, backgroundColor: theme.colors.surface, ...theme.elevation[1] }}>
        <UnderstoodRow label="ग्राहक का नाम" kind={t('landing.how.kindText')} />
        <UnderstoodRow label="नाप, 3 जगह" kind={t('landing.how.kindInches')} />
        <UnderstoodRow label="डिलीवरी" kind={t('landing.how.kindDate')} />
        <UnderstoodRow label="बाकी ₹" kind={<Stamp kind="plain" size="sm" icon={null} label="कुल − एडवांस" />} last />
      </View>
    </Step>
  );
  const s3 = (
    <Step key="s3" n={3} title={t('landing.how.s3Title')} tint="leaf">
      <View style={{ gap: 14 }}>
        <RouteLine kind="template" label={t('stamp.template')} note={t('landing.how.s3Template')} />
        <RouteLine kind="device" label={t('stamp.device')} note={t('landing.how.s3Device')} />
        <RouteLine kind="cloud" label={t('stamp.cloud')} note={t('landing.how.s3Cloud')} />
      </View>
      <Text tone="secondary">{t('landing.how.s3Foot')}</Text>
    </Step>
  );
  const s4 = (
    <Step key="s4" n={4} title={t('landing.how.s4Title')} tint="violet">
      <View style={{ paddingVertical: 12 }}>
        <CheckedImpression label={t('stamp.checked')} date={stampDate(localeFor(theme.uiLanguage))} width={isPhone ? 200 : 220} />
      </View>
      <Text tone="secondary">{t('landing.how.s4Body')}</Text>
    </Step>
  );
  const s5 = (
    <Step key="s5" n={5} title={t('landing.how.s5Title')} tint="haldi">
      <Text tone="secondary" style={{ maxWidth: 420 }}>{t('landing.how.s5Body')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 }}>
        <View aria-hidden style={{ width: 76, height: 132, borderRadius: 16, borderWidth: 4, borderColor: palette.paper.ink, backgroundColor: '#FBFAF5', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] }}>
          <WifiOff size={26} color={palette.paper.sindoorInk} strokeWidth={2} />
        </View>
        <Checklist items={[t('landing.how.s5Offline'), t('landing.how.s5Share')]} />
      </View>
    </Step>
  );
  // Desktop: 7:5 then 4:3.5:4.5, like the comp. Tablet: one wide slip, then pairs. Phone: one column.
  // One list that wraps, so every slip is a direct item of it: each slip's basis is its share of 90 % (a row never
  // has room for the next slip) and it grows by the same share, so a row keeps the ratio.
  const share = isDesktop ? [7, 5, 4, 3.5, 4.5].map((r) => r / 12) : isPhone ? [1, 1, 1, 1, 1] : [1, 0.5, 0.5, 0.5, 0.5];
  return (
    <Section labelledBy="landing-how" onLayout={onLayout}>
      <SectionHead nativeID="landing-how" title={t('landing.how.title')} lede={t('landing.how.lede')} />
      <View role="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 22, alignItems: 'stretch' }}>
        {[s1, s2, s3, s4, s5].map((slip, i) => (
          <View key={i} role="listitem" style={{ flexBasis: `${share[i]! * 90}%`, flexGrow: share[i], flexShrink: 0 }}>{slip}</View>
        ))}
      </View>
    </Section>
  );
}

// ─── The shelf: example apps as cloth-bound registers ────────────────────────────────────────────────────

interface Example { cloth: ClothKind; name: string; lang: string; en: TranslationKey; stat: TranslationKey; source: StampKind; height: number; cord?: boolean }

const EXAMPLES: Example[] = [
  { cloth: 'green', name: 'दर्ज़ी ऑर्डर बुक', lang: 'hi', en: 'landing.shelf.tailor', stat: 'landing.shelf.tailorStat', source: 'cloud', height: 400 },
  { cloth: 'lal', name: 'उधार खाता', lang: 'hi', en: 'landing.shelf.kirana', stat: 'landing.shelf.kiranaStat', source: 'device', height: 384, cord: true },
  // Example names stay in Devanagari: the page loads only the Devanagari faces, so nothing falls back to a system font.
  { cloth: 'neel', name: 'ट्यूशन फ़ीस', lang: 'hi', en: 'landing.shelf.tuition', stat: 'landing.shelf.tuitionStat', source: 'device', height: 404 },
  { cloth: 'kraft', name: 'हाजिरी रजिस्टर', lang: 'hi', en: 'landing.shelf.attendance', stat: 'landing.shelf.attendanceStat', source: 'template', height: 372 },
  { cloth: 'haldi', name: 'घर का खर्च', lang: 'hi', en: 'landing.shelf.home', stat: 'landing.shelf.homeStat', source: 'template', height: 392 },
  { cloth: 'ocean', name: 'दुधाचा हिशोब', lang: 'mr', en: 'landing.shelf.milk', stat: 'landing.shelf.milkStat', source: 'device', height: 380 },
];

const SHELF_ROW = 1280;

const STAMP_LABEL: Record<'template' | 'device' | 'cloud', TranslationKey> = { template: 'stamp.template', device: 'stamp.device', cloud: 'stamp.cloud' };

export function ShelfExamples({ onLayout }: { onLayout?: (y: number) => void }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { width, isPhone } = useBreakpoint();
  // Six covers in one row need about 180 px each so names and captions never cut; narrower screens scroll the shelf.
  const row = width >= SHELF_ROW;
  const covers = EXAMPLES.map((e) => (
    <View key={e.name} role="listitem" style={row ? { flex: 1, minWidth: 0 } : { width: isPhone ? 196 : 210 }}>
      <Register
        cloth={e.cloth}
        name={e.name}
        lang={e.lang}
        subtitle={t(e.en)}
        stat={t(e.stat)}
        cord={e.cord}
        height={e.height}
        footer={
          <View style={{ gap: 8 }}>
            <Stamp kind={e.source} size="sm" label={t(STAMP_LABEL[e.source as 'template' | 'device' | 'cloud'])} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <WifiOff size={14} color={e.cloth === 'kraft' || e.cloth === 'haldi' ? '#1A1406' : '#EBEBEB'} strokeWidth={2.2} />
              <Text variant="caption" weight="semibold" style={{ color: e.cloth === 'kraft' || e.cloth === 'haldi' ? '#1A1406' : '#EBEBEB' }}>{t('landing.shelf.opensOffline')}</Text>
            </View>
          </View>
        }
      />
    </View>
  ));
  return (
    <Section labelledBy="landing-shelf" onLayout={onLayout}>
      <SectionHead nativeID="landing-shelf" title={t('landing.shelf.title')} lede={t('landing.shelf.lede')} />
      <View>
        {row ? (
          <View role="list" aria-label={t('landing.shelf.label')} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 22, paddingHorizontal: 8 }}>{covers}</View>
        ) : (
          <ScrollView horizontal snapToInterval={(isPhone ? 196 : 210) + 16} decelerationRate="fast" showsHorizontalScrollIndicator={false}>
            {/* The list wraps the covers directly, so each listitem is a child of the list (the scroller adds a div). */}
            <View role="list" aria-label={t('landing.shelf.label')} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16, paddingHorizontal: 4, paddingTop: 12 }}>
              {covers}
            </View>
          </ScrollView>
        )}
        <ShelfPlank />
      </View>
    </Section>
  );
}

// ─── Making an app: a preview of the Create window ────────────────────────────────────────────────────────

function TrayTile({ caption, sub, mark, children }: { caption: string; sub?: string; mark: 'cloud' | 'device'; children: ReactNode }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const Mark = mark === 'cloud' ? Cloud : Smartphone;
  const ink = mark === 'cloud' ? theme.colors.info : theme.colors.success;
  return (
    <View role="listitem" style={{ width: theme.compact ? 140 : 150, gap: 6 }}>
      <View style={{ height: 96, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
        {children}
        <View
          accessible
          accessibilityLabel={mark === 'cloud' ? t('landing.create.cloudMark') : t('landing.create.deviceMark')}
          role="img"
          style={{ position: 'absolute', end: 6, bottom: 6, width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, borderColor: ink, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}
        >
          <Mark size={14} color={ink} strokeWidth={2.2} />
        </View>
      </View>
      <Text variant="bodySmall" weight="semibold">{caption}</Text>
      {sub ? <Text variant="caption" tone="muted">{sub}</Text> : null}
    </View>
  );
}

const COMPOSER_TEXT = 'मेरी सिलाई की दुकान के लिए ऑर्डर बुक। ग्राहक का नाम, फ़ोन, नाप, डिलीवरी की तारीख, कुल, एडवांस और बाकी अपने आप';

export function CreatePreview({ onMake, busy }: { onMake: () => void; busy: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const c = theme.colors;
  const { isDesktop, isPhone } = useBreakpoint();
  return (
    <Section labelledBy="landing-create">
      <SectionHead nativeID="landing-create" title={t('landing.create.title')} lede={t('landing.create.lede')} />
      <View style={{ flexDirection: isDesktop ? 'row' : 'column', borderRadius: 12, overflow: 'hidden', backgroundColor: c.surface, ...theme.elevation[2] }}>
        <View style={{ flex: 1, padding: isPhone ? 18 : 32, gap: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Text variant="h3" level={3}>{t('landing.create.window')}</Text>
            <Stamp kind="plain" size="sm" label={t('landing.create.example')} />
          </View>
          <View aria-hidden style={{ borderRadius: 8, borderWidth: 1.25, borderColor: c.borderStrong, backgroundColor: c.surfaceElevated, paddingVertical: 10, paddingHorizontal: 16, minHeight: 120, overflow: 'hidden' }}>
            {[0, 1, 2, 3].map((i) => <View key={i} style={{ position: 'absolute', start: 0, end: 0, top: 40 + i * 31, height: 1, backgroundColor: theme.scheme === 'dark' ? 'rgba(157,174,255,0.18)' : 'rgba(34,52,194,0.14)' }} />)}
            <Deva size={isPhone ? 15.5 : 17}>{COMPOSER_TEXT}</Deva>
          </View>
          <View style={{ gap: 12 }}>
            <Text weight="semibold">{t('landing.create.inThisApp')}</Text>
            <View role="list" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              <TrayTile caption={t('landing.create.description')} mark="cloud">
                <View style={{ flex: 1, backgroundColor: '#FBFAF5' }}><RuledSnippet text={COMPOSER_TEXT} /></View>
              </TrayTile>
              <TrayTile caption={t('landing.create.photo')} mark="cloud"><PagePhoto /></TrayTile>
              <TrayTile caption={t('landing.create.voice')} mark="device"><Waveform /></TrayTile>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, padding: 16, borderRadius: 8, backgroundColor: c.infoSoft, alignItems: 'flex-start' }}>
            <Cloud size={18} color={c.info} strokeWidth={2.2} />
            <Text variant="bodySmall" style={{ flex: 1 }}>{t('landing.create.honest')}</Text>
          </View>
        </View>
        <View style={{ width: isDesktop ? 340 : undefined, padding: isPhone ? 18 : 32, gap: 16, justifyContent: 'flex-end', borderStartWidth: isDesktop ? 1 : 0, borderTopWidth: isDesktop ? 0 : 1, borderColor: c.border, backgroundColor: c.background }}>
          <Stamp kind="cloud" label={t('landing.create.forecast')} />
          <Text tone="secondary">{t('landing.create.forecastBody')}</Text>
          <Button label={t('landing.hero.make')} icon={PenLine} size="lg" onPress={onMake} loading={busy} fullWidth />
        </View>
      </View>
    </Section>
  );
}

// ─── Close and footer ─────────────────────────────────────────────────────────────────────────────────────

export function Close({ onMake, busy }: { onMake: () => void; busy: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const { isPhone } = useBreakpoint();
  return (
    <Section labelledBy="landing-close">
      <View style={{ gap: 28, alignItems: 'flex-start' }}>
        <Text variant="display" level={2} nativeID="landing-close" style={{ maxWidth: 760 }}>
          {t('landing.close.line1')} <Text variant="display" level={0} tone="primary">{t('landing.close.line2')}</Text>
        </Text>
        <Button label={t('landing.hero.make')} icon={PenLine} size="lg" onPress={onMake} loading={busy} fullWidth={isPhone} />
      </View>
    </Section>
  );
}
