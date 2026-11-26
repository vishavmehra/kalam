import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/design';

import { OrderPhone } from './OrderPhone';
import { type AppState, BEZEL, FIELDS, PEN_RED, READ_SCHEDULE, type Rect, SCREEN, STAMP_VIOLET, type StampPlace } from './story';

// Positions in this file are artwork coordinates and stay physical: a drawn scene is not mirrored (docs/10 §13.6).
export const SKETCH = require('../../../assets/images/brand/hero-sketch-tailor.webp');
export const SKETCH_BLANK = require('../../../assets/images/brand/hero-sketch-tailor-blank.webp');
export const STAMP_FRAME = require('../../../assets/images/brand/stamp-rect.webp');

/**
 * The Checked impression on the photographed page. The page is a thing, not UI (DIRECTION §2.3), so the stamp
 * pad stays the same violet in both themes; the generated frame carries the real ink density. Decorative.
 */
export function PaperStamp({ width, label, date }: { width: number; label: string; date: string }) {
  const height = width * (573 / 900);
  const k = width / 200;
  return (
    <View aria-hidden style={{ width, height }}>
      <Image source={STAMP_FRAME} resizeMode="contain" aria-hidden style={{ position: 'absolute', width, height, tintColor: STAMP_VIOLET, opacity: 0.92 }} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 * k, paddingHorizontal: 22 * k, transform: [{ rotate: '-4deg' }] }}>
        <Svg width={30 * k} height={30 * k} viewBox="0 0 30 30">
          <Path d="M4 15l7 7 15-16" fill="none" stroke={STAMP_VIOLET} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <View style={{ flexShrink: 1, opacity: 0.9 }}>
          <Text weight="bold" numberOfLines={1} style={{ color: STAMP_VIOLET, fontSize: Math.round((label.length > 9 ? 20 : 26) * k), lineHeight: Math.round((label.length > 9 ? 24 : 30) * k) }}>{label}</Text>
          <Text mono numberOfLines={1} style={{ color: STAMP_VIOLET, fontSize: Math.round(12 * k), lineHeight: Math.round(15 * k), letterSpacing: k }}>{date}</Text>
        </View>
      </View>
    </View>
  );
}

/** Phone tilt in the still frame, echoing the 3D pose: turned a little toward the page. */
export const PHONE_TILT = [{ perspective: 1600 }, { rotateY: '-11deg' }, { rotateX: '4deg' }, { rotateZ: '1deg' }];
export const PAPER_TILT = '-2.5deg';

/** One red-pen underline under a field, as an SVG path in page fractions × size. */
export function underlinePath(key: keyof typeof FIELDS, w: number, h: number): string {
  const b = FIELDS[key];
  const y = (b.y + b.h + 0.006) * h;
  const x0 = b.x * w;
  const x1 = (b.x + b.w) * w;
  const m = (x0 + x1) / 2;
  return `M${x0.toFixed(1)} ${y.toFixed(1)} Q${m.toFixed(1)} ${(y - 2.2).toFixed(1)} ${x1.toFixed(1)} ${(y + 0.8).toFixed(1)}`;
}

/** The page with every field read (sindoor underlines) and the Checked stamp, as a still image. */
export function ReadPage({ rect, stamp, stampLabel, stampDate }: { rect: Rect; stamp: StampPlace; stampLabel: string; stampDate: string }) {
  const sw = rect.w * stamp.w;
  return (
    <View
      style={{
        position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        transform: [{ rotate: PAPER_TILT }],
        shadowColor: '#02040F', shadowOpacity: 0.35, shadowRadius: 22, shadowOffset: { width: 0, height: 16 }, elevation: 8,
      }}
    >
      <Image source={SKETCH} resizeMode="cover" aria-hidden style={{ width: rect.w, height: rect.h, borderRadius: 3 }} />
      <Svg aria-hidden width={rect.w} height={rect.h} style={{ position: 'absolute', left: 0, top: 0 }}>
        {READ_SCHEDULE.map((r) => (
          <Path key={r.key} d={underlinePath(r.key, rect.w, rect.h)} stroke={PEN_RED} strokeWidth={Math.max(1.6, rect.w * 0.0045)} strokeLinecap="round" fill="none" opacity={0.9} />
        ))}
      </Svg>
      <View
        style={{
          position: 'absolute', left: rect.w * stamp.cx - sw / 2, top: rect.h * stamp.cy - (sw * 0.637) / 2,
          transform: [{ rotate: `${stamp.rotate + 4}deg` }],
        }}
      >
        <PaperStamp label={stampLabel} date={stampDate} width={sw} />
      </View>
    </View>
  );
}

/** The phone body's corner radius as a fraction of its width (OrderPhone draws the same body). */
export const PHONE_RADIUS = (SCREEN.r + BEZEL) / (SCREEN.w + BEZEL * 2);

/** The phone holding the finished app, tilted like the 3D hero. The shadow follows the rounded body. */
export function TiltedPhone({ rect, state }: { rect: Rect; state: AppState }) {
  return (
    <View
      style={{
        position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: rect.w * PHONE_RADIUS, transform: PHONE_TILT,
        shadowColor: '#02040F', shadowOpacity: 0.45, shadowRadius: 26, shadowOffset: { width: -10, height: 20 }, elevation: 12,
      }}
    >
      <OrderPhone width={rect.w} state={state} />
    </View>
  );
}

/**
 * The still final frame of the story (DIRECTION §4 "default state is the finished state"): shown under reduced
 * motion, before the 3D stage is ready, without WebGL, and as the largest paint while the page loads.
 */
export function HeroPoster({ paper, phone, stamp, app, stampLabel, stampDate }: { paper: Rect; phone: Rect; stamp: StampPlace; app: AppState; stampLabel: string; stampDate: string }) {
  return (
    <>
      <ReadPage rect={paper} stamp={stamp} stampLabel={stampLabel} stampDate={stampDate} />
      <TiltedPhone rect={phone} state={app} />
    </>
  );
}
