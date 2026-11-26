/** Type shim: Metro resolves `export.web.ts` / `export.native.ts`; tsc checks against the native one. */
export { exportDrawingPages, exportPagePng, renderPageBytes, renderPageJpeg, renderPageThumbnail, saveExportFiles } from './export.native';
