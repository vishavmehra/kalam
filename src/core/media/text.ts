/**
 * Typed text as separate instructions (docs/06 §2.1, §6.2-6.4). The typed description stays whole and
 * exactly as written; this only reads it as an ordered list, so the session can keep each instruction
 * with its role and its time. Pure TypeScript, no wording is changed.
 */
import type { TextInputItem } from './types';

/** Most typed instructions kept per session (the session as a whole holds 64 text items). */
export const MAX_TYPED_ITEMS = 48;

const LIST_MARK = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
/**
 * A wish about how the app looks or feels, not a new thing to build. English cues only, as a hint:
 * anything else is read as an additional requirement, which is always safe.
 */
const PREFERENCE = /^(?:please\s+)?(?:make|keep|use|prefer|i\s+prefer|i(?:'d|\s+would)\s+like)\b/i;

/**
 * One instruction per paragraph (blank line) and per marked line of a list (a dash, bullet or number).
 * A line that continues the one above stays with it. The marker is list syntax, not the person's words.
 */
export function splitInstructions(text: string): string[] {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    if (!lines.some((l) => LIST_MARK.test(l))) {
      const one = lines.map((l) => l.trim()).filter(Boolean).join('\n');
      if (one) out.push(one);
      continue;
    }
    let current = '';
    for (const line of lines) {
      if (LIST_MARK.test(line)) {
        if (current) out.push(current);
        current = line.replace(LIST_MARK, '').trim();
      } else if (line.trim()) {
        current = current ? `${current} ${line.trim()}` : line.trim();
      }
    }
    if (current) out.push(current);
  }
  return out.slice(0, MAX_TYPED_ITEMS);
}

/** The first instruction is the description; later ones add to it. Corrections come only from answers and change requests. */
export function roleOf(text: string, index: number): TextInputItem['role'] {
  if (index === 0) return 'primary_description';
  return PREFERENCE.test(text) ? 'preference' : 'additional_requirement';
}

/**
 * An item that mirrors the typed description: not an answer to a question (conflict) and not about a
 * file. The typed text itself already lives in the creation draft, so these never count as extra inputs.
 */
export const isTypedItem = (t: TextInputItem): boolean => t.role !== 'correction' && !t.conflictId && !t.sourceAttachmentId;
