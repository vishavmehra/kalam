import { useId } from 'react';
import Svg, { ClipPath, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { APP_THEME, BEZEL, FONT_FAMILY, orderAppUI, type AppState, type Prim, SCREEN } from './story';

function prim(p: Prim, i: number) {
  switch (p.kind) {
    case 'rect':
      return <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} fill={p.fill ?? 'none'} stroke={p.stroke} strokeWidth={p.stroke ? p.lw : 0} />;
    case 'path':
      return (
        <G key={i} transform={`translate(${p.x} ${p.y}) scale(${p.s})`}>
          <Path d={p.d} fill="none" stroke={p.stroke} strokeWidth={p.lw} strokeLinecap="round" strokeLinejoin="round" />
        </G>
      );
    case 'text':
      return (
        <SvgText key={i} x={p.x} y={p.y} fontSize={p.size} fontFamily={FONT_FAMILY[p.font]} fill={p.fill} textAnchor={p.anchor ?? 'start'}>
          {p.text}
        </SvgText>
      );
  }
}

/**
 * The example order-book app on a phone, drawn with react-native-svg from the same primitives the WebGL hero
 * paints. Decorative: the stage around it carries the description.
 */
export function OrderPhone({ width, state }: { width: number; state: AppState }) {
  const clip = `op${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const W = SCREEN.w + BEZEL * 2;
  const H = SCREEN.h + BEZEL * 2;
  return (
    <Svg width={width} height={(width * H) / W} viewBox={`${-BEZEL} ${-BEZEL} ${W} ${H}`} aria-hidden>
      <Defs>
        <ClipPath id={clip}>
          <Rect x={0} y={0} width={SCREEN.w} height={SCREEN.h} rx={SCREEN.r} />
        </ClipPath>
      </Defs>
      <Rect x={-BEZEL} y={-BEZEL} width={W} height={H} rx={SCREEN.r + BEZEL} fill={APP_THEME.device} />
      <G clipPath={`url(#${clip})`}>{orderAppUI(state).map(prim)}</G>
    </Svg>
  );
}
