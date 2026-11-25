export {
  contractIdFor, isSharedRecordId, linkIdFrom, parseShareLink, SHARE_ACCESS, SHARE_CONTRACT_VERSION, SHARE_LIMITS, SHARED_ID_PREFIX,
  shareAuditSchema, shareFieldSchema, shareLinkSchema,
  type ParsedLink, type ShareAccess, type ShareAuditEntry, type ShareField, type ShareLink,
} from './model';
export {
  checkLink, collectionLabel, collectionOf, compatibleTargets, fieldLabel, fieldOf, isFromBazaar, suggestMappings, typesCompatible,
  unmappedRequired,
  type LinkHealth, type LinkProblem, type LinkProblemCode, type MappingSuggestion,
} from './contract';
export { describeLink, humanize, joinList, SHARE_COPY, TYPE_NAME, type LinkSentence } from './copy';
export { entryTitle, projectValues, valueFits } from './project';
export { createMemoryShareLinkStore, newestFirst, ShareStoreError, type ShareLinkStore } from './store';
export {
  createShareService, SharedRecordReadOnlyError,
  type CreateLinkInput, type CreateRefusal, type CreateResult, type LinkView, type Sendable, type SendableResult, type SendInput,
  type SendOutcome, type SendRefusal, type ShareDeps, type ShareLogEvent, type SharedRead, type ShareService,
} from './service';
