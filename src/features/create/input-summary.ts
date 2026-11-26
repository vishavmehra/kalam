/**
 * Plain-language list of what a creation was built from ("text, voice, 2 photos and 1 drawing").
 * Shown in the input tray and on the review screen so a mixed creation is obvious.
 */
import type { CreationDraft } from '@/features/input/normalize';
import type { TFunction } from '@/i18n/translator';

type DraftLike = Pick<CreationDraft, 'text' | 'photos' | 'voice' | 'video' | 'drawing'>;

/** `inputParts` in the UI language. Join with `useFormat().list`. */
export function inputPartsT(d: DraftLike, t: TFunction): string[] {
  const parts: string[] = [];
  if (d.text.trim()) parts.push(t('create.parts.text'));
  if (d.voice?.transcript.trim()) parts.push(t('create.parts.voice'));
  if (d.photos.length) parts.push(t('create.parts.photos', { count: d.photos.length }));
  if (d.video?.frames.length) parts.push(t('create.parts.video'));
  if (d.drawing) parts.push(t('create.parts.drawing', { count: d.drawing.summary.pageCount }));
  return parts;
}

/** First letter upper case; scripts without case are unchanged. */
export const sentenceCase = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function inputParts(d: DraftLike): string[] {
  const parts: string[] = [];
  if (d.text.trim()) parts.push('text');
  if (d.voice?.transcript.trim()) parts.push('voice');
  if (d.photos.length) parts.push(d.photos.length === 1 ? '1 photo' : `${d.photos.length} photos`);
  if (d.video?.frames.length) parts.push('video');
  if (d.drawing) parts.push(d.drawing.summary.pageCount > 1 ? `a ${d.drawing.summary.pageCount}-screen drawing` : '1 drawing');
  return parts;
}

/** "text, voice and 2 photos" (lower case, joined with a final "and"). */
export function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Text, voice and 2 photos", or an empty string when nothing was added. */
export function inputSummary(d: DraftLike): string {
  const s = joinParts(inputParts(d));
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Clarifying answers as sentences: "Who uses it?" + "my shop staff" gives "Who uses it? my shop staff." */
export function answersToText(questions: readonly string[], answers: readonly string[]): string {
  return questions
    .map((q, i) => [q.trim(), (answers[i] ?? '').trim()] as const)
    .filter(([, a]) => a)
    .map(([q, a]) => `${q} ${a}${/[.!?]$/.test(a) ? '' : '.'}`)
    .join('\n');
}
