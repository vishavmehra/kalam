import { describe, expect, it } from 'vitest';
import type { NormalizedInput } from '@/core/contracts';
import { isTypedItem, MAX_TYPED_ITEMS, roleOf, splitInstructions } from '@/core/media/text';
import { addTextInput, createSession, hasInputs, parseSession, prepareHandoff, syncTypedText } from './index';

describe('typed text as instructions (docs/06 §6.3)', () => {
  it('reads paragraphs and list lines as separate instructions, keeping the words', () => {
    expect(splitInstructions('Create a medicine tracker.\n\nIt should have morning, afternoon and evening doses.')).toEqual([
      'Create a medicine tracker.', 'It should have morning, afternoon and evening doses.',
    ]);
    expect(splitInstructions('A shop book with:\n- customer name\n- amount owed, over\n  two lines\n3) due date')).toEqual([
      'A shop book with:', 'customer name', 'amount owed, over two lines', 'due date',
    ]);
    // A paragraph of several lines is one instruction, and line breaks inside it stay.
    expect(splitInstructions('Line one\nline two')).toEqual(['Line one\nline two']);
    expect(splitInstructions('  \r\n\r\n ')).toEqual([]);
    expect(splitInstructions('One\r\n\r\nTwo')).toEqual(['One', 'Two']);
  });

  it('keeps no more than the limit', () => {
    const many = Array.from({ length: 80 }, (_, i) => `Item ${i}`).join('\n\n');
    expect(splitInstructions(many)).toHaveLength(MAX_TYPED_ITEMS);
  });

  it('gives the first the description role and reads wishes about looks as preferences', () => {
    expect(roleOf('Create a medicine tracker.', 0)).toBe('primary_description');
    expect(roleOf('Make the buttons large.', 0)).toBe('primary_description');
    expect(roleOf('Make the buttons large.', 1)).toBe('preference');
    expect(roleOf("I'd like it in green", 2)).toBe('preference');
    expect(roleOf('Add a report for missed doses.', 1)).toBe('additional_requirement');
    expect(roleOf('हर दिन की बिक्री जोड़ें', 1)).toBe('additional_requirement');
  });
});

describe('syncing the typed text into the session', () => {
  const text = 'Create a medicine tracker.\n\nIt should have morning, afternoon and evening doses.\n\nMake the buttons large.';

  it('stores each instruction with its role and the time it was written', () => {
    const s = syncTypedText(createSession('s_1', 1), text, 100);
    expect(s.textInputs.map((t) => [t.role, t.createdAt])).toEqual([
      ['primary_description', 100], ['additional_requirement', 100], ['preference', 100],
    ]);
    expect(s.textInputs.map((t) => t.text)).toEqual(splitInstructions(text));
  });

  it('keeps ids and times while the person keeps typing, and returns the same session when nothing changed', () => {
    const a = syncTypedText(createSession('s_1', 1), text, 100);
    expect(syncTypedText(a, text, 200)).toBe(a);
    const b = syncTypedText(a, `${text}\n\nAdd a report for missed doses.`, 300);
    expect(b.textInputs.slice(0, 3)).toEqual(a.textInputs);
    expect(b.textInputs[3]).toMatchObject({ role: 'additional_requirement', createdAt: 300 });
  });

  it('keeps the item of an instruction edited in place and marks when it was changed', () => {
    const a = syncTypedText(createSession('s_1', 1), text, 100);
    const b = syncTypedText(a, text.replace('evening doses', 'night doses'), 400);
    expect(b.textInputs[1]).toMatchObject({ id: a.textInputs[1]!.id, createdAt: 100, updatedAt: 400 });
    expect(b.textInputs[1]!.text).toContain('night doses');
    expect(b.textInputs[0]).toBe(a.textInputs[0]);
  });

  it('drops deleted instructions, moves the first role along, and empties on clear', () => {
    const a = syncTypedText(createSession('s_1', 1), text, 100);
    const b = syncTypedText(a, splitInstructions(text).slice(1).join('\n\n'), 500);
    expect(b.textInputs).toHaveLength(2);
    expect(b.textInputs[0]).toMatchObject({ id: a.textInputs[1]!.id, role: 'primary_description', createdAt: 100 });
    expect(syncTypedText(b, '', 600).textInputs).toEqual([]);
  });

  it('never touches answers to Kalam questions or notes about files', () => {
    let s = addTextInput(createSession('s_1', 1), 'Use 3 fields, as in your description.', 'correction', 50, { conflictId: 'c_fields' });
    s = addTextInput(s, 'This is the paper register.', 'additional_requirement', 60, { sourceAttachmentId: 'att_1' });
    const synced = syncTypedText(s, text, 100);
    expect(synced.textInputs.filter((t) => !isTypedItem(t))).toEqual(s.textInputs);
    const cleared = syncTypedText(synced, '', 200);
    expect(cleared.textInputs).toEqual(s.textInputs);
  });

  it('does not count as an input of its own and does not change what the compiler gets', () => {
    const synced = syncTypedText(createSession('s_1', 1), text, 100);
    expect(hasInputs(synced)).toBe(false);
    const input: NormalizedInput = { text, modalities: ['text'], images: [], language: 'en' };
    expect(prepareHandoff(input, synced).input.text).toBe(text);
  });

  it('survives being stored and read back', () => {
    const synced = syncTypedText(createSession('s_1', 1), text, 100);
    const back = parseSession(JSON.parse(JSON.stringify(synced)), 200);
    expect(back?.textInputs).toEqual(synced.textInputs);
  });
});
