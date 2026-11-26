/**
 * Keeps the media session's text items in step with the typed description (docs/06 §6.3): one item per
 * instruction, each with its role and the time it was written. Reads the text, never changes it. Runs
 * shortly after the person stops typing and writes nothing when the text reads the same.
 */
import { useEffect } from 'react';
import { hasInputs, syncTypedText } from '@/core/session/session';
import { useCreationStore } from '@/state/creation-store';
import { updateSession, useMediaStore } from './media-store';

const DELAY_MS = 500;

export function useTypedInstructions(): void {
  const text = useCreationStore((s) => s.text);
  useEffect(() => {
    const timer = setTimeout(() => {
      const session = useMediaStore.getState().session;
      if (!text.trim()) {
        if (!session) return; // clearing the text must not start a session
        if (!hasInputs(session)) {
          // Nothing but typed text held this draft, so the creation store deletes its row. Writing the session
          // again would bring an empty row back: only the instructions in memory are cleared.
          const next = syncTypedText(session, '', Date.now());
          if (next !== session) useMediaStore.setState({ session: next });
          return;
        }
      }
      updateSession((s) => syncTypedText(s, text, Date.now()));
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
}
