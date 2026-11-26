/**
 * Keeps the session's conflict questions in step with the inputs (docs/06 §12.4): the typed text,
 * the voice note, attached recordings, the drawing and the chosen language and currency.
 * Deterministic and local; runs shortly after the person stops typing.
 */
import { useEffect } from 'react';
import { detectConflicts, mergeConflicts } from '@/core/media/conflicts';
import { identifyLanguage } from '@/core/media/language';
import { isTypedItem } from '@/core/media/text';
import { setConflicts } from '@/core/session/session';
import { useCreationStore } from '@/state/creation-store';
import { updateSession, useMediaStore } from './media-store';

const DELAY_MS = 400;

export function useConflictWatch(): void {
  const text = useCreationStore((s) => s.text);
  const voice = useCreationStore((s) => s.voice);
  const drawing = useCreationStore((s) => s.drawing);
  const preferences = useCreationStore((s) => s.preferences);
  const session = useMediaStore((s) => s.session);

  useEffect(() => {
    const timer = setTimeout(() => {
      const fileText = session?.transcripts.find((t) => t.text.trim());
      const spoken = voice?.transcript.trim()
        ? { attachmentId: 'voice', text: voice.transcript }
        : fileText ? { attachmentId: fileText.attachmentId, text: fileText.text } : undefined;
      const language = spoken ? identifyLanguage(spoken.text, { preferred: preferences.language }) : undefined;
      const detected = detectConflicts({
        texts: [
          ...(text.trim() ? [{ id: 'typed', text }] : []),
          // The typed description is read once, whole; its instructions are the same words again.
          ...(session?.textInputs.filter((t) => t.role !== 'correction' && !isTypedItem(t)).map((t) => ({ id: t.id, text: t.text })) ?? []),
        ],
        ...(spoken ? { transcript: { ...spoken, ...(language ? { language } : {}) } } : {}),
        ...(drawing ? { drawing: drawing.summary } : {}),
        preferences: { language: preferences.language, ...(preferences.currency ? { currency: preferences.currency } : {}) },
      });
      const previous = session?.conflicts ?? [];
      const merged = mergeConflicts(previous, detected);
      if (!session && !merged.length) return;
      if (JSON.stringify(merged) === JSON.stringify(previous)) return;
      updateSession((s) => setConflicts(s, merged, Date.now()));
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, voice, drawing, preferences, session]);
}
