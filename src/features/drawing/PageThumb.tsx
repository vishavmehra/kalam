/** Small preview of a screen for the page strip (docs/08 §11.3). Redrawn shortly after the page stops changing. */
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import type { DrawingPage } from '@/core/contracts';
import { useKalamTheme } from '@/design';
import { renderPageThumbnail } from './export';
import { images } from './image-cache';
import { needsScriptFont, pageTextOf } from './model';
import { subscribeTextFonts, textFontsVersion } from './text-fonts';

interface Cached { uri: string; imageVersion: number }
/** Pages are immutable, so a thumbnail is valid for the page object it was drawn from. */
const cache = new WeakMap<DrawingPage, Cached>();
const REDRAW_DELAY_MS = 350;

export function PageThumb({ page, width }: { page: DrawingPage; width: number }) {
  const { colors, radius } = useKalamTheme();
  const height = Math.round((width * page.height) / page.width);
  const hasImages = page.elements.some((e) => e.kind === 'image');
  // Hindi, Tamil and the other scripts show in the right font once it has loaded, so those pages redraw then too.
  const hasIndic = needsScriptFont(pageTextOf(page));
  const [uri, setUri] = useState<string | undefined>(() => cache.get(page)?.uri);
  const [tick, setTick] = useState(0);

  // Photos and fonts arrive after the page does; redraw when they do.
  useEffect(() => (hasImages ? images.subscribe(() => setTick((t) => t + 1)) : undefined), [hasImages]);
  useEffect(() => (hasIndic ? subscribeTextFonts(() => setTick((t) => t + 1)) : undefined), [hasIndic]);

  useEffect(() => {
    const version = (hasImages ? images.version() : 0) + (hasIndic ? textFontsVersion() : 0);
    const hit = cache.get(page);
    if (hit && hit.imageVersion === version) { setUri(hit.uri); return undefined; }
    const timer = setTimeout(() => {
      // Drawn at twice the shown size so it stays sharp on dense screens.
      const next = renderPageThumbnail(page, width * 2);
      if (next) { cache.set(page, { uri: next, imageVersion: version }); setUri(next); }
    }, uri ? REDRAW_DELAY_MS : 0);
    return () => clearTimeout(timer);
    // `uri` is intentionally not a dependency: it only decides the first-draw delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, width, hasImages, hasIndic, tick]);

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width, height, overflow: 'hidden', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
        backgroundColor: colors.surfaceAlt,
      }}
    >
      {uri ? <Image source={{ uri }} alt="" style={{ width, height }} accessibilityIgnoresInvertColors /> : null}
    </View>
  );
}
