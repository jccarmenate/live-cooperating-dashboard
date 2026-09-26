export interface TextDiff {
  index: number;
  deleteCount: number;
  insert: string;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Single-span diff (common prefix + common suffix). Indices are UTF-16, like
 * Y.Text. The prefix/suffix scan compares UTF-16 code units, so a naive
 * boundary can fall inside a surrogate pair (e.g. between the two halves of
 * an emoji); the checks below nudge `start` and `endPrev`/`endNext` outward
 * so neither boundary ever splits one.
 */
export function diffText(prev: string, next: string): TextDiff | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev++;
    endNext++;
  }
  return { index: start, deleteCount: endPrev - start, insert: next.slice(start, endNext) };
}

/** Maps a caret position through a remote edit. */
export function transformCaret(pos: number, d: TextDiff): number {
  if (pos <= d.index) return pos;
  if (pos >= d.index + d.deleteCount) return pos - d.deleteCount + d.insert.length;
  return d.index + d.insert.length;
}
