/**
 * Creation progress illustration. Default (Android and any non-web platform): the inked app
 * outline (Skia + Reanimated on Android via InkOutline.native). Web resolves BuildStage.web.tsx,
 * a three.js stage where the user's own inputs are pulled into a phone screen.
 */
import { View } from 'react-native';

import type { FragmentKind } from '@/features/landing/scene/kinds';

import { InkOutline } from './InkOutline';

export function BuildStage({ size, kinds: _kinds }: { size: number; kinds: FragmentKind[] }) {
  return (
    <View style={{ width: size * 1.7, height: size * 1.7, alignItems: 'center', justifyContent: 'center' }}>
      <InkOutline size={size} />
    </View>
  );
}
