/**
 * Template gallery (docs/14 §12). Import from `@/core/templates/catalog`.
 *
 * Kept apart from `src/core/templates` (the keyword-matched generators used by "Describe it") so the creation
 * pipeline does not load the gallery's sample data.
 */
export {
  CATALOG, SHOWCASE_IDS, galleryCategories, getCatalogEntry, instantiateCatalogEntry, isShowcase, listCatalog, searchCatalog,
  type GalleryCategory, type InstallResult, type InstalledTemplate,
} from './gallery';
export {
  ARCHIVE_CHANGE, SHELF_CATEGORY_LABELS, archivedCount, effectiveCategory, filterShelf, shelfCategories, shelfCategoryOf, withArchived,
  type ShelfCategory, type ShelfCategoryRow, type ShelfFilter,
} from './shelf';
export { TEMPLATE_CATEGORY, categoryOfTemplate } from './categories';
export { resolveSample, sampleProblems, type ResolvedSample } from './sample';
export { CATALOG_CATEGORIES, CATEGORY_LABELS } from './types';
export type { CatalogAccessibility, CatalogCategory, CatalogEntry, InstallChoices, SampleData, SampleRow } from './types';
export { HEALTH_NOTES } from './entries/health-home';
