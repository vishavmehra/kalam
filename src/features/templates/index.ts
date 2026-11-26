/**
 * Templates feature: gallery with preview and "Use this template", vertical starter packs, the clone sheet and the
 * restore confirmation. Self-contained: mount the screens or the sheets, nothing else is needed.
 */
export { TemplatesScreen, type TemplatesScreenProps } from './TemplatesScreen';
export { TemplateGallery, type TemplateGalleryProps } from './TemplateGallery';
export { TemplatePreviewSheet, type TemplatePreviewSheetProps } from './TemplatePreviewSheet';
export { StarterPacks, type StarterPacksProps } from './StarterPacks';
export { CloneSheet, type CloneSheetProps } from './CloneSheet';
export { RestoreConfirmSheet, type RestoreConfirmSheetProps } from './RestoreConfirmSheet';
export { RecordExportSheet, type RecordExportSheetProps } from './RecordExportSheet';
export { ShelfCategoryBar, type ShelfCategoryBarProps } from './ShelfCategoryBar';
export { useArchiveApp, useCloneApp, useInstallPack, useInstallTemplate } from './use-template-actions';
export { emptyListAdd, type EmptyListAdd } from './empty-list-add';
export { cloneApp, installTemplate, type TemplateDb } from './actions';
export { buildPreview, PREVIEW_ROWS, type PreviewBlock, type PreviewScreen, type TemplatePreview } from './model';
export { copy as templatesCopy } from './copy';
