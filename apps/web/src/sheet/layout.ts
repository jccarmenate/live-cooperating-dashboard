import { cellAddress, type SheetSnapshot } from '@relay/core';
import type { CellPos, SheetRange } from './sheetController';

export const ROW_H = 28;
export const HEADER_H = 28;
export const ROW_HEADER_W = 48;
/** Rows rendered above and below the viewport. */
export const OVERSCAN = 10;

/** Left edge of each column (content coordinates without the row header), plus the total width. */
export function colOffsets(cols: readonly { width: number }[]): number[] {
  const out = [0];
  for (const c of cols) out.push((out.at(-1) as number) + c.width);
  return out;
}

export function visibleRows(scrollTop: number, viewportH: number, rowCount: number) {
  const first = Math.floor(scrollTop / ROW_H);
  const last = Math.ceil((scrollTop + viewportH) / ROW_H);
  return { start: Math.max(0, first - OVERSCAN), end: Math.min(rowCount, last + OVERSCAN) };
}

export function rangeBox(r: SheetRange, offsets: readonly number[]) {
  const left = ROW_HEADER_W + (offsets[r.c0] ?? 0);
  return {
    left,
    top: HEADER_H + r.r0 * ROW_H,
    width: (offsets[r.c1 + 1] ?? 0) - (offsets[r.c0] ?? 0),
    height: (r.r1 - r.r0 + 1) * ROW_H,
  };
}

/** Column index under content x (the row header is to the left of ROW_HEADER_W); −1 outside. */
export function indexAt(offsets: readonly number[], x: number): number {
  const cx = x - ROW_HEADER_W;
  if (cx < 0) return -1;
  for (let i = 0; i < offsets.length - 1; i++) if (cx < (offsets[i + 1] as number)) return i;
  return -1;
}

export function addressOf(sheet: SheetSnapshot, p: CellPos): string {
  const r = sheet.rows.findIndex((x) => x.id === p.row);
  const c = sheet.cols.findIndex((x) => x.id === p.col);
  return r < 0 || c < 0 ? '' : cellAddress(r, c);
}
