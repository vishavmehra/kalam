/**
 * Intelligent error recovery and run evidence (docs/14 §14, docs/17 §5.4). Mount lines are in the U10 report:
 *   <RecoveryCard error={creationErrorCode(result)} origin="ai" handlers={{ retry }} onDismiss={...} />   where a failed build is shown
 *     (other failures pass their own code or error: backup and import errors carry a stable `.code`)
 *   <RecoveryLogPanel /> and <EvidencePanel />                         in Settings, next to <DiagnosticsPanel />
 */
export { buildEvidence, EVIDENCE_RUN_LIMIT, EVIDENCE_SCHEMA, evidenceFileName, evidenceJson, evidenceRunSchema, type EvidenceRun, type HybridEvidence } from './evidence';
export { EvidencePanel } from './EvidencePanel';
export { actionKey, creationErrorCode, planRecovery, type RecoveryCategory, type RecoveryOrigin, type RecoveryPlan } from './plan';
export { RecoveryCard, type RecoveryCardProps } from './RecoveryCard';
export { RecoveryLogPanel, useRecoveryEntries } from './RecoveryLogPanel';
export { applyRecovery, availableActions, noteDismissed, noteShown, type RecoveryHandlers, type RecoveryResult } from './recover';
