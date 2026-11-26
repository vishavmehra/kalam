/** Plain-English change history for the Time Machine and the edit preview (docs/14 §11). Pure TypeScript. */
export { describeSpecChanges, describeActionText } from './describe';
export { describePatch } from './patch';
export { summarizeChanges } from './summary';
export { colourName } from './colour';
export { describeFormula, describeCondition, type FormulaNames } from './formula-text';
export {
  buildTimeline, categorizeVersion, diffVersions, filterTimeline, originOf,
  type TimelineDay, type TimelineEntry, type TimelineOptions, type VersionEvent, type VersionOrigin,
} from './timeline';
export {
  CATEGORY_LABELS, CHANGE_CATEGORIES, IMPACT_LABELS, IMPACT_RANK, categoriesOf, groupByCategory, topImpact,
  type ChangeCategory, type ChangeDetail, type ChangeEntry, type ChangeGroup, type ChangeImpact, type ChangeKind,
} from './types';
