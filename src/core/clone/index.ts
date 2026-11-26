/**
 * Copying and restoring designs, and exporting one entry. Pure TypeScript; the callers read and write storage.
 *  - Clone an app (docs/14 §19): `planClone` then `applyClonePlan`.
 *  - Time Machine restore (docs/14 §11): `previewRestore` then `confirmRestore`.
 *  - One entry as JSON, CSV or text (docs/01 §3.3): `recordToJson`, `recordToCsv`, `recordToText`.
 */
export { CLONE_COPY, cloneDoneMessage } from './copy';
export {
  CLONE_MODES, DEFAULT_CLONE_MODE, applyLookFrom, copiesLook, copiesRecords, countCopyableEntries, countPictures, defaultCloneName, planClone,
  type CloneContext, type CloneErrorCode, type CloneMode, type ClonePlan, type CloneRequest, type CloneResult, type PlannedRecord,
} from './plan';
export { CloneLeftoverError, applyClonePlan, copyOrder, fieldsToRelax, type CloneOutcome, type CloneStore } from './apply';
export {
  RESTORE_COPY, confirmRestore, previewRestore, undoRestoreTarget,
  type PreviewOptions, type RestorePreview, type RestoreRequest,
} from './restore';
export {
  exportedFields, recordFileName, recordTitle, recordToCsv, recordToJson, recordToText,
  type ExportedField, type RecordExportContext, type RecordJson,
} from './record-export';
