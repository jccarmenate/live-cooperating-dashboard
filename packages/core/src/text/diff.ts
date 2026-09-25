export interface TextDiff {
  index: number;
  deleteCount: number;
  insert: string;
}

/** Single-span diff (common prefix + common suffix). Indices are UTF-16, like Y.Text. */
export function diffText(prev: string, next: string): TextDiff | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  return { index: start, deleteCount: endPrev - start, insert: next.slice(start, endNext) };
}

/** Maps a caret position through a remote edit. */
export function transformCaret(pos: number, d: TextDiff): number {
  if (pos <= d.index) return pos;
  if (pos >= d.index + d.deleteCount) return pos - d.deleteCount + d.insert.length;
  return d.index + d.insert.length;
}
