import { describe, expect, it } from 'vitest';
import { createFakeAI } from '../../../tests/fixtures/compiler/fake-ai';
import { promptVersionFor } from '../ai/model-config';
import type { NormalizedImage, NormalizedInput, TaskClassification } from '../contracts';
import { SCHEMA_VERSION } from '../spec/schema';
import { compileWithCloud } from './compile';
import { buildCompilerRequest } from './request';

const img = (id: string, source: NormalizedImage['source'] = 'photo'): NormalizedImage => ({
  id, mimeType: 'image/png', base64: 'AAAA'.repeat(50), width: 10, height: 10, source,
});
const cls: TaskClassification = {
  taskType: 'create_app', complexity: 'medium', estimatedScreens: 2, estimatedCollections: 1, estimatedActions: 2,
  requiresMultimodalReasoning: false, requiresCloudReasoning: true, confidence: 0.8, method: 'deterministic', reasons: [],
};

describe('buildCompilerRequest (D06-037, docs/06 §13.2)', () => {
  it('carries session, versions and the request in words', () => {
    const r = buildCompilerRequest({ text: 'a shop book', modalities: ['text'], images: [], language: 'hi' }, { sessionId: 'sess_1' });
    expect(r).toEqual({
      sessionId: 'sess_1',
      context: { text: 'a shop book', modalities: ['text'], language: 'hi', editsExisting: false },
      attachments: [], drawingDocuments: [],
      schemaVersion: SCHEMA_VERSION, promptVersion: promptVersionFor('compiler'),
    });
  });

  it('lists attachments by id and keeps image bytes out of the request', () => {
    const input: NormalizedInput = {
      text: 'x', modalities: ['image', 'video', 'audio', 'drawing'], audioTranscript: 'hello there',
      images: [img('p1'), img('page1', 'drawing'), img('f1', 'video_frame')],
      video: { frames: [img('f1', 'video_frame'), img('f2', 'video_frame')], durationSec: 8 },
      drawing: {
        drawingId: 'd1', pageCount: 1, elements: [{ kind: 'button', label: 'Save', page: 1, bbox: [0, 0, 1, 1] }],
        texts: ['Save'], notes: ['title on top'], images: [img('page1', 'drawing')],
      },
    };
    const r = buildCompilerRequest(input, { sessionId: 's', promptVersion: 'compiler-v9' });
    expect(r.attachments).toEqual([
      { id: 'p1', type: 'image', preparedAssetIds: ['p1'] },
      { id: 'video', type: 'video', preparedAssetIds: ['f1', 'f2'] },
      { id: 'audio', type: 'audio', preparedAssetIds: [] },
    ]);
    expect(r.drawingDocuments).toEqual([{
      id: 'd1', pageCount: 1,
      structuredRepresentation: { elements: input.drawing!.elements, texts: ['Save'], notes: ['title on top'] },
      exportedPageAssetIds: ['page1'],
    }]);
    expect(r.promptVersion).toBe('compiler-v9');
    expect(JSON.stringify(r)).not.toContain('AAAA');
  });

  it('marks an edit of an existing app', () => {
    const r = buildCompilerRequest({ text: 'x', modalities: ['text'], images: [], existingSpec: {} as never }, { sessionId: 's' });
    expect(r.context.editsExisting).toBe(true);
  });
});

describe('compileWithCloud records the session on every model call', () => {
  const bad = { name: 'Broken', screens: [{ id: 'home', title: 'x', components: [{ id: 'b', type: 'bigButton', label: 'Go', action: 'missing' }] }], collections: [], actions: [] };

  it('puts the same sessionId on the first pass and the repair pass', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: bad }) });
    const input: NormalizedInput = { text: 'a book', modalities: ['text'], images: [] };
    const request = buildCompilerRequest(input, { sessionId: 'create_abc12345' });
    await compileWithCloud(input, cls, { ai, appId: 'app_abc12345', request });
    expect(ai.calls.map((c) => c.ctx.taskType)).toEqual(['create_app', 'repair_spec']);
    expect(ai.calls.map((c) => c.ctx.sessionId)).toEqual(['create_abc12345', 'create_abc12345']);
  });

  it('records no session when the caller gave no request', async () => {
    const ai = createFakeAI({ respond: () => ({ raw: bad }) });
    await compileWithCloud({ text: 'a book', modalities: ['text'], images: [] }, cls, { ai, appId: 'app_abc12345' });
    expect(ai.calls.every((c) => c.ctx.sessionId === undefined)).toBe(true);
  });
});
