import { Archive } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';

import type { StoredApp } from '@/core/contracts';
import { archivedCount, effectiveCategory, shelfCategories, type ShelfCategory } from '@/core/templates/catalog/shelf';
import { Chip } from '@/design';

import { copy } from './copy';

export interface ShelfCategoryBarProps {
  apps: readonly Pick<StoredApp, 'spec' | 'origin' | 'archived'>[];
  category: ShelfCategory | 'all';
  onCategory: (c: ShelfCategory | 'all') => void;
  /** The archive is open instead of the main shelf. */
  archived: boolean;
  onArchived: (open: boolean) => void;
}

/**
 * Category chips for the shelf (docs/00 §21) with a switch to the archive. Shows nothing when every app is in one
 * category and none is archived, because a filter would only get in the way. A category that no app has any more shows
 * as "All" here and in `filterShelf`, so the person is never left with an empty shelf and no chip to clear it.
 */
export function ShelfCategoryBar({ apps, category, onCategory, archived, onArchived }: ShelfCategoryBarProps) {
  const rows = useMemo(() => shelfCategories(apps), [apps]);
  const stored = archivedCount(apps);
  const current = effectiveCategory(apps, category);
  if (rows.length <= 2 && stored === 0 && !archived) return null;
  return (
    <View role="radiogroup" aria-label={copy.shelf.label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {archived ? null : rows.map((r) => (
        <Chip key={r.id} label={`${r.label} ${r.count}`} role="radio" selected={current === r.id} onPress={() => onCategory(r.id)} />
      ))}
      {stored > 0 || archived ? (
        <Chip
          label={archived ? copy.shelf.backToShelf : copy.shelf.archive(stored)}
          icon={Archive}
          role="radio"
          selected={archived}
          onPress={() => onArchived(!archived)}
        />
      ) : null}
    </View>
  );
}
