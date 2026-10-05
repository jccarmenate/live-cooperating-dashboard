import {
  type CellAlign,
  type CellData,
  type CellFormat,
  type Command,
  cellKey,
  formatValue,
  gridOf,
  keysBetween,
  MAX_CELL_SRC,
  MAX_SHEET_BATCH_BYTES,
  MAX_SHEET_COLS,
  MAX_SHEET_ROWS,
  type NumFormat,
  parseTsv,
  type SheetCellWrite,
  type SheetSnapshot,
  sheetId,
  shiftA1,
  shiftStored,
  toDisplay,
  toStored,
  toTsv,
} from '@relay/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SheetState } from '../store/sheetStore';

export interface CellPos {
  row: string;
  col: string;
}

/** Inclusive indices in the current order, normalized (r0 ≤ r1, c0 ≤ c1). */
export interface SheetRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface SheetUiState {
  /** The active cell (where typing goes) and the other corner of the selection. */
  anchor: CellPos | null;
  focus: CellPos | null;
  /** Text being edited (A1 form) and where the edit started. */
  editing: { draft: string; origin: 'cell' | 'bar' } | null;
}

export interface FormatPatch {
  bold?: boolean;
  align?: CellAlign | null;
  num?: NumFormat | null;
}

export interface SheetController {
  ui: StoreApi<SheetUiState>;
  range(): SheetRange | null;
  select(p: CellPos, extend?: boolean): void;
  selectRow(row: string, extend?: boolean): void;
  selectCol(col: string, extend?: boolean): void;
  selectAll(): void;
  move(dRow: number, dCol: number, extend?: boolean): void;
  startEdit(initial?: string, origin?: 'cell' | 'bar'): void;
  setDraft(value: string): void;
  commitEdit(then?: { dRow: number; dCol: number }): void;
  cancelEdit(): void;
  clear(): void;
  setFormat(patch: FormatPatch): void;
  toggleBold(): void;
  insertRows(where: 'above' | 'below'): void;
  insertCols(where: 'left' | 'right'): void;
  deleteRows(): void;
  deleteCols(): void;
  moveRow(id: string, toIndex: number): void;
  moveCol(id: string, toIndex: number): void;
  setColWidth(id: string, width: number): void;
  copy(): string | null;
  cut(): string | null;
  paste(text: string): boolean;
  /** The last text copied or cut from this sheet (the fallback when the clipboard is unreadable). */
  lastCopied(): string | null;
  fillDown(): void;
  fillTo(target: CellPos): void;
  destroy(): void;
}

export function rangeOf(sheet: SheetSnapshot, a: CellPos, b: CellPos): SheetRange | null {
  const ra = sheet.rows.findIndex((r) => r.id === a.row);
  const rb = sheet.rows.findIndex((r) => r.id === b.row);
  const ca = sheet.cols.findIndex((c) => c.id === a.col);
  const cb = sheet.cols.findIndex((c) => c.id === b.col);
  if (ra < 0 || rb < 0 || ca < 0 || cb < 0) return null;
  return { r0: Math.min(ra, rb), r1: Math.max(ra, rb), c0: Math.min(ca, cb), c1: Math.max(ca, cb) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** What a deletion (an empty source with no format) costs in the budget: it adds no content. */
const DELETE_BYTES = 32;
/**
 * Rough size of a SetCells batch as a Yjs update: UTF-8 JSON bytes plus per-entry overhead for
 * writes, and a small flat cost for deletions.
 */
const batchBytes = (cells: SheetCellWrite[]) => {
  const kept = cells.filter((c) => c.src !== '' || c.fmt);
  const deleted = cells.length - kept.length;
  return (
    new TextEncoder().encode(JSON.stringify(kept)).length +
    kept.length * 16 +
    deleted * DELETE_BYTES
  );
};
/** Clipboard text as compared with the remembered copy (clipboards may add CRLF or a final newline). */
const normalizeClip = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');

/** A cell of the remembered copy: formulas in A1 form as of copy time, so they paste on any page. */
interface ClipCell {
  src: string;
  fmt?: CellFormat;
}

function mergeFormat(fmt: CellFormat | undefined, patch: FormatPatch): CellFormat | undefined {
  const next: CellFormat = { ...fmt };
  if (patch.bold === true) next.bold = true;
  if (patch.bold === false) delete next.bold;
  if (patch.align === null) delete next.align;
  else if (patch.align) next.align = patch.align;
  if (patch.num === null) delete next.num;
  else if (patch.num) next.num = patch.num;
  return Object.keys(next).length > 0 ? next : undefined;
}

const write = (row: string, col: string, src: string, fmt?: CellFormat): SheetCellWrite =>
  fmt ? { row, col, src, fmt } : { row, col, src };

export function createSheetController(opts: {
  sheet: StoreApi<SheetState>;
  commit: (...commands: Command[]) => boolean;
  canEdit: () => boolean;
  /** Deleting is allowed (an editor on a full board); defaults to `canEdit`. */
  canDelete?: () => boolean;
  newId?: () => string;
  notify?: (message: string) => void;
}): SheetController {
  const newId = opts.newId ?? sheetId;
  const notify = (m: string) => opts.notify?.(m);
  const snap = () => opts.sheet.getState().sheet;
  const page = () => opts.sheet.getState().pageId;
  const firstCell = (s: SheetSnapshot | null): CellPos | null => {
    const row = s?.rows[0];
    const col = s?.cols[0];
    return row && col ? { row: row.id, col: col.id } : null;
  };
  const posAt = (s: SheetSnapshot, r: number, c: number): CellPos | null => {
    const row = s.rows[r];
    const col = s.cols[c];
    return row && col ? { row: row.id, col: col.id } : null;
  };

  const initial = firstCell(snap());
  const ui = createStore<SheetUiState>(() => ({ anchor: initial, focus: initial, editing: null }));

  // Keep the selection valid: a page switch, or a deleted row or column, resets it to A1.
  const unsubscribe = opts.sheet.subscribe((st, prev) => {
    const s = st.sheet;
    if (st.pageId !== prev.pageId) {
      const p = firstCell(s);
      ui.setState({ anchor: p, focus: p, editing: null });
      return;
    }
    if (!s) return;
    const { anchor, focus } = ui.getState();
    if (!anchor || !focus || !rangeOf(s, anchor, focus)) {
      const p = firstCell(s);
      ui.setState({ anchor: p, focus: p, editing: null });
    }
  });

  const range = (): SheetRange | null => {
    const s = snap();
    const { anchor, focus } = ui.getState();
    return s && anchor && focus ? rangeOf(s, anchor, focus) : null;
  };

  const run = (...commands: Command[]): boolean =>
    opts.canEdit() && commands.length > 0 && opts.commit(...commands);
  const canDelete = () => (opts.canDelete ?? opts.canEdit)();
  /** For commands that only delete: they still go through on a full board. */
  const runDelete = (...commands: Command[]): boolean =>
    canDelete() && commands.length > 0 && opts.commit(...commands);

  /** Writes cells (edit, clear, format, fill); paste checks its budget with its own wording. */
  const setCells = (cells: SheetCellWrite[], gate: typeof run = run): boolean => {
    const pageId = page();
    if (!pageId || cells.length === 0) return false;
    if (batchBytes(cells) > MAX_SHEET_BATCH_BYTES) {
      notify('Too many cells at once');
      return false;
    }
    return gate({ type: 'SetCells', pageId, cells });
  };

  const cellAt = (
    s: SheetSnapshot,
    r: number,
    c: number,
  ): { row: string; col: string; cell?: CellData } | null => {
    const p = posAt(s, r, c);
    if (!p) return null;
    const cell = s.cells[cellKey(p.row, p.col)];
    return cell ? { ...p, cell } : p;
  };

  /** A copy of cell (fromR, fromC) written at (toR, toC): formulas shift by the offset. */
  const copyCell = (s: SheetSnapshot, fromR: number, fromC: number, toR: number, toC: number) => {
    const from = cellAt(s, fromR, fromC);
    const to = posAt(s, toR, toC);
    if (!from || !to) return null;
    const src = from.cell?.src ?? '';
    const shifted = src.startsWith('=')
      ? shiftStored(src, toR - fromR, toC - fromC, gridOf(s))
      : src;
    return write(to.row, to.col, shifted, from.cell?.fmt);
  };

  const move = (dRow: number, dCol: number, extend = false) => {
    const s = snap();
    const { anchor, focus } = ui.getState();
    if (!s || !anchor || !focus) return;
    const base = rangeOf(s, extend ? focus : anchor, extend ? focus : anchor);
    if (!base) return;
    const p = posAt(
      s,
      clamp(base.r0 + dRow, 0, s.rows.length - 1),
      clamp(base.c0 + dCol, 0, s.cols.length - 1),
    );
    if (!p) return;
    ui.setState(extend ? { focus: p } : { anchor: p, focus: p });
  };

  const clear = () => {
    const s = snap();
    const r = range();
    if (!s || !r) return;
    // Clearing keeps a cell's format. On a full board that would write the cell again, which
    // the server refuses, so there the format goes with the content.
    const keepFormat = opts.canEdit();
    const writes: SheetCellWrite[] = [];
    for (let i = r.r0; i <= r.r1; i++)
      for (let j = r.c0; j <= r.c1; j++) {
        const c = cellAt(s, i, j);
        if (!c?.cell) continue;
        if (keepFormat) {
          if (c.cell.src) writes.push(write(c.row, c.col, '', c.cell.fmt));
        } else {
          writes.push(write(c.row, c.col, ''));
        }
      }
    setCells(writes, keepFormat ? run : runDelete);
  };

  const setFormat = (patch: FormatPatch) => {
    const s = snap();
    const r = range();
    if (!s || !r) return;
    const writes: SheetCellWrite[] = [];
    for (let i = r.r0; i <= r.r1; i++)
      for (let j = r.c0; j <= r.c1; j++) {
        const c = cellAt(s, i, j);
        if (!c) continue;
        const fmt = mergeFormat(c.cell?.fmt, patch);
        if (!c.cell && !fmt) continue;
        writes.push(write(c.row, c.col, c.cell?.src ?? '', fmt));
      }
    setCells(writes);
  };

  /** The last copy: its normalized text, its copy-time top-left indices and its cells. */
  let clip: { text: string; r0: number; c0: number; cells: ClipCell[][] } | null = null;

  const copy = (): string | null => {
    const s = snap();
    const r = range();
    if (!s || !r) return null;
    const values = opts.sheet.getState().values;
    const lines: string[][] = [];
    const grid = gridOf(s);
    const cells: ClipCell[][] = [];
    for (let i = r.r0; i <= r.r1; i++) {
      const line: string[] = [];
      const row: ClipCell[] = [];
      for (let j = r.c0; j <= r.c1; j++) {
        const c = cellAt(s, i, j);
        const key = c ? cellKey(c.row, c.col) : '';
        line.push(formatValue(values.get(key) ?? { t: 'empty' }, c?.cell?.fmt));
        const cell = c?.cell;
        const src = cell?.src.startsWith('=') ? toDisplay(cell.src, grid) : (cell?.src ?? '');
        row.push(cell?.fmt ? { src, fmt: cell.fmt } : { src });
      }
      lines.push(line);
      cells.push(row);
    }
    const text = toTsv(lines);
    clip = { text: normalizeClip(text), r0: r.r0, c0: r.c0, cells };
    return text;
  };

  /** What an edit started from (the A1 text shown and the grid): the draft is read against it. */
  let editStart: { shown: string; grid: ReturnType<typeof gridOf> } | null = null;

  const insertAt = <T extends { order: string }>(list: readonly T[], at: number, count: number) =>
    keysBetween(list[at - 1]?.order ?? null, list[at]?.order ?? null, count);

  return {
    ui,
    range,
    select(p, extend = false) {
      ui.setState(extend ? { focus: p } : { anchor: p, focus: p });
    },
    selectRow(row, extend = false) {
      const s = snap();
      const first = s?.cols[0];
      const last = s?.cols.at(-1);
      if (!first || !last) return;
      if (extend) ui.setState({ focus: { row, col: last.id } });
      else ui.setState({ anchor: { row, col: first.id }, focus: { row, col: last.id } });
    },
    selectCol(col, extend = false) {
      const s = snap();
      const first = s?.rows[0];
      const last = s?.rows.at(-1);
      if (!first || !last) return;
      if (extend) ui.setState({ focus: { row: last.id, col } });
      else ui.setState({ anchor: { row: first.id, col }, focus: { row: last.id, col } });
    },
    selectAll() {
      const s = snap();
      if (!s) return;
      const a = posAt(s, 0, 0);
      const b = posAt(s, s.rows.length - 1, s.cols.length - 1);
      if (a && b) ui.setState({ anchor: a, focus: b });
    },
    move,
    startEdit(initialText, origin = 'cell') {
      if (!opts.canEdit()) return;
      const s = snap();
      const a = ui.getState().anchor;
      if (!s || !a) return;
      const current = s.cells[cellKey(a.row, a.col)]?.src ?? '';
      const grid = gridOf(s);
      const shown = toDisplay(current, grid).slice(0, MAX_CELL_SRC);
      editStart = { shown, grid };
      ui.setState({
        editing: {
          draft: initialText?.slice(0, MAX_CELL_SRC) ?? shown,
          origin,
        },
      });
    },
    setDraft(value) {
      const e = ui.getState().editing;
      if (e) ui.setState({ editing: { ...e, draft: value.slice(0, MAX_CELL_SRC) } });
    },
    commitEdit(then) {
      const e = ui.getState().editing;
      const s = snap();
      const a = ui.getState().anchor;
      const start = editStart;
      let src: string | null = null;
      // The draft is A1 as seen when the edit started: resolve it against that grid, so a
      // concurrent insert or delete never re-points it. An unchanged draft writes nothing.
      if (e && s && a && start && e.draft !== start.shown) {
        src = toStored(e.draft, start.grid);
        if (src.length > MAX_CELL_SRC) {
          // Refused: the edit stays open with its draft, where it is.
          notify('That formula is too long');
          return;
        }
      }
      editStart = null;
      ui.setState({ editing: null });
      if (src !== null && s && a) {
        const cell = s.cells[cellKey(a.row, a.col)];
        if (src !== (cell?.src ?? '')) setCells([write(a.row, a.col, src, cell?.fmt)]);
      }
      if (then) move(then.dRow, then.dCol);
    },
    cancelEdit() {
      editStart = null;
      ui.setState({ editing: null });
    },
    clear,
    setFormat,
    toggleBold() {
      const s = snap();
      const r = range();
      if (!s || !r) return;
      let allBold = true;
      for (let i = r.r0; i <= r.r1 && allBold; i++)
        for (let j = r.c0; j <= r.c1; j++)
          if (!cellAt(s, i, j)?.cell?.fmt?.bold) {
            allBold = false;
            break;
          }
      setFormat({ bold: !allBold });
    },
    insertRows(where) {
      const s = snap();
      const r = range();
      const pageId = page();
      if (!s || !r || !pageId) return;
      const count = r.r1 - r.r0 + 1;
      if (s.rows.length + count > MAX_SHEET_ROWS) {
        notify(`A sheet has at most ${MAX_SHEET_ROWS} rows`);
        return;
      }
      const keys = insertAt(s.rows, where === 'above' ? r.r0 : r.r1 + 1, count);
      run({ type: 'InsertRows', pageId, rows: keys.map((order) => ({ id: newId(), order })) });
    },
    insertCols(where) {
      const s = snap();
      const r = range();
      const pageId = page();
      if (!s || !r || !pageId) return;
      const count = r.c1 - r.c0 + 1;
      if (s.cols.length + count > MAX_SHEET_COLS) {
        notify(`A sheet has at most ${MAX_SHEET_COLS} columns`);
        return;
      }
      const keys = insertAt(s.cols, where === 'left' ? r.c0 : r.c1 + 1, count);
      run({ type: 'InsertCols', pageId, cols: keys.map((order) => ({ id: newId(), order })) });
    },
    deleteRows() {
      const s = snap();
      const r = range();
      const pageId = page();
      if (!s || !r || !pageId) return;
      if (r.r1 - r.r0 + 1 >= s.rows.length) {
        notify('A sheet needs at least one row');
        return;
      }
      runDelete({
        type: 'DeleteRows',
        pageId,
        ids: s.rows.slice(r.r0, r.r1 + 1).map((x) => x.id),
      });
    },
    deleteCols() {
      const s = snap();
      const r = range();
      const pageId = page();
      if (!s || !r || !pageId) return;
      if (r.c1 - r.c0 + 1 >= s.cols.length) {
        notify('A sheet needs at least one column');
        return;
      }
      runDelete({
        type: 'DeleteCols',
        pageId,
        ids: s.cols.slice(r.c0, r.c1 + 1).map((x) => x.id),
      });
    },
    moveRow(id, toIndex) {
      const s = snap();
      const pageId = page();
      if (!s || !pageId) return;
      const others = s.rows.filter((x) => x.id !== id);
      const [order] = insertAt(others, clamp(toIndex, 0, others.length), 1);
      if (order) run({ type: 'MoveRow', pageId, id, order });
    },
    moveCol(id, toIndex) {
      const s = snap();
      const pageId = page();
      if (!s || !pageId) return;
      const others = s.cols.filter((x) => x.id !== id);
      const [order] = insertAt(others, clamp(toIndex, 0, others.length), 1);
      if (order) run({ type: 'MoveCol', pageId, id, order });
    },
    setColWidth(id, width) {
      const pageId = page();
      if (pageId) run({ type: 'SetColWidth', pageId, id, width });
    },
    copy,
    cut() {
      const text = copy();
      if (text !== null && opts.canEdit()) clear();
      return text;
    },
    lastCopied: () => clip?.text ?? null,
    paste(text) {
      const s = snap();
      const r = range();
      const pageId = page();
      if (!s || !r || !pageId || !opts.canEdit()) return false;
      const own = clip && clip.text === normalizeClip(text) ? clip : null;
      const block: ClipCell[][] = (
        own ? own.cells : parseTsv(text).map((row) => row.map((src) => ({ src })))
      ).slice(0, MAX_SHEET_ROWS - r.r0);
      if (block.length === 0) return false;
      const height = block.length;
      const width = block.reduce((w, row) => Math.max(w, row.length), 0);
      const rowsNeeded = Math.min(MAX_SHEET_ROWS, r.r0 + height) - s.rows.length;
      const colsNeeded = Math.min(MAX_SHEET_COLS, r.c0 + width) - s.cols.length;
      const newRows =
        rowsNeeded > 0
          ? keysBetween(s.rows.at(-1)?.order ?? null, null, rowsNeeded).map((order) => ({
              id: newId(),
              order,
            }))
          : [];
      const newCols =
        colsNeeded > 0
          ? keysBetween(s.cols.at(-1)?.order ?? null, null, colsNeeded).map((order) => ({
              id: newId(),
              order,
            }))
          : [];
      const grid = {
        rows: [...s.rows.map((x) => x.id), ...newRows.map((x) => x.id)],
        cols: [...s.cols.map((x) => x.id), ...newCols.map((x) => x.id)],
      };
      const writes: SheetCellWrite[] = [];
      let tooLong = false;
      block.forEach((line, i) => {
        line.forEach((b, j) => {
          const row = grid.rows[r.r0 + i];
          const col = grid.cols[r.c0 + j];
          if (!row || !col) return;
          const fmt = own ? b.fmt : s.cells[cellKey(row, col)]?.fmt;
          if (!b.src.startsWith('=')) {
            writes.push(write(row, col, b.src.slice(0, MAX_CELL_SRC), fmt));
            return;
          }
          // Own copy: A1 as of copy time, shifted by the offset from the copy-time position.
          const a1 = own ? shiftA1(b.src, r.r0 - own.r0, r.c0 - own.c0) : b.src;
          const src = toStored(a1, grid);
          // Never cut a stored formula mid-id: skip it instead.
          if (src.length > MAX_CELL_SRC) tooLong = true;
          else writes.push(write(row, col, src, fmt));
        });
      });
      if (tooLong) notify('That formula is too long');
      if (writes.length === 0) return false;
      if (batchBytes(writes) > MAX_SHEET_BATCH_BYTES) {
        notify('Too much to paste at once');
        return false;
      }
      const commands: Command[] = [];
      if (newRows.length > 0) commands.push({ type: 'InsertRows', pageId, rows: newRows });
      if (newCols.length > 0) commands.push({ type: 'InsertCols', pageId, cols: newCols });
      commands.push({ type: 'SetCells', pageId, cells: writes });
      if (!run(...commands)) return false;
      const lastRow = grid.rows[Math.min(r.r0 + height, grid.rows.length) - 1];
      const lastCol = grid.cols[Math.min(r.c0 + width, grid.cols.length) - 1];
      const firstRow = grid.rows[r.r0];
      const firstCol = grid.cols[r.c0];
      if (firstRow && firstCol && lastRow && lastCol) {
        ui.setState({
          anchor: { row: firstRow, col: firstCol },
          focus: { row: lastRow, col: lastCol },
        });
      }
      return true;
    },
    fillDown() {
      const s = snap();
      const r = range();
      if (!s || !r || r.r1 === r.r0) return;
      const writes: SheetCellWrite[] = [];
      for (let i = r.r0 + 1; i <= r.r1; i++)
        for (let j = r.c0; j <= r.c1; j++) {
          const w = copyCell(s, r.r0, j, i, j);
          if (w) writes.push(w);
        }
      setCells(writes);
    },
    fillTo(target) {
      const s = snap();
      const r = range();
      if (!s || !r) return;
      const t = rangeOf(s, target, target);
      if (!t) return;
      const writes: SheetCellWrite[] = [];
      const anchor = posAt(s, r.r0, r.c0);
      let focus: CellPos | null = null;
      if (t.r0 > r.r1) {
        const h = r.r1 - r.r0 + 1;
        for (let i = r.r1 + 1; i <= t.r0; i++)
          for (let j = r.c0; j <= r.c1; j++) {
            const w = copyCell(s, r.r0 + ((i - r.r0) % h), j, i, j);
            if (w) writes.push(w);
          }
        focus = posAt(s, t.r0, r.c1);
      } else if (t.c0 > r.c1) {
        const w0 = r.c1 - r.c0 + 1;
        for (let j = r.c1 + 1; j <= t.c0; j++)
          for (let i = r.r0; i <= r.r1; i++) {
            const w = copyCell(s, i, r.c0 + ((j - r.c0) % w0), i, j);
            if (w) writes.push(w);
          }
        focus = posAt(s, r.r1, t.c0);
      } else return;
      if (setCells(writes) && anchor && focus) ui.setState({ anchor, focus });
    },
    destroy() {
      unsubscribe();
    },
  };
}
