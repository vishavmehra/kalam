/**
 * Actions shared by every attachment row: remove, describe, and answering conflict questions.
 * Removing an attachment stops any work still running on it, and removes its compiler copy from the
 * creation draft and its local files.
 */
import { answerConflict } from '@/core/media/conflicts';
import { addTextInput, removeAttachment, setConflicts, setNote } from '@/core/session/session';
import { useCreationStore } from '@/state/creation-store';
import { releaseRecording } from './audio-intake';
import { releaseVideo } from './video-intake';
import { abortJob, dropAssets, updateSession, useMediaStore } from './media-store';

export function removeMedia(attachmentId: string): void {
  const session = useMediaStore.getState().session;
  const att = session?.attachments.find((a) => a.id === attachmentId);
  if (!att) return;
  abortJob(att.id);
  // Only a video whose frames reached the draft owns the draft's video (a replacement may still be reading).
  const ownsDraftVideo = att.type === 'video' && !!session?.frames.some((f) => f.attachmentId === att.id);
  let removed: string[] = [];
  updateSession((s) => {
    const r = removeAttachment(s, attachmentId, Date.now());
    removed = r.removedAssetIds;
    return r.session;
  });
  const draft = useCreationStore.getState();
  if (att.type === 'audio') releaseRecording(att.id);
  if (att.type === 'image' && att.preparedImageId) draft.removePhoto(att.preparedImageId);
  if (att.type === 'video') {
    releaseVideo(att);
    if (ownsDraftVideo) draft.setVideo(undefined);
  }
  void dropAssets(removed);
}

/** For lists that know only the draft's picture id: removes the attachment too, or just the picture. */
export function removePhotoEverywhere(imageId: string): void {
  const att = useMediaStore.getState().session?.attachments.find((a) => a.preparedImageId === imageId);
  if (att) removeMedia(att.id);
  else useCreationStore.getState().removePhoto(imageId);
}

/** The draft's video and its session attachment, steps and frames. */
export function removeVideoEverywhere(): void {
  for (const a of useMediaStore.getState().session?.attachments.filter((x) => x.type === 'video') ?? []) removeMedia(a.id);
  useCreationStore.getState().setVideo(undefined);
}

export function describeMedia(attachmentId: string, note: string): void {
  updateSession((s) => setNote(s, attachmentId, note, Date.now()));
}

/** Records the answer as a correction (docs/06 §6.4) and marks the conflict resolved. */
export function answerConflictQuestion(conflictId: string, optionId: string): void {
  updateSession((s) => {
    const c = s.conflicts.find((x) => x.id === conflictId);
    const answered = c && answerConflict(c, optionId);
    if (!answered) return s;
    const now = Date.now();
    const next = setConflicts(s, s.conflicts.map((x) => (x.id === conflictId ? answered.conflict : x)), now);
    return addTextInput(next, answered.correction, 'correction', now, { conflictId });
  });
}
