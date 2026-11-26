/**
 * The session's own state (docs/06 §3.3). After a restart it says the session is back and how many
 * files are no longer on this device (those rows are marked so the person can replace them). While
 * a file failed or work was cut short, it says the rest of the inputs are safe.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/design';
import { SESSION_LABEL, sessionCopy } from '@/core/media/copy';
import type { SessionStatus } from '@/core/session/machine';
import { reconcileWithDraft } from '@/core/session/session';
import { useCreationStore } from '@/state/creation-store';
import { updateSession, useMediaStore } from './media-store';

/** Build states have their own messages on the create screen; these are the media ones. */
const SHOWN = new Set<SessionStatus>(['attachment_failed', 'preprocessing_failed', 'interrupted', 'cancelled']);
const reconciled = new Set<string>();

/** Once per restored session: marks pictures and frames the draft could not bring back. */
function useSessionRecovery(): { missing: number; at: number } | undefined {
  const hydrated = useMediaStore((m) => m.hydrated);
  const restored = useMediaStore((m) => m.restored);
  const id = useMediaStore((m) => m.session?.id);
  const [result, setResult] = useState<{ missing: number; at: number }>();
  useEffect(() => {
    if (!hydrated || !restored || !id || reconciled.has(id)) return undefined;
    const run = () => {
      reconciled.add(id);
      const draft = useCreationStore.getState();
      const photoIds = new Set(draft.photos.map((p) => p.id));
      const frameIds = new Set(draft.video?.frames.map((f) => f.id) ?? []);
      let missing = 0;
      const s = updateSession((x) => {
        const r = reconcileWithDraft(x, { photoIds, frameIds }, Date.now());
        missing = r.missing;
        return r.session;
      });
      setResult({ missing, at: s.updatedAt });
    };
    if (useCreationStore.persist.hasHydrated()) {
      run();
      return undefined;
    }
    return useCreationStore.persist.onFinishHydration(run);
  }, [hydrated, restored, id]);
  return result;
}

export function SessionStatusNote() {
  const recovery = useSessionRecovery();
  const status = useMediaStore((m) => m.session?.status);
  // The "your session is back" line stays until the person changes something.
  const untouched = useMediaStore((m) => !!recovery && m.session?.updatedAt === recovery.at);
  const lines = [
    untouched && recovery ? (recovery.missing ? sessionCopy.restoredMissing(recovery.missing) : sessionCopy.restored) : '',
    status && SHOWN.has(status) ? SESSION_LABEL[status] : '',
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <View accessibilityLiveRegion="polite">
      {lines.map((line) => <Text key={line} variant="bodySmall" tone="secondary">{line}</Text>)}
    </View>
  );
}
