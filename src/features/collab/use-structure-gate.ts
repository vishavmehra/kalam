import { canChangeStructure } from '@/core/collab';
import { COLLAB_COPY } from './copy';
import { useSpace } from './use-collab';

/**
 * Only the owner of a shared app changes its design (docs/14 §17). An app that is only on this device is never locked.
 * Not a security wall: the sync engine never uploads a member's design edits. This is the courtesy that says why.
 * While the sharing state is still loading the app counts as unlocked, so a slow read never blocks a solo app.
 */
export function useStructureGate(appId: string): { locked: boolean; message: string } {
  const space = useSpace(appId);
  return { locked: !!space && !canChangeStructure(space.role), message: COLLAB_COPY.errors.structure_owner_only };
}
