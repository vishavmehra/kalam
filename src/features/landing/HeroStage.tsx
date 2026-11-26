import { useState } from 'react';
import { View } from 'react-native';

import { useKalamTheme } from '@/design';
import { localeFor } from '@/i18n/languages';
import { useT } from '@/i18n/react';

import { DONE, HeroField } from './HeroField';
import { HeroPoster } from './HeroPoster';
import { finalApp, stageLayout, stampDate } from './story';

export interface HeroStageProps {
  /** Side column (wide screens) or full-width band. */
  wide: boolean;
}

/**
 * Type and default entry for the landing hero. Metro resolves HeroStage.web.tsx (three.js and GSAP) and
 * HeroStage.native.tsx (Reanimated); this one shows the still final frame.
 */
export function HeroStage({ wide }: HeroStageProps) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const layout = area.width > 0 ? stageLayout(area.width, area.height) : null;
  return (
    <HeroField wide={wide} status={DONE} onAreaLayout={setArea}>
      <View role="img" aria-label={t('landing.stage.label')} style={{ position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 }}>
        {layout ? (
          <HeroPoster
            paper={layout.paper}
            phone={layout.phone}
            stamp={layout.stamp}
            app={finalApp(t('landing.stage.onThisPhone'))}
            stampLabel={t('stamp.checked')}
            stampDate={stampDate(localeFor(theme.uiLanguage))}
          />
        ) : null}
      </View>
    </HeroField>
  );
}
