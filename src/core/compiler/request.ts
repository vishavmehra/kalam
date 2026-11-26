/**
 * The typed hand-off to the compiler (docs/06 §13.2, D06-037). Metadata only: ids of what is attached, the request in
 * words, and the schema and prompt versions. The image bytes go to the model as parts of the call (compile.ts), never
 * inside this object.
 */
import { promptVersionFor } from '../ai/model-config';
import type { CompilerRequest, NormalizedInput } from '../contracts';
import { SCHEMA_VERSION } from '../spec/schema';

export function buildCompilerRequest(
  input: NormalizedInput,
  opts: { sessionId: string; promptVersion?: string; schemaVersion?: string },
): CompilerRequest {
  const drawingPages = new Set(input.drawing?.images.map((i) => i.id));
  const frames = new Set(input.video?.frames.map((f) => f.id));
  // Pages of the sketch belong to the drawing and a video's frames are one attachment; every other picture is its own.
  const photos = input.images.filter((i) => !drawingPages.has(i.id) && !frames.has(i.id));
  const attachments: CompilerRequest['attachments'] = photos.map((i) => ({ id: i.id, type: 'image', preparedAssetIds: [i.id] }));
  if (input.video) attachments.push({ id: 'video', type: 'video', preparedAssetIds: input.video.frames.map((f) => f.id) });
  // A spoken request reaches the compiler as its transcript; the recording itself stays on the device.
  if (input.audioTranscript?.trim()) attachments.push({ id: 'audio', type: 'audio', preparedAssetIds: [] });
  const d = input.drawing;
  return {
    sessionId: opts.sessionId,
    context: {
      text: input.text,
      modalities: input.modalities,
      ...(input.audioTranscript ? { audioTranscript: input.audioTranscript } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.preferences ? { preferences: input.preferences } : {}),
      editsExisting: !!input.existingSpec,
    },
    attachments,
    drawingDocuments: d
      ? [{
          id: d.drawingId, pageCount: d.pageCount,
          structuredRepresentation: { elements: d.elements, texts: d.texts, ...(d.notes ? { notes: d.notes } : {}) },
          exportedPageAssetIds: d.images.map((i) => i.id),
        }]
      : [],
    schemaVersion: opts.schemaVersion ?? SCHEMA_VERSION,
    promptVersion: opts.promptVersion ?? promptVersionFor('compiler'),
  };
}
