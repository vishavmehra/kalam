import { type ReactNode } from 'react';
import { View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import { LedgerRule, Screen, Text } from '@/design';

import { copy } from './copy';
import { StarterPacks } from './StarterPacks';
import { TemplateGallery } from './TemplateGallery';

export interface TemplatesScreenProps {
  /** An app was added from a template or a pack. Receives every app added. The caller opens the first or the shelf. */
  onInstalled: (apps: StoredApp[]) => void;
  lang?: string;
  /** Shown when a search finds nothing, for example a button that goes to "Describe it". */
  emptyAction?: ReactNode;
}

/** The whole Templates page: starter packs, then every template. Mount it from a route. */
export function TemplatesScreen({ onInstalled, lang, emptyAction }: TemplatesScreenProps) {
  return (
    <Screen maxWidth={900}>
      <View style={{ gap: 28, paddingBottom: 32 }}>
        <View style={{ gap: 6 }}>
          <Text variant="h1" level={1}>{copy.page.title}</Text>
          <LedgerRule />
          <Text tone="secondary" style={{ marginTop: 8 }}>{copy.page.intro}</Text>
        </View>
        <View style={{ gap: 10 }}>
          <View style={{ gap: 2 }}>
            <Text variant="h3" level={2}>{copy.page.packsTitle}</Text>
            <Text variant="bodySmall" tone="secondary">{copy.page.packsIntro}</Text>
          </View>
          <StarterPacks onInstalled={onInstalled} />
        </View>
        <View style={{ gap: 12 }}>
          <Text variant="h3" level={2}>{copy.page.galleryTitle}</Text>
          <TemplateGallery lang={lang} emptyAction={emptyAction} onInstalled={(app) => onInstalled([app])} />
        </View>
      </View>
    </Screen>
  );
}
