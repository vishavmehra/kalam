import { joinWords, lowerFirst, plural } from './names';
import { IMPACT_RANK, type ChangeEntry } from './types';

/** First sentence only: the longer explanation after ". " belongs in the detail view, not in a one-line summary. */
const headOf = (text: string): string => text.split('. ')[0] ?? text;

/**
 * One readable line for a list of changes. The most important changes (those that touch entries, then those that
 * change behaviour) come first, and a long list collapses to "and 7 more changes".
 */
export function summarizeChanges(entries: readonly ChangeEntry[], max = 3): string {
  if (!entries.length) return 'No changes';
  const ranked = [...entries].sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact]);
  if (ranked.length === 1) return headOf(ranked[0].text);
  // Never collapse a single change into "and 1 more change": show it instead.
  const cut = ranked.length - max === 1 ? max + 1 : max;
  const shown = ranked.slice(0, cut).map((e, i) => (i === 0 ? headOf(e.text) : lowerFirst(headOf(e.text))));
  const rest = ranked.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${plural(rest, 'more change')}` : joinWords(shown);
}
