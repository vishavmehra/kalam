/**
 * Grapheme-aware length and truncation (docs/10 §12.2). `String.length` and `.slice` count UTF-16 units, so
 * they cut Hindi "कि", Tamil "கு" and emoji sequences in half. Use these wherever a character limit applies.
 *
 * Uses `Intl.Segmenter` when the runtime has it. Hermes on Android may not, so a small fallback keeps
 * combining marks, joiners and virama-joined consonants with their base letter. Pure TypeScript.
 */

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}

let segmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => SegmenterLike }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** Combining marks. Unicode property escapes where available, else the marks of Latin and the Indic blocks. */
const MARK: RegExp = (() => {
  try {
    return new RegExp('\\p{M}', 'u');
  } catch {
    return /[̀-ͯऀ-ःऺ-ॏ॑-ॗॢॣঁ-ঃ়া-্ৗৢৣਁ-ਃ਼-ੑੰੱੵઁ-ઃ઼ા-્ૢૣଁ-ଃ଼ା-ୗୢୣஂா-்ௗఀ-ఄా-ౖౢౣಁ-ಃ಼ಾ-ೖೢೣഀ-ഃ഻഼ാ-്ൗൢൣ]/;
  }
})();

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
/** Virama (halant) of each Indic script: the next consonant is joined to it. */
const VIRAMA: ReadonlySet<number> = new Set([0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d4d]);

/** Splits text into user-perceived characters without `Intl.Segmenter`. Exported for tests. */
export function graphemesFallback(text: string): string[] {
  const out: string[] = [];
  let previous = -1;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const joins = out.length > 0 && (cp === ZWJ || cp === ZWNJ || MARK.test(ch) || previous === ZWJ || VIRAMA.has(previous));
    if (joins) out[out.length - 1] += ch;
    else out.push(ch);
    previous = cp;
  }
  return out;
}

/** The user-perceived characters of `text`. */
export function graphemes(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return graphemesFallback(text);
  return Array.from(seg.segment(text), (s) => s.segment);
}

/** How many characters a person would count in `text`. */
export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

/**
 * Cuts `text` to at most `max` user-perceived characters, never inside one. Returns the text unchanged
 * when it already fits. Pass `ellipsis` to mark a cut; it counts toward `max`.
 */
export function truncateGraphemes(text: string, max: number, ellipsis = ''): string {
  if (max <= 0) return '';
  const all = graphemes(text);
  if (all.length <= max) return text;
  const keep = Math.max(0, max - graphemes(ellipsis).length);
  return all.slice(0, keep).join('') + ellipsis;
}
