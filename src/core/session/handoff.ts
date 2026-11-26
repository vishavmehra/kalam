/**
 * Session → compiler handoff (docs/06 §9.7, §12.6, §13.1-13.3). Adds what the media session knows to
 * the NormalizedInput the pipeline already accepts: the reviewed video workflow with timestamps,
 * frames labelled with their times, the person's notes on attachments and their answers to
 * conflicts. Also reports which pictures the compiler's six-picture budget leaves out.
 */
import type { NormalizedImage, NormalizedInput } from '@/core/contracts';
import { attachmentCopy, handoffCopy } from '@/core/media/copy';
import { formatClock } from '@/core/media/frames';
import { workflowSummaryText } from '@/core/media/workflow';
import type { MediaAttachment } from '@/core/media/types';
import type { MediaSession } from './session';

/** Same cap as core/compiler/prompt.ts collectImages. */
export const COMPILER_IMAGE_BUDGET = 6;
const MAX_TEXT = 4000;

/** "Photo 2", "Recording 1": the name a person sees, in the interface language. */
export function attachmentName(s: MediaSession, a: MediaAttachment): string {
  const n = s.attachments.filter((x) => x.type === a.type).indexOf(a) + 1;
  return a.type === 'image' ? attachmentCopy.photoName(n) : a.type === 'audio' ? attachmentCopy.audioName(n) : attachmentCopy.videoName(n);
}

/** The same names in English, for the lines the compiler reads. */
function handoffName(s: MediaSession, a: MediaAttachment): string {
  const n = s.attachments.filter((x) => x.type === a.type).indexOf(a) + 1;
  return a.type === 'image' ? handoffCopy.photoName(n) : a.type === 'audio' ? handoffCopy.audioName(n) : handoffCopy.videoName(n);
}

/** Relabels video frames with their recovered times so the compiler can order events. */
export function labelFrames(frames: readonly NormalizedImage[], s: MediaSession): NormalizedImage[] {
  const timed = new Map(s.frames.map((f) => [f.assetId, f.timestampMs]));
  let n = 0;
  return frames.map((f) => {
    const t = timed.get(f.id);
    if (t === undefined) return f;
    n++;
    return { ...f, label: handoffCopy.frameLabel(n, formatClock(t)) };
  });
}

const SEP = '\n\n';

/**
 * One line per attachment the person described. A video's note and steps normally travel with its
 * frames (`video.summary`); when no frames are sent (extraction failed, or the frames are gone) they
 * go here instead, so what the person typed is never dropped (docs/06 §14.3).
 */
function noteLines(s: MediaSession, videoSent: boolean): string[] {
  const lines = s.attachments
    .filter((a) => a.note?.trim() && (a.type !== 'video' || !videoSent))
    .map((a) => `- ${handoffCopy.noteLine(handoffName(s, a), a.note!.trim())}`);
  if (!videoSent) {
    for (const w of s.workflows) {
      const text = s.attachments.some((a) => a.id === w.attachmentId) ? workflowSummaryText(w) : '';
      if (text) lines.push(text);
    }
  }
  return lines;
}

const corrections = (s: MediaSession) => s.textInputs.filter((t) => t.role === 'correction').map((t) => `- ${t.text}`);

/** The text block of notes and corrections, or '' when there is nothing to add. */
export function sessionNotes(s: MediaSession, videoSent = true): string {
  const notes = noteLines(s, videoSent);
  const fixes = corrections(s);
  const blocks: string[] = [];
  if (notes.length) blocks.push([handoffCopy.notesHeading, ...notes].join('\n'));
  if (fixes.length) blocks.push([handoffCopy.correctionsHeading, ...fixes].join('\n'));
  return blocks.join(SEP);
}

/** The session holds something the compiler can use on its own: a described file or a recording's text. */
export function sessionAddsInput(s: MediaSession): boolean {
  if (noteLines(s, false).length) return true;
  return s.attachments.some((a) => a.type === 'audio' && a.status !== 'failed' && !!s.transcripts.find((t) => t.attachmentId === a.id)?.text.trim());
}

/** Video summary text: the person's note, then the workflow (reviewed or not) with times. */
export function videoSummary(s: MediaSession): string | undefined {
  const video = s.attachments.find((a) => a.type === 'video' && a.status !== 'failed');
  if (!video) return undefined;
  const w = s.workflows.find((x) => x.attachmentId === video.id);
  const parts = [video.note?.trim() ? handoffCopy.videoNote(video.note.trim()) : '', w ? workflowSummaryText(w) : ''];
  const text = parts.filter(Boolean).join('\n');
  return text ? text.slice(0, 2000) : undefined;
}

export interface SessionHandoff {
  input: NormalizedInput;
  /** Plain-English notices about anything left out (docs/06 §12.5, §13.3). Show them before building. */
  notices: string[];
}

/**
 * NormalizedInput enriched with the session. The person's own text comes first. The compiler reads
 * at most MAX_TEXT characters, so answers to Kalam's questions get their room first (shortening the
 * end of a very long description if they must), then notes fit in what is left. Whatever is cut is
 * named in `notices`, never dropped silently.
 */
export function prepareHandoff(input: NormalizedInput, s: MediaSession): SessionHandoff {
  const out: NormalizedInput = { ...input };
  const notices: string[] = [];
  const videoSent = !!input.video?.frames.length;

  const fixes = corrections(s);
  const fixBlock = fixes.length ? [handoffCopy.correctionsHeading, ...fixes].join('\n').slice(0, MAX_TEXT) : '';
  let typed = input.text;
  if (fixBlock && typed && typed.length + SEP.length + fixBlock.length > MAX_TEXT) {
    typed = typed.slice(0, Math.max(0, MAX_TEXT - SEP.length - fixBlock.length)).trimEnd();
    notices.push(handoffCopy.descriptionShortened);
  }
  let notes = '';
  let left = 0;
  for (const line of noteLines(s, videoSent)) {
    const next = notes ? `${notes}\n${line}` : `${handoffCopy.notesHeading}\n${line}`;
    if ([typed, next, fixBlock].filter(Boolean).join(SEP).length <= MAX_TEXT) notes = next;
    else left++;
  }
  if (left) notices.push(handoffCopy.notesLeftOut(left));
  if (notes || fixBlock) {
    out.text = [typed, notes, fixBlock].filter(Boolean).join(SEP);
    if (!out.modalities.includes('text')) out.modalities = [...out.modalities, 'text'];
  }

  const heard = s.attachments
    .filter((a) => a.type === 'audio' && a.status !== 'failed')
    .flatMap((a) => {
      const t = s.transcripts.find((x) => x.attachmentId === a.id)?.text.trim();
      return t ? [`${handoffName(s, a)}: ${t}`] : [];
    });
  if (heard.length) {
    out.audioTranscript = [input.audioTranscript?.trim(), ...heard].filter(Boolean).join(SEP).slice(0, MAX_TEXT);
    if (!out.modalities.includes('audio')) out.modalities = [...out.modalities, 'audio'];
  }
  if (input.video && videoSent) {
    const summary = videoSummary(s);
    out.video = { ...input.video, frames: labelFrames(input.video.frames, s), ...(summary ? { summary } : {}) };
  }
  const budget = imageBudget(out);
  if (budget.notice) notices.push(budget.notice);
  return { input: out, notices };
}

/** NormalizedInput enriched with the session (see `prepareHandoff`). */
export const applySession = (input: NormalizedInput, s: MediaSession): NormalizedInput => prepareHandoff(input, s).input;

export interface ImageBudget {
  includedIds: string[];
  excluded: Array<{ id: string; source: NormalizedImage['source']; label?: string }>;
  /** Plain-English notice when something is left out (docs/06 §13.3). */
  notice?: string;
}

/** Mirrors collectImages' order (drawing pages, photos, video frames) and says what does not fit. */
export function imageBudget(input: NormalizedInput, max = COMPILER_IMAGE_BUDGET): ImageBudget {
  const all = [...(input.drawing?.images ?? []), ...input.images, ...(input.video?.frames ?? [])];
  const seen = new Set<string>();
  const includedIds: string[] = [];
  const excluded: ImageBudget['excluded'] = [];
  for (const img of all) {
    if (seen.has(img.id)) continue;
    seen.add(img.id);
    if (includedIds.length < max) includedIds.push(img.id);
    else excluded.push({ id: img.id, source: img.source, ...(img.label ? { label: img.label } : {}) });
  }
  if (!excluded.length) return { includedIds, excluded };
  const counts = new Map<string, number>();
  for (const e of excluded) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  const parts = [...counts].map(([src, n]) => handoffCopy.excludedPart(src as NormalizedImage['source'], n));
  return { includedIds, excluded, notice: handoffCopy.excluded(parts, max) };
}
