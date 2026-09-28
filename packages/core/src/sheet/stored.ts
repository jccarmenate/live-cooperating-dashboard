import { colLetters } from './address';
import { type IdRef, lex, type Token } from './lexer';
import type { GridIndex } from './model';

const idText = (ref: IdRef): string =>
  `[${ref.absRow ? '$' : ''}${ref.row}.${ref.absCol ? '$' : ''}${ref.col}]`;

const a1Text = (row: number, col: number, absRow: boolean, absCol: boolean): string =>
  `${absCol ? '$' : ''}${colLetters(col)}${absRow ? '$' : ''}${row + 1}`;

const indexer = (ids: readonly string[]) => new Map(ids.map((id, i) => [id, i]));

/**
 * Rewrites a formula's tokens in place (text between tokens is kept verbatim, so the user's
 * spacing and casing survive). Non-formulas and formulas that do not lex are returned unchanged.
 */
function rewrite(src: string, replace: (t: Token) => string | null): string {
  if (!src.startsWith('=')) return src;
  const body = src.slice(1);
  const tokens = lex(body);
  if (!tokens) return src;
  let out = '';
  let prev = 0;
  for (const t of tokens) {
    const r = replace(t);
    if (r === null) continue;
    out += body.slice(prev, t.s) + r;
    prev = t.e;
  }
  return `=${out}${body.slice(prev)}`;
}

/** User input (A1 form) → stored form: references become row/column ids of the current grid. */
export function toStored(input: string, grid: GridIndex): string {
  return rewrite(input, (t) => {
    if (t.k !== 'a1') return null;
    const row = t.ref.row >= 0 ? grid.rows[t.ref.row] : undefined;
    const col = t.ref.col >= 0 ? grid.cols[t.ref.col] : undefined;
    if (row === undefined || col === undefined) return '#REF!';
    return idText({ row, col, absRow: t.ref.absRow, absCol: t.ref.absCol });
  });
}

/** Stored form → what the user sees and edits (A1 of the current order; missing rows/columns → #REF!). */
export function toDisplay(src: string, grid: GridIndex): string {
  const rowIndex = indexer(grid.rows);
  const colIndex = indexer(grid.cols);
  return rewrite(src, (t) => {
    if (t.k !== 'id') return null;
    const r = rowIndex.get(t.ref.row);
    const c = colIndex.get(t.ref.col);
    return r === undefined || c === undefined ? '#REF!' : a1Text(r, c, t.ref.absRow, t.ref.absCol);
  });
}

/** A stored formula moved by (dRow, dCol): relative parts shift, absolute parts stay; off-grid → #REF!. */
export function shiftStored(src: string, dRow: number, dCol: number, grid: GridIndex): string {
  const rowIndex = indexer(grid.rows);
  const colIndex = indexer(grid.cols);
  return rewrite(src, (t) => {
    if (t.k !== 'id') return null;
    const r = rowIndex.get(t.ref.row);
    const c = colIndex.get(t.ref.col);
    if (r === undefined || c === undefined) return '#REF!';
    const nr = t.ref.absRow ? r : r + dRow;
    const nc = t.ref.absCol ? c : c + dCol;
    const row = nr >= 0 ? grid.rows[nr] : undefined;
    const col = nc >= 0 ? grid.cols[nc] : undefined;
    if (row === undefined || col === undefined) return '#REF!';
    return idText({ row, col, absRow: t.ref.absRow, absCol: t.ref.absCol });
  });
}

/** An A1 formula moved by (dRow, dCol): relative parts shift, absolute parts stay; off the grid → #REF!. */
export function shiftA1(input: string, dRow: number, dCol: number): string {
  return rewrite(input, (t) => {
    if (t.k !== 'a1') return null;
    const row = t.ref.absRow ? t.ref.row : t.ref.row + dRow;
    const col = t.ref.absCol ? t.ref.col : t.ref.col + dCol;
    if (row < 0 || col < 0) return '#REF!';
    return a1Text(row, col, t.ref.absRow, t.ref.absCol);
  });
}
