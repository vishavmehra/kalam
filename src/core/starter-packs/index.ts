/** Vertical starter packs (docs/14 §20). Import from `@/core/starter-packs`. */
export { PACK_COPY, PACK_UI, type PackCopy } from './copy';
export { PACK_IDS, STARTER_PACKS, getStarterPack, listStarterPacks, packSuggestedModes, type PackId, type StarterPack } from './packs';
export {
  installStarterPack, isTemplateOnShelf, packInstallNotice, planPackInstall,
  type PackInstallItem, type PackInstallOptions, type PackInstallResult, type PackNotice, type PackPlan,
} from './install';
