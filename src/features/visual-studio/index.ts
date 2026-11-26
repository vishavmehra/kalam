/**
 * Visual App Studio (docs/14 §4): direct manipulation on the running preview, plus undo and redo for
 * the editor's pending changes. Mount lines for EditAppScreen are in the wave-10 U7 report.
 * ponytail: resize and full width write style.size and style.fullWidth into the spec, but the runtime
 * does not draw them until KalamRuntime wraps parts in StyleFrame (runtime/ui/v11). Until then the
 * preview does not change when a part is resized, so D14-016 stays open.
 */
export { VisualStudio, type VisualStudioProps } from './VisualStudio';
export { UndoRedo, type UndoRedoProps } from './UndoRedo';
export { useDraftHistory } from './use-draft-history';
export { filledCollections } from './model';
