/** Column letters for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function colLetters(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 0-based index of column letters (case-insensitive); -1 if not letters. */
export function colIndex(letters: string): number {
  if (letters.length === 0) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const c = ch.charCodeAt(0) - 64;
    if (c < 1 || c > 26) return -1;
    n = n * 26 + c;
  }
  return n - 1;
}

/** A1 address of 0-based row and column indexes. */
export const cellAddress = (row: number, col: number): string => `${colLetters(col)}${row + 1}`;
