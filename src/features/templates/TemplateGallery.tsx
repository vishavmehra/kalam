import { Search } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import {
  CATEGORY_LABELS, galleryCategories, searchCatalog, type CatalogCategory, type CatalogEntry,
} from '@/core/templates/catalog';
import { Chip, EmptyState, Stamp, Surface, Text, TextField, useBreakpoint, useKalamTheme } from '@/design';

import { useT } from '@/i18n/react';

import { copy } from './copy';
import { MiniRegister } from './MiniRegister';
import { TemplatePreviewSheet } from './TemplatePreviewSheet';

function TemplateCard({ entry, onOpen, wide }: { entry: CatalogEntry; onOpen: (e: CatalogEntry) => void; wide: boolean }) {
  const theme = useKalamTheme();
  const t = useT(theme.uiLanguage);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.card.open(entry.title)}
      accessibilityHint={copy.card.openHint}
      onPress={() => onOpen(entry)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, minHeight: theme.touchTarget, flexBasis: wide ? '48.5%' : '100%', flexGrow: 1 })}
    >
      <Surface radius="paper" padded={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
        <MiniRegister preset={entry.theme} glyph={entry.glyph} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="h4" aria-hidden>{entry.title}</Text>
          <Text variant="bodySmall" tone="secondary" numberOfLines={2} aria-hidden>{entry.description}</Text>
          {/* Honest about how it is made: a ready-made app, no AI model (DIRECTION §7 stamps). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Stamp kind="template" label={t('stamp.template')} size="sm" />
            <Text variant="caption" tone="muted" aria-hidden>{CATEGORY_LABELS[entry.category]}</Text>
          </View>
        </View>
      </Surface>
    </Pressable>
  );
}

export interface TemplateGalleryProps {
  /** An app was saved from a template. The caller usually opens it. */
  onInstalled: (app: StoredApp) => void;
  lang?: string;
  /** Shown under "no template matches" so the person can describe the app instead. */
  emptyAction?: ReactNode;
  initialCategory?: CatalogCategory | 'all';
}

/**
 * Search, category chips and a card for every template. Opening a card shows it with made-up entries and the
 * "Use this template" button. Self-contained: it reads no storage until something is added.
 */
export function TemplateGallery({ onInstalled, lang, emptyAction, initialCategory = 'all' }: TemplateGalleryProps) {
  const { isPhone } = useBreakpoint();
  const wide = !isPhone;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CatalogCategory | 'all'>(initialCategory);
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const categories = useMemo(() => galleryCategories(), []);
  const results = useMemo(() => searchCatalog(query, { category }), [query, category]);

  return (
    <View style={{ gap: 16 }}>
      <TextField
        label={copy.search.label}
        labelHidden
        icon={Search}
        placeholder={copy.search.placeholder}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      <View role="radiogroup" aria-label={copy.search.categoryLabel} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {categories.map((c) => (
          <Chip key={c.id} label={`${c.label} ${c.count}`} role="radio" selected={category === c.id} onPress={() => setCategory(c.id)} />
        ))}
      </View>
      <Text variant="bodySmall" tone="secondary" accessibilityLiveRegion="polite" aria-live="polite">
        {copy.search.results(results.length)}
      </Text>

      {results.length === 0 ? (
        <EmptyState title={copy.search.emptyTitle} description={copy.search.emptyBody} action={emptyAction} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {results.map((e) => <TemplateCard key={e.id} entry={e} onOpen={setOpen} wide={wide} />)}
        </View>
      )}

      <TemplatePreviewSheet
        entry={open}
        lang={lang}
        onClose={() => setOpen(null)}
        onInstalled={(app) => {
          setOpen(null);
          onInstalled(app);
        }}
      />
    </View>
  );
}
