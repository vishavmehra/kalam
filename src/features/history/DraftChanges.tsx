import { useMemo } from 'react';

import { describeSpecChanges } from '@/core/history';
import type { KalamSpec } from '@/core/spec/schema';

import { ChangeList } from './ChangeList';

/**
 * "Here is what will change" for an edit draft: the saved design against the proposed one.
 * One line to mount under the draft summary, above Keep and Discard. Reads both specs and writes nothing.
 */
export function DraftChanges({ before, after }: { before: KalamSpec; after: KalamSpec }) {
  const changes = useMemo(() => describeSpecChanges(before, after), [before, after]);
  return <ChangeList changes={changes} />;
}
