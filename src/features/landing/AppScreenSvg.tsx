import { ClipPath, Circle, Defs, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { fontFamilies } from '@/design';

import { APP_UI, SCREEN, type UIPrim } from './sketch-data';

const WEIGHT_FAMILY: Record<number, string> = {
  400: fontFamilies.ui, 500: fontFamilies.uiMedium, 600: fontFamilies.uiSemibold, 700: fontFamilies.uiBold,
};

function prim(p: UIPrim, i: number) {
  switch (p.kind) {
    case 'rect':
      return <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.stroke ? 1.5 : 0} />;
    case 'circle':
      return <Circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} />;
    case 'line':
      return <Line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={1} />;
    case 'text':
      return (
        <SvgText key={i} x={p.x} y={p.y} fontSize={p.size} fontFamily={WEIGHT_FAMILY[p.weight]} fill={p.fill} textAnchor={p.anchor ?? 'start'}>
          {p.text}
        </SvgText>
      );
  }
}

/**
 * The rendered sample app as SVG primitives, clipped to the phone screen (360 × 740 units).
 * Place inside an <Svg>; wrap in a <G transform> to position it.
 */
export function AppScreenSvg({ id = 'k-screen' }: { id?: string }) {
  return (
    <G>
      <Defs>
        <ClipPath id={id}>
          <Rect x={0} y={0} width={SCREEN.w} height={SCREEN.h} rx={SCREEN.r} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>{APP_UI.map(prim)}</G>
    </G>
  );
}
