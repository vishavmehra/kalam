import { View } from 'react-native';

import { SketchStatic } from './SketchStatic';

/**
 * Type/default entry for the onboarding hero. Metro resolves HeroStage.web.tsx (three.js + GSAP)
 * and HeroStage.native.tsx (Skia + Reanimated); this static version is the fallback.
 */
export function HeroStage({ height }: { height: number }) {
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <SketchStatic height={height * 0.94} />
    </View>
  );
}
