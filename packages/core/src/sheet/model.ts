import { generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';

declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

export const SHEET_ROWS_INITIAL = 50;
export const SHEET_COLS_INITIAL = 12;
export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_COLS = 60;
export const MAX_CELL_SRC = 1000;
export const COL_WIDTH_DEFAULT = 120;
export const COL_WIDTH_MIN = 40;
export const COL_WIDTH_MAX = 600;
/** A batch of cell writes above this is refused: the sync server closes messages above 256 KiB. */
export const MAX_SHEET_BATCH_BYTES = 192 * 1024;

export type NumFormat = 'number' | 'percent' | 'eur' | 'usd';
export type CellAlign = 'left' | 'center' | 'right';

export interface CellFormat {
  bold?: true;
  align?: CellAlign;
  num?: NumFormat;
}

export interface CellData {
  src: string;
  fmt?: CellFormat;
}

export interface SheetRow {
  id: string;
  order: string;
}

export interface SheetCol {
  id: string;
  order: string;
  width: number;
}

/** The visible rows and columns in order, and the cells whose row and column are both visible. */
export interface SheetSnapshot {
  rows: SheetRow[];
  cols: SheetCol[];
  cells: Record<string, CellData>;
}

/** Ordered row and column ids: what formula translation and evaluation need. */
export interface GridIndex {
  rows: readonly string[];
  cols: readonly string[];
}

export const cellKey = (row: string, col: string): string => `${row}|${col}`;

export function splitCellKey(key: string): [string, string] | null {
  const i = key.indexOf('|');
  if (i <= 0 || i === key.length - 1 || key.indexOf('|', i + 1) !== -1) return null;
  return [key.slice(0, i), key.slice(i + 1)];
}

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A random 8-character base-36 id for a row or column. */
export function sheetId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = '';
  for (const b of bytes) id += ID_CHARS[b % 36];
  return id;
}

/** `n` ascending fractional keys strictly between two neighbours (null = open end); tolerant of malformed keys. */
export function keysBetween(before: string | null, after: string | null, n: number): string[] {
  try {
    return generateNKeysBetween(before, after, n);
  } catch {
    try {
      return generateNKeysBetween(before, null, n);
    } catch {
      return generateNKeysBetween(null, null, n);
    }
  }
}

const ALIGNS: readonly string[] = ['left', 'center', 'right'];
const NUMS: readonly string[] = ['number', 'percent', 'eur', 'usd'];

export function readFormat(v: unknown): CellFormat | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const fmt: CellFormat = {};
  if (o.bold === true) fmt.bold = true;
  if (typeof o.align === 'string' && ALIGNS.includes(o.align)) fmt.align = o.align as CellAlign;
  if (typeof o.num === 'string' && NUMS.includes(o.num)) fmt.num = o.num as NumFormat;
  return Object.keys(fmt).length > 0 ? fmt : undefined;
}

export function readCell(v: unknown): CellData | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const src = typeof o.src === 'string' ? o.src.slice(0, MAX_CELL_SRC) : '';
  const fmt = readFormat(o.fmt);
  if (!src && !fmt) return null;
  return fmt ? { src, fmt } : { src };
}

const byOrder = (a: { id: string; order: string }, b: { id: string; order: string }) =>
  a.order !== b.order ? (a.order < b.order ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Immutable snapshot of a stored sheet, normalized; null if the value is not a sheet. */
export function readSheet(v: unknown): SheetSnapshot | null {
  if (!(v instanceof Y.Map)) return null;
  const rowsMap: unknown = v.get('rows');
  const colsMap: unknown = v.get('cols');
  const cellsMap: unknown = v.get('cells');
  if (!(rowsMap instanceof Y.Map) || !(colsMap instanceof Y.Map) || !(cellsMap instanceof Y.Map))
    return null;
  const rows: SheetRow[] = [];
  for (const [id, m] of rowsMap.entries()) {
    if (!(m instanceof Y.Map)) continue;
    const order: unknown = m.get('order');
    if (typeof order === 'string') rows.push({ id, order });
  }
  const cols: SheetCol[] = [];
  for (const [id, m] of colsMap.entries()) {
    if (!(m instanceof Y.Map)) continue;
    const order: unknown = m.get('order');
    const w: unknown = m.get('width');
    const width =
      typeof w === 'number' && w >= COL_WIDTH_MIN && w <= COL_WIDTH_MAX ? w : COL_WIDTH_DEFAULT;
    if (typeof order === 'string') cols.push({ id, order, width });
  }
  const visibleRows = rows.sort(byOrder).slice(0, MAX_SHEET_ROWS);
  const visibleCols = cols.sort(byOrder).slice(0, MAX_SHEET_COLS);
  const rowSet = new Set(visibleRows.map((r) => r.id));
  const colSet = new Set(visibleCols.map((c) => c.id));
  const cells: Record<string, CellData> = {};
  for (const [key, raw] of cellsMap.entries()) {
    const parts = splitCellKey(key);
    if (!parts || !rowSet.has(parts[0]) || !colSet.has(parts[1])) continue;
    const cell = readCell(raw);
    if (cell) cells[key] = cell;
  }
  return { rows: visibleRows, cols: visibleCols, cells };
}

export const gridOf = (s: SheetSnapshot): GridIndex => ({
  rows: s.rows.map((r) => r.id),
  cols: s.cols.map((c) => c.id),
});

/** A new sheet's rows and columns (written by CreatePage). */
export function initialSheet(newId: () => string = sheetId): {
  rows: { id: string; order: string }[];
  cols: { id: string; order: string }[];
} {
  return {
    rows: keysBetween(null, null, SHEET_ROWS_INITIAL).map((order) => ({ id: newId(), order })),
    cols: keysBetween(null, null, SHEET_COLS_INITIAL).map((order) => ({ id: newId(), order })),
  };
}
