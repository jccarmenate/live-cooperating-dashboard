# Relay F4·P3 Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `sheet` page type to Relay rooms: a collaborative spreadsheet with id-stable rows and columns, basic formulas, formatting, clipboard, fill and live presence.

**Architecture:**
- `@relay/core` gains:
  - a sheet model: a `sheets` root with rows, cols and cells, plus eight commands;
  - a pure formula engine: lexer, Pratt parser, A1 ↔ id translation, evaluator;
  - display formatting and TSV helpers.
- The web app projects the active sheet into a Zustand store with computed values.
- A `SheetController` owns selection and editing, and turns intents into commands through the board controller's `commit` (one undo step per call).
- A virtualised DOM grid (`SheetPage` → `FormatBar`, `FormulaBar`, `SheetGrid`) renders the sheet and handles keyboard, clipboard and structure gestures.

**Tech Stack:** TypeScript, Yjs 13.6, fractional-indexing 4, React 19 / Next.js 16, Zustand 5, Tailwind 4, Vitest + fast-check, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`, section "### Sheets (F4·P3)", plus the `sheets` block in the Yjs Document, the `sheet` awareness field, and the Commands and Undo and Input amendments.

## Global Constraints

- $0 cost. No new runtime dependency.
- Do not edit README.
- Limits (from the spec):
  - a new sheet has 50 rows and 12 columns;
  - at most 500 rows and 60 columns;
  - a cell source is at most 1000 characters;
  - column width defaults to 120 px, within 40–600 px;
  - row height is 28 px;
  - a batch of cell writes whose update would exceed 192 KiB is refused with the toast "Too much to paste at once".
- Row and column ids are 8-character random base-36 strings. A cell key is `"<rowId>|<colId>"`.
- Stored formula references look like `[<rowId>.<colId>]`, with `$` before each absolute part (e.g. `[$ab12cd34.$ef56gh78]`). A range is `[…]:[…]`. Deleted references show and evaluate as `#REF!`.
- Errors: `#REF!`, `#DIV/0!`, `#CYCLE!`, `#NAME?`, `#VALUE!`, `#NUM!` and `#ERROR!`.
- Sheet commands use `LOCAL_ORIGIN`, so they are undoable, and the undo manager also tracks `sheets`. `CreatePage`/`DeletePage` stay on `SESSION_ORIGIN`.
- Viewers can see, select and copy. They cannot edit, change structure, resize, format or paste.
- On sheet pages the board's shortcuts and clipboard handlers are off.
- Windows: never create two files whose names differ only by case.
- Commits end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

**Core (`packages/core/src`)**
- `sheet/model.ts` (new): constants, types, `cellKey`/`splitCellKey`, `sheetId`, `keysBetween`, `readSheet`, `gridOf`, `initialSheet`.
- `sheet/address.ts` (new): `colLetters`, `colIndex`, `cellAddress`.
- `sheet/lexer.ts` (new): the formula tokenizer, which handles both A1 and stored references.
- `sheet/parser.ts` (new): `CellError`, `Ast`, `parseFormula` (Pratt).
- `sheet/stored.ts` (new): `toStored`, `toDisplay`, `shiftStored`.
- `sheet/evaluate.ts` (new): `CellValue`, `literalValue`, `evaluateSheet`.
- `sheet/display.ts` (new): `formatValue`, `defaultAlign`.
- `sheet/tsv.ts` (new): `toTsv`, `parseTsv`.
- `schema/doc.ts`: the `sheets` root.
- `commands/types.ts` and `commands/apply.ts`: the sheet commands, plus sheet creation on `CreatePage` and removal on `DeletePage`.
- `commands/undo.ts`: track `sheets`.
- `presence/state.ts`: the `sheet` awareness field.
- `index.ts`: exports.

**Web (`apps/web/src`)**
- `store/sheetStore.ts` (new): the active sheet's projection and computed values.
- `board/controller.ts`: a public `commit(...commands)`, and `createPage('sheet')` with its initial rows and columns.
- `board/session.ts`: the sheet store in the session.
- `sync/presence.ts`: `setSheet`.
- `ui/PageTabs.tsx`: enable "Spreadsheet".
- `ui/useShortcuts.ts` and `ui/useClipboard.ts`: board pages only.
- `board/Board.tsx`: render `SheetPage` for sheet pages.
- `sheet/sheetController.ts` (new): selection, editing, format, structure, clipboard and fill.
- `sheet/layout.ts` (new): pure layout helpers.
- `sheet/SheetPage.tsx`, `sheet/SheetGrid.tsx`, `sheet/FormulaBar.tsx`, `sheet/FormatBar.tsx`, `sheet/CellEditor.tsx`, `sheet/useSheetKeys.ts`, `sheet/useSheetClipboard.ts` and `sheet/SheetHeaders.tsx` (all new).

**Tests**
- Core, in `packages/core/test/`: `sheet-model.test.ts`, `sheet-convergence.test.ts`, `sheet-formula.test.ts`, `sheet-stored.test.ts`, `sheet-evaluate.test.ts` and `sheet-display.test.ts`.
- Web, in `apps/web/test/`: `sheetStore.test.ts`, `sheetController.test.ts` and `sheetLayout.test.ts`.
- E2E: `e2e/sheets.spec.ts`.

---

### Task 1: Core — sheet model and commands

**Files:**
- Create: `packages/core/src/sheet/model.ts`
- Modify: `packages/core/src/schema/doc.ts`
- Modify: `packages/core/src/commands/types.ts`
- Modify: `packages/core/src/commands/apply.ts`
- Modify: `packages/core/src/commands/undo.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sheet-model.test.ts` (new)
- Test: `packages/core/test/sheet-convergence.test.ts` (new)

**Interfaces:**
- Produces from `sheet/model.ts`, exported from `@relay/core`:

```ts
export const SHEET_ROWS_INITIAL = 50; SHEET_COLS_INITIAL = 12; MAX_SHEET_ROWS = 500; MAX_SHEET_COLS = 60;
export const MAX_CELL_SRC = 1000; COL_WIDTH_DEFAULT = 120; COL_WIDTH_MIN = 40; COL_WIDTH_MAX = 600;
export const MAX_SHEET_BATCH_BYTES = 192 * 1024;
export type NumFormat = 'number' | 'percent' | 'eur' | 'usd';
export type CellAlign = 'left' | 'center' | 'right';
export interface CellFormat { bold?: true; align?: CellAlign; num?: NumFormat }
export interface CellData { src: string; fmt?: CellFormat }
export interface SheetRow { id: string; order: string }
export interface SheetCol { id: string; order: string; width: number }
export interface SheetSnapshot { rows: SheetRow[]; cols: SheetCol[]; cells: Record<string, CellData> }
export interface GridIndex { rows: readonly string[]; cols: readonly string[] }
export function cellKey(row: string, col: string): string;
export function splitCellKey(key: string): [string, string] | null;
export function sheetId(): string;
export function keysBetween(before: string | null, after: string | null, n: number): string[];
export function readFormat(v: unknown): CellFormat | undefined;
export function readCell(v: unknown): CellData | null;
export function readSheet(v: unknown): SheetSnapshot | null;
export function gridOf(s: SheetSnapshot): GridIndex;
export function initialSheet(newId?: () => string): { rows: { id: string; order: string }[]; cols: { id: string; order: string }[] };
```

- Produces the `Roots.sheets: Y.Map<Y.Map<unknown>>` root.
- Produces these additions to the `Command` union, plus the `SheetCellWrite` type:

```ts
export interface SheetCellWrite { row: string; col: string; src: string; fmt?: CellFormat }
| { type: 'SetCells'; pageId: string; cells: SheetCellWrite[] }
| { type: 'InsertRows'; pageId: string; rows: { id: string; order: string }[] }
| { type: 'InsertCols'; pageId: string; cols: { id: string; order: string; width?: number }[] }
| { type: 'DeleteRows'; pageId: string; ids: string[] }
| { type: 'DeleteCols'; pageId: string; ids: string[] }
| { type: 'MoveRow'; pageId: string; id: string; order: string }
| { type: 'MoveCol'; pageId: string; id: string; order: string }
| { type: 'SetColWidth'; pageId: string; id: string; width: number }
```

- `CreatePage` gains an optional `sheet?: { rows: {id, order}[]; cols: {id, order}[] }` at the command level, next to `page`.

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/sheet-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  cellKey,
  COL_WIDTH_DEFAULT,
  createUndo,
  getRoots,
  initialSheet,
  LOCAL_ORIGIN,
  MAX_CELL_SRC,
  readSheet,
  SESSION_ORIGIN,
  sheetId,
  splitCellKey,
} from '../src';

function sheetDoc(rows = ['r1', 'r2', 'r3'], cols = ['c1', 'c2']) {
  const doc = new Y.Doc();
  applyCommand(
    doc,
    {
      type: 'CreatePage',
      page: { id: 'p', type: 'sheet', title: 'Sheet 1', order: 'a1', createdBy: 'u', createdAt: 1 },
      sheet: {
        rows: rows.map((id, i) => ({ id, order: `a${i}` })),
        cols: cols.map((id, i) => ({ id, order: `a${i}` })),
      },
    },
    SESSION_ORIGIN,
  );
  return doc;
}
const snap = (doc: Y.Doc) => readSheet(getRoots(doc).sheets.get('p'));

describe('sheet model', () => {
  it('sheetId is 8 base-36 characters; keys round-trip', () => {
    expect(sheetId()).toMatch(/^[0-9a-z]{8}$/);
    expect(splitCellKey(cellKey('r1', 'c2'))).toEqual(['r1', 'c2']);
    expect(splitCellKey('nope')).toBeNull();
    expect(splitCellKey('a|b|c')).toBeNull();
  });

  it('initialSheet has 50 rows and 12 columns in ascending order', () => {
    const s = initialSheet();
    expect(s.rows).toHaveLength(50);
    expect(s.cols).toHaveLength(12);
    const orders = s.rows.map((r) => r.order);
    expect([...orders].sort()).toEqual(orders);
  });

  it('CreatePage of a sheet writes its rows and columns; DeletePage removes the sheet', () => {
    const doc = sheetDoc();
    expect(snap(doc)).toEqual({
      rows: [
        { id: 'r1', order: 'a0' },
        { id: 'r2', order: 'a1' },
        { id: 'r3', order: 'a2' },
      ],
      cols: [
        { id: 'c1', order: 'a0', width: COL_WIDTH_DEFAULT },
        { id: 'c2', order: 'a1', width: COL_WIDTH_DEFAULT },
      ],
      cells: {},
    });
    applyCommand(doc, { type: 'DeletePage', id: 'p' }, SESSION_ORIGIN);
    expect(getRoots(doc).sheets.has('p')).toBe(false);
  });

  it('SetCells writes, formats and deletes cells; skips missing rows and columns', () => {
    const doc = sheetDoc();
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'p',
      cells: [
        { row: 'r1', col: 'c1', src: '4' },
        { row: 'r2', col: 'c2', src: '', fmt: { bold: true } },
        { row: 'gone', col: 'c1', src: 'x' },
      ],
    });
    expect(snap(doc)?.cells).toEqual({
      [cellKey('r1', 'c1')]: { src: '4' },
      [cellKey('r2', 'c2')]: { src: '', fmt: { bold: true } },
    });
    applyCommand(doc, { type: 'SetCells', pageId: 'p', cells: [{ row: 'r1', col: 'c1', src: '' }] });
    expect(getRoots(doc).sheets.get('p')?.get('cells')).toBeInstanceOf(Y.Map);
    expect(snap(doc)?.cells[cellKey('r1', 'c1')]).toBeUndefined();
  });

  it('SetCells caps sources at 1000 characters', () => {
    const doc = sheetDoc();
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'p',
      cells: [{ row: 'r1', col: 'c1', src: 'x'.repeat(2000) }],
    });
    expect(snap(doc)?.cells[cellKey('r1', 'c1')]?.src).toHaveLength(MAX_CELL_SRC);
  });

  it('inserts, moves and deletes rows and columns (deleting their cells)', () => {
    const doc = sheetDoc();
    applyCommand(doc, { type: 'InsertRows', pageId: 'p', rows: [{ id: 'r0', order: 'Zz' }] });
    applyCommand(doc, { type: 'InsertCols', pageId: 'p', cols: [{ id: 'c3', order: 'a5', width: 300 }] });
    applyCommand(doc, { type: 'MoveRow', pageId: 'p', id: 'r3', order: 'Zy' });
    expect(snap(doc)?.rows.map((r) => r.id)).toEqual(['r3', 'r0', 'r1', 'r2']);
    expect(snap(doc)?.cols.at(-1)).toEqual({ id: 'c3', order: 'a5', width: 300 });
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'p',
      cells: [
        { row: 'r1', col: 'c1', src: 'a' },
        { row: 'r2', col: 'c2', src: 'b' },
      ],
    });
    applyCommand(doc, { type: 'DeleteRows', pageId: 'p', ids: ['r1'] });
    applyCommand(doc, { type: 'DeleteCols', pageId: 'p', ids: ['c2'] });
    const s = snap(doc);
    expect(s?.rows.map((r) => r.id)).toEqual(['r3', 'r0', 'r2']);
    expect(s?.cols.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(s?.cells).toEqual({});
    expect([...(getRoots(doc).sheets.get('p')?.get('cells') as Y.Map<unknown>).keys()]).toEqual([]);
  });

  it('SetColWidth clamps to 40–600', () => {
    const doc = sheetDoc();
    applyCommand(doc, { type: 'SetColWidth', pageId: 'p', id: 'c1', width: 5 });
    applyCommand(doc, { type: 'SetColWidth', pageId: 'p', id: 'c2', width: 9000 });
    expect(snap(doc)?.cols.map((c) => c.width)).toEqual([40, 600]);
  });

  it('commands on a page without a sheet do nothing', () => {
    const doc = sheetDoc();
    applyCommand(doc, { type: 'InsertRows', pageId: 'other', rows: [{ id: 'x', order: 'a9' }] });
    applyCommand(doc, { type: 'SetCells', pageId: 'other', cells: [{ row: 'r1', col: 'c1', src: 'x' }] });
    expect(getRoots(doc).sheets.has('other')).toBe(false);
  });

  it('reads defensively: orphan cells, bad widths, bad formats, row cap', () => {
    const doc = sheetDoc();
    const sheet = getRoots(doc).sheets.get('p') as Y.Map<unknown>;
    const cells = sheet.get('cells') as Y.Map<unknown>;
    cells.set(cellKey('ghost', 'c1'), { src: 'orphan' });
    cells.set(cellKey('r1', 'c1'), { src: 'ok', fmt: { bold: 'yes', align: 'middle', num: 'eur' } });
    cells.set(cellKey('r2', 'c1'), 'not an object');
    ((sheet.get('cols') as Y.Map<unknown>).get('c1') as Y.Map<unknown>).set('width', 5000);
    const s = readSheet(sheet);
    expect(s?.cells).toEqual({ [cellKey('r1', 'c1')]: { src: 'ok', fmt: { num: 'eur' } } });
    expect(s?.cols[0]?.width).toBe(COL_WIDTH_DEFAULT);
    expect(readSheet('nope')).toBeNull();
    const rows = sheet.get('rows') as Y.Map<unknown>;
    for (let i = 0; i < 600; i++) {
      const m = new Y.Map<unknown>();
      rows.set(`x${i}`, m);
      m.set('order', `b${String(i).padStart(4, '0')}`);
    }
    expect(readSheet(sheet)?.rows).toHaveLength(500);
  });

  it('sheet edits are undoable; page creation is not', () => {
    const doc = sheetDoc();
    const undo = createUndo(doc, { captureTimeout: 0 });
    applyCommand(doc, { type: 'SetCells', pageId: 'p', cells: [{ row: 'r1', col: 'c1', src: '1' }] }, LOCAL_ORIGIN);
    undo.undo();
    expect(snap(doc)?.cells).toEqual({});
    expect(getRoots(doc).sheets.has('p')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- sheet-model`
Expected: FAIL (`initialSheet` / `readSheet` are not exported).

- [ ] **Step 3: Write `packages/core/src/sheet/model.ts`:**

```ts
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
```

- [ ] **Step 4: Add the root and commands.**

In `schema/doc.ts`, add `/** Sheet pages' grids, keyed by page id (created with the page). */ sheets: Y.Map<Y.Map<unknown>>;` to `Roots`, and `sheets: doc.getMap<Y.Map<unknown>>('sheets'),` to `getRoots`.

In `commands/types.ts`:
- import `CellFormat` from `'../sheet/model'`;
- add `export interface SheetCellWrite { row: string; col: string; src: string; fmt?: CellFormat }`;
- append the eight sheet variants from the Interfaces block to `Command`;
- change the `CreatePage` variant to:

```ts
  | {
      type: 'CreatePage';
      page: {
        id: string;
        type: PageType;
        title: string;
        order: string;
        createdBy: string;
        createdAt: number;
      };
      /** Initial rows and columns of a `sheet` page, written in the same transaction. */
      sheet?: { rows: { id: string; order: string }[]; cols: { id: string; order: string }[] };
    }
```

In `commands/apply.ts`:
- import from `'../sheet/model'`: `cellKey`, `COL_WIDTH_DEFAULT`, `COL_WIDTH_MAX`, `COL_WIDTH_MIN`, `MAX_CELL_SRC`, `splitCellKey`;
- add `sheets` to the `getRoots(doc)` destructuring at the top of `apply`;
- add these helpers above `apply`:

```ts
interface SheetMaps {
  rows: Y.Map<unknown>;
  cols: Y.Map<unknown>;
  cells: Y.Map<unknown>;
}

/** The maps of a page's sheet; null when the page has no (well-formed) sheet. Commands never create one. */
function sheetMaps(sheets: Y.Map<Y.Map<unknown>>, pageId: string): SheetMaps | null {
  const sheet: unknown = sheets.get(pageId);
  if (!(sheet instanceof Y.Map)) return null;
  const rows: unknown = sheet.get('rows');
  const cols: unknown = sheet.get('cols');
  const cells: unknown = sheet.get('cells');
  return rows instanceof Y.Map && cols instanceof Y.Map && cells instanceof Y.Map
    ? { rows, cols, cells }
    : null;
}

const clampWidth = (w: number): number =>
  Number.isFinite(w) ? Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(w))) : COL_WIDTH_DEFAULT;

/** Deletes the cells whose row (part 0) or column (part 1) is in `ids`. */
function deleteCellsOf(cells: Y.Map<unknown>, ids: ReadonlySet<string>, part: 0 | 1): void {
  for (const key of [...cells.keys()]) {
    const parts = splitCellKey(key);
    if (parts && ids.has(parts[part])) cells.delete(key);
  }
}
```

In the `CreatePage` case, after `pages.set(cmd.page.id, m);`, add:

```ts
      if (cmd.page.type === 'sheet' && cmd.sheet && !sheets.has(cmd.page.id)) {
        const sheet = new Y.Map<unknown>();
        sheets.set(cmd.page.id, sheet);
        const rows = new Y.Map<unknown>();
        const cols = new Y.Map<unknown>();
        sheet.set('rows', rows);
        sheet.set('cols', cols);
        sheet.set('cells', new Y.Map<unknown>());
        for (const r of cmd.sheet.rows) {
          const rm = new Y.Map<unknown>();
          rows.set(r.id, rm);
          rm.set('order', r.order);
        }
        for (const c of cmd.sheet.cols) {
          const cm = new Y.Map<unknown>();
          cols.set(c.id, cm);
          cm.set('order', c.order);
        }
      }
```

In the `DeletePage` case, add `if (sheets.has(cmd.id)) sheets.delete(cmd.id);` right after the tombstone line.

Add the new cases before `RenameBoard`:

```ts
    case 'SetCells': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      for (const c of cmd.cells) {
        if (!(s.rows.get(c.row) instanceof Y.Map) || !(s.cols.get(c.col) instanceof Y.Map)) continue;
        const key = cellKey(c.row, c.col);
        const src = c.src.slice(0, MAX_CELL_SRC);
        if (!src && !c.fmt) {
          if (s.cells.has(key)) s.cells.delete(key);
        } else {
          s.cells.set(key, c.fmt ? { src, fmt: c.fmt } : { src });
        }
      }
      return;
    }
    case 'InsertRows': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      for (const r of cmd.rows) {
        if (s.rows.has(r.id)) continue;
        const m = new Y.Map<unknown>();
        s.rows.set(r.id, m);
        m.set('order', r.order);
      }
      return;
    }
    case 'InsertCols': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      for (const c of cmd.cols) {
        if (s.cols.has(c.id)) continue;
        const m = new Y.Map<unknown>();
        s.cols.set(c.id, m);
        m.set('order', c.order);
        if (c.width !== undefined) m.set('width', clampWidth(c.width));
      }
      return;
    }
    case 'DeleteRows': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      const ids = new Set(cmd.ids);
      for (const id of ids) if (s.rows.has(id)) s.rows.delete(id);
      deleteCellsOf(s.cells, ids, 0);
      return;
    }
    case 'DeleteCols': {
      const s = sheetMaps(sheets, cmd.pageId);
      if (!s) return;
      const ids = new Set(cmd.ids);
      for (const id of ids) if (s.cols.has(id)) s.cols.delete(id);
      deleteCellsOf(s.cells, ids, 1);
      return;
    }
    case 'MoveRow':
    case 'MoveCol': {
      const s = sheetMaps(sheets, cmd.pageId);
      const m: unknown = (cmd.type === 'MoveRow' ? s?.rows : s?.cols)?.get(cmd.id);
      if (m instanceof Y.Map) m.set('order', cmd.order);
      return;
    }
    case 'SetColWidth': {
      const m: unknown = sheetMaps(sheets, cmd.pageId)?.cols.get(cmd.id);
      if (m instanceof Y.Map) m.set('width', clampWidth(cmd.width));
      return;
    }
```

In `commands/undo.ts`:
- change `const { shapes, connectors } = getRoots(doc);` to `const { shapes, connectors, sheets } = getRoots(doc);`;
- change the manager scope to `[shapes, connectors, sheets]`.

In `index.ts`, add `export * from './sheet/model';`.

- [ ] **Step 5: Run the model tests**

Run: `npm test -w @relay/core -- sheet-model`
Expected: PASS.

- [ ] **Step 6: Convergence fuzz.** Create `packages/core/test/sheet-convergence.test.ts`:

```ts
declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyCommand, getRoots, keysBetween, LOCAL_ORIGIN, readSheet, SESSION_ORIGIN } from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 150);
const REMOTE = 'remote';
const N = 3;

type Step =
  | { kind: 'insertRow'; r: number; at: number }
  | { kind: 'deleteRow'; r: number; pick: number }
  | { kind: 'moveRow'; r: number; pick: number; at: number }
  | { kind: 'insertCol'; r: number; at: number }
  | { kind: 'deleteCol'; r: number; pick: number }
  | { kind: 'width'; r: number; pick: number; width: number }
  | { kind: 'set'; r: number; row: number; col: number; src: string; bold: boolean }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('insertRow' as const), r: replica, at: fc.nat(10) }),
  fc.record({ kind: fc.constant('deleteRow' as const), r: replica, pick: fc.nat() }),
  fc.record({ kind: fc.constant('moveRow' as const), r: replica, pick: fc.nat(), at: fc.nat(10) }),
  fc.record({ kind: fc.constant('insertCol' as const), r: replica, at: fc.nat(6) }),
  fc.record({ kind: fc.constant('deleteCol' as const), r: replica, pick: fc.nat() }),
  fc.record({
    kind: fc.constant('width' as const),
    r: replica,
    pick: fc.nat(),
    width: fc.integer({ min: 0, max: 900 }),
  }),
  {
    arbitrary: fc.record({
      kind: fc.constant('set' as const),
      r: replica,
      row: fc.nat(),
      col: fc.nat(),
      src: fc.constantFrom('', '1', 'x', '=1+1'),
      bold: fc.boolean(),
    }),
    weight: 4,
  },
  fc.record({
    kind: fc.constant('deliver' as const),
    from: replica,
    to: replica,
    count: fc.integer({ min: 1, max: 3 }),
  }),
);

function setup() {
  const docs = Array.from({ length: N }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = i + 1;
    return d;
  });
  applyCommand(
    docs[0] as Y.Doc,
    {
      type: 'CreatePage',
      page: { id: 'p', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
      sheet: {
        rows: ['a0', 'a1', 'a2'].map((order, i) => ({ id: `r${i}`, order })),
        cols: ['a0', 'a1'].map((order, i) => ({ id: `c${i}`, order })),
      },
    },
    SESSION_ORIGIN,
  );
  const base = Y.encodeStateAsUpdate(docs[0] as Y.Doc);
  for (const d of docs.slice(1)) Y.applyUpdate(d, base);
  const queues = docs.map(() => docs.map(() => [] as Uint8Array[]));
  docs.forEach((d, from) => {
    d.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      for (let to = 0; to < N; to++) if (to !== from) queues[from]?.[to]?.push(u);
    });
  });
  const deliver = (from: number, to: number, count: number) => {
    const q = queues[from]?.[to];
    for (let i = 0; i < count && q && q.length > 0; i++) {
      const u = q.shift();
      if (u) Y.applyUpdate(docs[to] as Y.Doc, u, REMOTE);
    }
  };
  return { docs, deliver };
}

describe('sheet convergence', () => {
  it('replicas converge under concurrent structure and cell edits', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 10, maxLength: 50 }), (steps) => {
        const { docs, deliver } = setup();
        let n = 0;
        for (const s of steps) {
          if (s.kind === 'deliver') {
            if (s.from !== s.to) deliver(s.from, s.to, s.count);
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const sheet = readSheet(getRoots(doc).sheets.get('p'));
          if (!sheet) continue;
          const rows = sheet.rows;
          const cols = sheet.cols;
          const run = (c: Parameters<typeof applyCommand>[1]) => applyCommand(doc, c, LOCAL_ORIGIN);
          switch (s.kind) {
            case 'insertRow': {
              const at = Math.min(s.at, rows.length);
              const [order] = keysBetween(rows[at - 1]?.order ?? null, rows[at]?.order ?? null, 1);
              run({ type: 'InsertRows', pageId: 'p', rows: [{ id: `n${s.r}-${n++}`, order: order as string }] });
              break;
            }
            case 'deleteRow': {
              const row = rows[s.pick % Math.max(1, rows.length)];
              if (row) run({ type: 'DeleteRows', pageId: 'p', ids: [row.id] });
              break;
            }
            case 'moveRow': {
              const row = rows[s.pick % Math.max(1, rows.length)];
              if (!row) break;
              const others = rows.filter((x) => x.id !== row.id);
              const at = Math.min(s.at, others.length);
              const [order] = keysBetween(others[at - 1]?.order ?? null, others[at]?.order ?? null, 1);
              run({ type: 'MoveRow', pageId: 'p', id: row.id, order: order as string });
              break;
            }
            case 'insertCol': {
              const at = Math.min(s.at, cols.length);
              const [order] = keysBetween(cols[at - 1]?.order ?? null, cols[at]?.order ?? null, 1);
              run({ type: 'InsertCols', pageId: 'p', cols: [{ id: `k${s.r}-${n++}`, order: order as string }] });
              break;
            }
            case 'deleteCol': {
              const col = cols[s.pick % Math.max(1, cols.length)];
              if (col) run({ type: 'DeleteCols', pageId: 'p', ids: [col.id] });
              break;
            }
            case 'width': {
              const col = cols[s.pick % Math.max(1, cols.length)];
              if (col) run({ type: 'SetColWidth', pageId: 'p', id: col.id, width: s.width });
              break;
            }
            case 'set': {
              const row = rows[s.row % Math.max(1, rows.length)];
              const col = cols[s.col % Math.max(1, cols.length)];
              if (row && col)
                run({
                  type: 'SetCells',
                  pageId: 'p',
                  cells: [{ row: row.id, col: col.id, src: s.src, ...(s.bold ? { fmt: { bold: true } } : {}) }],
                });
              break;
            }
          }
        }
        for (let from = 0; from < N; from++)
          for (let to = 0; to < N; to++) if (from !== to) deliver(from, to, Number.POSITIVE_INFINITY);
        const snaps = docs.map((d) => readSheet(getRoots(d).sheets.get('p')));
        for (const s of snaps) expect(s).toEqual(snaps[0]);
      }),
      { numRuns: RUNS },
    );
  });
});
```

- [ ] **Step 7: Run all the core tests, then typecheck and lint**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`
Expected: all pass (the existing undo tests still pass with the wider scope).

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): sheet model — rows, columns and cells with id-stable structure commands"
```

---

### Task 2: Core — addresses, formula lexer and parser

**Files:**
- Create: `packages/core/src/sheet/address.ts`
- Create: `packages/core/src/sheet/lexer.ts`
- Create: `packages/core/src/sheet/parser.ts`
- Modify: `packages/core/src/index.ts` (export all three)
- Test: `packages/core/test/sheet-formula.test.ts` (new)

**Interfaces:**
- Produces:

```ts
// address.ts
export function colLetters(index: number): string;    // 0 → 'A', 25 → 'Z', 26 → 'AA', 59 → 'BH'
export function colIndex(letters: string): number;     // 'A' → 0; invalid → -1
export function cellAddress(row: number, col: number): string; // (2, 1) → 'B3'
// lexer.ts
export interface A1Ref { row: number; col: number; absRow: boolean; absCol: boolean }   // 0-based, may be out of range
export interface IdRef { row: string; col: string; absRow: boolean; absCol: boolean }
export type OpToken = '+' | '-' | '*' | '/' | '^' | '%' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';
export type Token = { s: number; e: number } & ( { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'bool'; v: boolean }
  | { k: 'a1'; ref: A1Ref } | { k: 'id'; ref: IdRef } | { k: 'refErr' } | { k: 'name'; v: string } | { k: 'op'; v: OpToken }
  | { k: '(' } | { k: ')' } | { k: ',' } | { k: ':' } );
export function lex(body: string): Token[] | null;    // body = formula without '='; null on an invalid character or unterminated string
// parser.ts
export type CellError = '#REF!' | '#DIV/0!' | '#CYCLE!' | '#NAME?' | '#VALUE!' | '#NUM!' | '#ERROR!';
export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';
export type Ast = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'bool'; v: boolean } | { k: 'err'; v: CellError }
  | { k: 'ref'; ref: IdRef } | { k: 'range'; from: IdRef; to: IdRef } | { k: 'neg'; arg: Ast } | { k: 'pct'; arg: Ast }
  | { k: 'bin'; op: BinOp; l: Ast; r: Ast } | { k: 'call'; name: string; args: Ast[] };
export function parseFormula(body: string): Ast | null;   // stored-form body; null on a syntax error
```

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/sheet-formula.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cellAddress, colIndex, colLetters, lex, parseFormula } from '../src';

describe('addresses', () => {
  it('converts column indexes and letters', () => {
    expect([0, 25, 26, 51, 52, 59].map(colLetters)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'BH']);
    expect(['A', 'z', 'AA', 'bh'].map(colIndex)).toEqual([0, 25, 26, 59]);
    expect(colIndex('')).toBe(-1);
    expect(colIndex('A1')).toBe(-1);
    expect(cellAddress(2, 1)).toBe('B3');
  });
});

describe('lex', () => {
  const kinds = (s: string) => lex(s)?.map((t) => t.k);

  it('tokenizes literals, references, names and operators with positions', () => {
    expect(kinds('SUM(A1:$B$2) & "x""y" <= 1.5e2%')).toEqual([
      'name', '(', 'a1', ':', 'a1', ')', 'op', 'str', 'op', 'num', 'op',
    ]);
    const t = lex('$b$12');
    expect(t).toEqual([{ k: 'a1', ref: { row: 11, col: 1, absRow: true, absCol: true }, s: 0, e: 5 }]);
    expect(lex('"a""b"')?.[0]).toMatchObject({ k: 'str', v: 'a"b' });
  });

  it('reads stored references, #REF! and booleans', () => {
    expect(lex('[$ab12cd34.ef56gh78]')?.[0]).toMatchObject({
      k: 'id',
      ref: { row: 'ab12cd34', col: 'ef56gh78', absRow: true, absCol: false },
    });
    expect(kinds('#REF!+true')).toEqual(['refErr', 'op', 'bool']);
  });

  it('keeps names that look like references when followed by "(" or more letters', () => {
    expect(kinds('LOG10(1)')).toEqual(['name', '(', 'num', ')']);
    expect(kinds('A1B')).toEqual(['name']);
  });

  it('rejects invalid characters and unterminated strings', () => {
    expect(lex('1 ? 2')).toBeNull();
    expect(lex('"open')).toBeNull();
  });
});

describe('parseFormula', () => {
  const ref = (row: string, col: string) => ({ row, col, absRow: false, absCol: false });

  it('respects precedence and associativity', () => {
    expect(parseFormula('1+2*3')).toEqual({
      k: 'bin', op: '+', l: { k: 'num', v: 1 },
      r: { k: 'bin', op: '*', l: { k: 'num', v: 2 }, r: { k: 'num', v: 3 } },
    });
    expect(parseFormula('2^3^2')).toEqual({
      k: 'bin', op: '^', l: { k: 'num', v: 2 },
      r: { k: 'bin', op: '^', l: { k: 'num', v: 3 }, r: { k: 'num', v: 2 } },
    });
    expect(parseFormula('-2^2')).toEqual({
      k: 'bin', op: '^', l: { k: 'neg', arg: { k: 'num', v: 2 } }, r: { k: 'num', v: 2 },
    });
    expect(parseFormula('1&2=3')).toEqual({
      k: 'bin', op: '=',
      l: { k: 'bin', op: '&', l: { k: 'num', v: 1 }, r: { k: 'num', v: 2 } },
      r: { k: 'num', v: 3 },
    });
    expect(parseFormula('50%*2')).toEqual({
      k: 'bin', op: '*', l: { k: 'pct', arg: { k: 'num', v: 50 } }, r: { k: 'num', v: 2 },
    });
  });

  it('parses calls, references and ranges', () => {
    expect(parseFormula('sum([r1.c1]:[r2.c2], 3)')).toEqual({
      k: 'call', name: 'SUM',
      args: [{ k: 'range', from: ref('r1', 'c1'), to: ref('r2', 'c2') }, { k: 'num', v: 3 }],
    });
    expect(parseFormula('IF()')).toEqual({ k: 'call', name: 'IF', args: [] });
    expect(parseFormula('[r1.c1]')).toEqual({ k: 'ref', ref: ref('r1', 'c1') });
  });

  it('turns #REF!, A1 leftovers and bare names into error nodes', () => {
    expect(parseFormula('#REF!+1')).toEqual({
      k: 'bin', op: '+', l: { k: 'err', v: '#REF!' }, r: { k: 'num', v: 1 },
    });
    expect(parseFormula('[r1.c1]:#REF!')).toEqual({ k: 'err', v: '#REF!' });
    expect(parseFormula('A1')).toEqual({ k: 'err', v: '#REF!' });
    expect(parseFormula('FOO')).toEqual({ k: 'err', v: '#NAME?' });
  });

  it('returns null on syntax errors', () => {
    for (const bad of ['', '1+', '(1', '1)', 'SUM(1,', '1 2', '*3', '[r1.c1]:', '"x']) {
      expect(parseFormula(bad)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- sheet-formula`
Expected: FAIL (missing exports).

- [ ] **Step 3: Write `sheet/address.ts`:**

```ts
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
```

- [ ] **Step 4: Write `sheet/lexer.ts`:**

```ts
import { colIndex } from './address';

export interface A1Ref {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

export interface IdRef {
  row: string;
  col: string;
  absRow: boolean;
  absCol: boolean;
}

export type OpToken = '+' | '-' | '*' | '/' | '^' | '%' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type Token = { s: number; e: number } & (
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'a1'; ref: A1Ref }
  | { k: 'id'; ref: IdRef }
  | { k: 'refErr' }
  | { k: 'name'; v: string }
  | { k: 'op'; v: OpToken }
  | { k: '(' }
  | { k: ')' }
  | { k: ',' }
  | { k: ':' }
);

const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const A1 = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.])/;
const ID_REF = /^\[(\$?)([a-z0-9]{1,16})\.(\$?)([a-z0-9]{1,16})\]/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPS: readonly OpToken[] = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '%', '&', '=', '<', '>'];
const PUNCT = new Set(['(', ')', ',', ':']);

/** Tokens of a formula body (without the leading "="); null on an invalid character or unterminated string. */
export function lex(body: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = body.slice(i);
    const num = NUM.exec(rest);
    if (num) {
      out.push({ k: 'num', v: Number(num[0]), s: i, e: i + num[0].length });
      i += num[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= body.length) return null;
        if (body[j] === '"') {
          if (body[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += body[j];
        j++;
      }
      out.push({ k: 'str', v, s: i, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (rest.startsWith('#REF!')) {
      out.push({ k: 'refErr', s: i, e: i + 5 });
      i += 5;
      continue;
    }
    const idRef = ID_REF.exec(rest);
    if (idRef) {
      out.push({
        k: 'id',
        ref: {
          absRow: idRef[1] === '$',
          row: idRef[2] as string,
          absCol: idRef[3] === '$',
          col: idRef[4] as string,
        },
        s: i,
        e: i + idRef[0].length,
      });
      i += idRef[0].length;
      continue;
    }
    const a1 = A1.exec(rest);
    if (a1) {
      out.push({
        k: 'a1',
        ref: {
          absCol: a1[1] === '$',
          col: colIndex(a1[2] as string),
          absRow: a1[3] === '$',
          row: Number(a1[4]) - 1,
        },
        s: i,
        e: i + a1[0].length,
      });
      i += a1[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      const up = name[0].toUpperCase();
      const e = i + name[0].length;
      out.push(up === 'TRUE' || up === 'FALSE' ? { k: 'bool', v: up === 'TRUE', s: i, e } : { k: 'name', v: up, s: i, e });
      i = e;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ k: 'op', v: op, s: i, e: i + op.length });
      i += op.length;
      continue;
    }
    if (PUNCT.has(ch)) {
      out.push({ k: ch as '(' | ')' | ',' | ':', s: i, e: i + 1 });
      i++;
      continue;
    }
    return null;
  }
  return out;
}
```

- [ ] **Step 5: Write `sheet/parser.ts`:**

```ts
import { type IdRef, lex, type Token } from './lexer';

export type CellError = '#REF!' | '#DIV/0!' | '#CYCLE!' | '#NAME?' | '#VALUE!' | '#NUM!' | '#ERROR!';
export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: CellError }
  | { k: 'ref'; ref: IdRef }
  | { k: 'range'; from: IdRef; to: IdRef }
  | { k: 'neg'; arg: Ast }
  | { k: 'pct'; arg: Ast }
  | { k: 'bin'; op: BinOp; l: Ast; r: Ast }
  | { k: 'call'; name: string; args: Ast[] };

/** Infix binding powers (spec precedence: comparisons < & < +- < *\/ < ^ < unary < %). */
const INFIX: Partial<Record<string, number>> = {
  '=': 10, '<>': 10, '<': 10, '>': 10, '<=': 10, '>=': 10,
  '&': 20,
  '+': 30, '-': 30,
  '*': 40, '/': 40,
  '^': 50,
};
const PREFIX_BP = 60;
const PCT_BP = 70;

class SyntaxFail extends Error {}
const fail = (): never => {
  throw new SyntaxFail();
};
const REF_ERR: Ast = { k: 'err', v: '#REF!' };

/** Parses a stored formula body (without "="). Returns null on a syntax error. */
export function parseFormula(body: string): Ast | null {
  const tokens = lex(body);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => tokens[pos++] ?? fail();

  /** After `from:`, the range's other corner; a missing corner is #REF!, anything else a syntax error. */
  const rangeEnd = (): IdRef | null => {
    const t = next();
    if (t.k === 'id') return t.ref;
    if (t.k === 'refErr' || t.k === 'a1') return null;
    return fail();
  };

  const prefix = (): Ast => {
    const t = next();
    switch (t.k) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'bool':
        return { k: 'bool', v: t.v };
      case 'refErr':
      case 'a1':
        // Stored formulas hold no A1 references: a leftover is a broken reference.
        if (peek()?.k === ':') {
          next();
          rangeEnd();
        }
        return REF_ERR;
      case 'id': {
        if (peek()?.k !== ':') return { k: 'ref', ref: t.ref };
        next();
        const to = rangeEnd();
        return to ? { k: 'range', from: t.ref, to } : REF_ERR;
      }
      case 'name': {
        if (peek()?.k !== '(') return { k: 'err', v: '#NAME?' };
        next();
        const args: Ast[] = [];
        if (peek()?.k === ')') {
          next();
          return { k: 'call', name: t.v, args };
        }
        for (;;) {
          args.push(expr(0));
          const sep = next();
          if (sep.k === ')') break;
          if (sep.k !== ',') fail();
        }
        return { k: 'call', name: t.v, args };
      }
      case '(': {
        const inner = expr(0);
        if (next().k !== ')') fail();
        return inner;
      }
      case 'op':
        if (t.v === '-') return { k: 'neg', arg: expr(PREFIX_BP) };
        if (t.v === '+') return expr(PREFIX_BP);
        return fail();
      default:
        return fail();
    }
  };

  const expr = (minBp: number): Ast => {
    let left = prefix();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op') break;
      if (t.v === '%') {
        if (PCT_BP <= minBp) break;
        next();
        left = { k: 'pct', arg: left };
        continue;
      }
      const bp = INFIX[t.v];
      if (bp === undefined || bp <= minBp) break;
      next();
      const right = expr(t.v === '^' ? bp - 1 : bp);
      left = { k: 'bin', op: t.v as BinOp, l: left, r: right };
    }
    return left;
  };

  try {
    const ast = expr(0);
    return pos === tokens.length ? ast : null;
  } catch (e) {
    if (e instanceof SyntaxFail) return null;
    throw e;
  }
}
```

Export all three modules from `index.ts`. `CellError` lives in `parser.ts`.

- [ ] **Step 6: Run the tests, typecheck, lint, then commit**

Run: `npm test -w @relay/core -- sheet-formula && npm run typecheck && npm run lint`
Expected: PASS and clean. If Biome reformats the `INFIX` table, accept it.

```bash
git add packages/core
git commit -m "feat(core): formula lexer and Pratt parser with A1 and id-stable references"
```

---

### Task 3: Core — stored-form translation

**Files:**
- Create: `packages/core/src/sheet/stored.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sheet-stored.test.ts` (new)

**Interfaces:**
- Consumes: `lex` and `Token`/`IdRef` (Task 2), `colLetters` (Task 2), `GridIndex` (Task 1).
- Produces:

```ts
export function toStored(input: string, grid: GridIndex): string;     // user text (A1) → stored; non-formulas unchanged
export function toDisplay(src: string, grid: GridIndex): string;      // stored → A1 (missing refs → #REF!)
export function shiftStored(src: string, dRow: number, dCol: number, grid: GridIndex): string; // relative parts move
```

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/sheet-stored.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shiftStored, toDisplay, toStored } from '../src';

const grid = { rows: ['r1', 'r2', 'r3'], cols: ['c1', 'c2'] };

describe('stored form', () => {
  it('leaves non-formulas and syntax errors alone', () => {
    expect(toStored('A1+1', grid)).toBe('A1+1');
    expect(toStored('="open', grid)).toBe('="open');
    expect(toDisplay('plain', grid)).toBe('plain');
  });

  it('translates A1 references to ids and back, keeping text and $ markers', () => {
    const stored = toStored('=sum(A1:$B$3) + a2*2', grid);
    expect(stored).toBe('=sum([r1.c1]:[$r3.$c2]) + [r2.c1]*2');
    expect(toDisplay(stored, grid)).toBe('=sum(A1:$B$3) + A2*2');
  });

  it('stores out-of-range references as #REF!', () => {
    expect(toStored('=C1+A9+A0', grid)).toBe('=#REF!+#REF!+#REF!');
  });

  it('shows the current position after a reorder and #REF! after a delete', () => {
    const stored = toStored('=A1+B2', grid);
    expect(toDisplay(stored, { rows: ['r0', 'r1', 'r2'], cols: ['c1', 'c2'] })).toBe('=A2+B3');
    expect(toDisplay(stored, { rows: ['r2', 'r3'], cols: ['c1', 'c2'] })).toBe('=#REF!+B1');
  });

  it('shifts relative parts only; shifting off the grid is #REF!', () => {
    const stored = '=[r1.c1]+[$r1.c1]+[r1.$c1]+[$r1.$c1]';
    expect(toDisplay(shiftStored(stored, 1, 1, grid), grid)).toBe('=B2+B$1+$A2+$A$1');
    expect(shiftStored('=[r1.c1]', -1, 0, grid)).toBe('=#REF!');
    expect(shiftStored('=[gone.c1]', 1, 0, grid)).toBe('=#REF!');
    expect(shiftStored('text', 1, 1, grid)).toBe('text');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- sheet-stored`
Expected: FAIL.

- [ ] **Step 3: Write `sheet/stored.ts`:**

```ts
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
```

Export it from `index.ts`.

- [ ] **Step 4: Run the tests, typecheck, lint, then commit**

Run: `npm test -w @relay/core -- sheet-stored && npm run typecheck && npm run lint`
Expected: PASS and clean.

```bash
git add packages/core
git commit -m "feat(core): translate formulas between A1 and id-stable stored form, and shift copies"
```

---

### Task 4: Core — formula evaluator

**Files:**
- Create: `packages/core/src/sheet/evaluate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sheet-evaluate.test.ts` (new)

**Interfaces:**
- Consumes: `parseFormula`, `Ast`, `CellError` (Task 2); `SheetSnapshot`, `cellKey` (Task 1); `IdRef` (Task 2).
- Produces:

```ts
export type CellValue = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean } | { t: 'err'; v: CellError } | { t: 'empty' };
export function literalValue(src: string): CellValue;
export function evaluateSheet(sheet: SheetSnapshot): Map<string, CellValue>;   // one entry per non-empty cell key
```

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/sheet-evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cellKey, type CellValue, evaluateSheet, literalValue, type SheetSnapshot, toStored } from '../src';

const ROWS = ['r1', 'r2', 'r3', 'r4'];
const COLS = ['c1', 'c2', 'c3'];
const grid = { rows: ROWS, cols: COLS };

/** Builds a sheet from A1-addressed inputs, e.g. { A1: '4', B1: '=A1*2' }. */
function sheet(inputs: Record<string, string>): SheetSnapshot {
  const cells: SheetSnapshot['cells'] = {};
  for (const [addr, input] of Object.entries(inputs)) {
    const col = addr.charCodeAt(0) - 65;
    const row = Number(addr.slice(1)) - 1;
    cells[cellKey(ROWS[row] as string, COLS[col] as string)] = { src: toStored(input, grid) };
  }
  return {
    rows: ROWS.map((id, i) => ({ id, order: `a${i}` })),
    cols: COLS.map((id, i) => ({ id, order: `a${i}`, width: 120 })),
    cells,
  };
}
const valueAt = (inputs: Record<string, string>, addr: string): CellValue | undefined => {
  const col = addr.charCodeAt(0) - 65;
  const row = Number(addr.slice(1)) - 1;
  return evaluateSheet(sheet(inputs)).get(cellKey(ROWS[row] as string, COLS[col] as string));
};
const n = (v: number): CellValue => ({ t: 'num', v });
const e = (v: string): CellValue => ({ t: 'err', v } as CellValue);

describe('literalValue', () => {
  it('reads numbers, booleans and text', () => {
    expect(literalValue('12')).toEqual(n(12));
    expect(literalValue(' -1.5e2 ')).toEqual(n(-150));
    expect(literalValue('true')).toEqual({ t: 'bool', v: true });
    expect(literalValue('12 apples')).toEqual({ t: 'str', v: '12 apples' });
    expect(literalValue('')).toEqual({ t: 'empty' });
  });
});

describe('evaluateSheet', () => {
  it('computes arithmetic with precedence, percent and references', () => {
    expect(valueAt({ A1: '4', B1: '=A1*2+1' }, 'B1')).toEqual(n(9));
    expect(valueAt({ A1: '=2^3^2' }, 'A1')).toEqual(n(512));
    expect(valueAt({ A1: '=-2^2' }, 'A1')).toEqual(n(4));
    expect(valueAt({ A1: '=50%*4' }, 'A1')).toEqual(n(2));
    expect(valueAt({ A1: '=B1+1' }, 'A1')).toEqual(n(1));
    expect(valueAt({ A1: '=B1' }, 'A1')).toEqual(n(0));
  });

  it('concatenates and compares', () => {
    expect(valueAt({ A1: 'a', B1: '=A1&1.5&TRUE' }, 'B1')).toEqual({ t: 'str', v: 'a1.5TRUE' });
    expect(valueAt({ A1: '="abc"="ABC"' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '=2<"a"' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '="a"<TRUE' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '=B1=0' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '=0.1+0.2&""' }, 'A1')).toEqual({ t: 'str', v: '0.3' });
  });

  it('aggregates ranges, skipping text, booleans and empties', () => {
    const inputs = { A1: '1', A2: '2', A3: 'x', A4: 'TRUE', B1: '5' };
    expect(valueAt({ ...inputs, C1: '=SUM(A1:B4)' }, 'C1')).toEqual(n(8));
    expect(valueAt({ ...inputs, C1: '=AVERAGE(A1:A4)' }, 'C1')).toEqual(n(1.5));
    expect(valueAt({ ...inputs, C1: '=MIN(A1:B4)' }, 'C1')).toEqual(n(1));
    expect(valueAt({ ...inputs, C1: '=MAX(A1:B4, 9)' }, 'C1')).toEqual(n(9));
    expect(valueAt({ ...inputs, C1: '=COUNT(A1:B4)' }, 'C1')).toEqual(n(3));
    expect(valueAt({ C1: '=AVERAGE(A1:A2)' }, 'C1')).toEqual(e('#DIV/0!'));
    expect(valueAt({ C1: '=MAX(A1:A2)' }, 'C1')).toEqual(n(0));
  });

  it('ROUND, ABS and IF', () => {
    expect(valueAt({ A1: '=ROUND(2.675, 2)' }, 'A1')).toEqual(n(2.68));
    expect(valueAt({ A1: '=ROUND(-1234.5, -2)' }, 'A1')).toEqual(n(-1200));
    expect(valueAt({ A1: '=ABS(-3)' }, 'A1')).toEqual(n(3));
    expect(valueAt({ A1: '=IF(1>2, "yes", "no")' }, 'A1')).toEqual({ t: 'str', v: 'no' });
    expect(valueAt({ A1: '=IF(0, 1)' }, 'A1')).toEqual({ t: 'bool', v: false });
    expect(valueAt({ A1: '=IF(TRUE, 1, 1/0)' }, 'A1')).toEqual(n(1));
    expect(valueAt({ A1: '=IF("x", 1, 2)' }, 'A1')).toEqual(e('#VALUE!'));
  });

  it('reports errors', () => {
    expect(valueAt({ A1: '=1/0' }, 'A1')).toEqual(e('#DIV/0!'));
    expect(valueAt({ A1: '=NOPE(1)' }, 'A1')).toEqual(e('#NAME?'));
    expect(valueAt({ A1: '="a"+1' }, 'A1')).toEqual(e('#VALUE!'));
    expect(valueAt({ A1: '=ABS(1, 2)' }, 'A1')).toEqual(e('#VALUE!'));
    expect(valueAt({ A1: '=10^400' }, 'A1')).toEqual(e('#NUM!'));
    expect(valueAt({ A1: '=1+' }, 'A1')).toEqual(e('#ERROR!'));
    expect(valueAt({ A1: '=Z9' }, 'A1')).toEqual(e('#REF!'));
    expect(valueAt({ A1: '=SUM(A2:A3)' }, 'A1')).toEqual(n(0));
    expect(valueAt({ A1: '=A2:A3' }, 'A1')).toEqual(e('#VALUE!'));
    expect(valueAt({ A1: '=1/0', B1: '=A1+1' }, 'B1')).toEqual(e('#DIV/0!'));
  });

  it('marks every cell of a cycle', () => {
    const inputs = { A1: '=B1', B1: '=C1', C1: '=A1', A2: '=A2+1' };
    expect(valueAt(inputs, 'A1')).toEqual(e('#CYCLE!'));
    expect(valueAt(inputs, 'B1')).toEqual(e('#CYCLE!'));
    expect(valueAt(inputs, 'C1')).toEqual(e('#CYCLE!'));
    expect(valueAt(inputs, 'A2')).toEqual(e('#CYCLE!'));
  });

  it('follows references across an inserted row', () => {
    const s = sheet({ A1: '3', B2: '=SUM(A1:A2)' });
    s.rows.splice(1, 0, { id: 'rX', order: 'a05' });
    s.cells[cellKey('rX', 'c1')] = { src: '4' };
    expect(evaluateSheet(s).get(cellKey('r2', 'c2'))).toEqual(n(7));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- sheet-evaluate`
Expected: FAIL.

- [ ] **Step 3: Write `sheet/evaluate.ts`:**

```ts
import type { IdRef } from './lexer';
import { cellKey, type SheetSnapshot } from './model';
import { type Ast, type BinOp, type CellError, parseFormula } from './parser';

export type CellValue =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: CellError }
  | { t: 'empty' };

type Num = { t: 'num'; v: number };
type Err = { t: 'err'; v: CellError };

const EMPTY: CellValue = { t: 'empty' };
const err = (v: CellError): Err => ({ t: 'err', v });
const num = (v: number): Num | Err => (Number.isFinite(v) ? { t: 'num', v } : err('#NUM!'));

const NUMBER_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The value of a non-formula source: a number literal, TRUE/FALSE, or text. */
export function literalValue(src: string): CellValue {
  if (src === '') return EMPTY;
  const s = src.trim();
  if (NUMBER_LITERAL.test(s)) return num(Number(s));
  const up = s.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' };
  return { t: 'str', v: src };
}

const toNum = (v: CellValue): Num | Err => {
  switch (v.t) {
    case 'num':
    case 'err':
      return v;
    case 'empty':
      return { t: 'num', v: 0 };
    case 'bool':
      return { t: 'num', v: v.v ? 1 : 0 };
    case 'str':
      return err('#VALUE!');
  }
};

const numberText = (n: number): string => String(Number(n.toPrecision(10)));

const toText = (v: CellValue): string => {
  switch (v.t) {
    case 'num':
      return numberText(v.v);
    case 'str':
      return v.v;
    case 'bool':
      return v.v ? 'TRUE' : 'FALSE';
    default:
      return '';
  }
};

type Plain = Exclude<CellValue, { t: 'err' }>;
const blankLike = (v: Plain): Plain =>
  v.t === 'num' ? { t: 'num', v: 0 } : v.t === 'str' ? { t: 'str', v: '' } : v.t === 'bool' ? { t: 'bool', v: false } : v;
const rank = (v: Plain): number => (v.t === 'num' ? 0 : v.t === 'str' ? 1 : 2);

/** Ordering for comparisons: numbers < text < booleans; text is case-insensitive; empty takes the other side's type. */
function compare(a0: Plain, b0: Plain): number {
  if (a0.t === 'empty' && b0.t === 'empty') return 0;
  const a = a0.t === 'empty' ? blankLike(b0) : a0;
  const b = b0.t === 'empty' ? blankLike(a0) : b0;
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
  if (a.t === 'num' && b.t === 'num') return Math.sign(a.v - b.v);
  if (a.t === 'str' && b.t === 'str') {
    const x = a.v.toLowerCase();
    const y = b.v.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (a.t === 'bool' && b.t === 'bool') return Number(a.v) - Number(b.v);
  return 0;
}

const COMPARISONS: Partial<Record<BinOp, (c: number) => boolean>> = {
  '=': (c) => c === 0,
  '<>': (c) => c !== 0,
  '<': (c) => c < 0,
  '>': (c) => c > 0,
  '<=': (c) => c <= 0,
  '>=': (c) => c >= 0,
};

function binary(op: BinOp, a: CellValue, b: CellValue): CellValue {
  if (a.t === 'err') return a;
  if (b.t === 'err') return b;
  if (op === '&') return { t: 'str', v: toText(a) + toText(b) };
  const cmp = COMPARISONS[op];
  if (cmp) return { t: 'bool', v: cmp(compare(a, b)) };
  const x = toNum(a);
  if (x.t === 'err') return x;
  const y = toNum(b);
  if (y.t === 'err') return y;
  switch (op) {
    case '+':
      return num(x.v + y.v);
    case '-':
      return num(x.v - y.v);
    case '*':
      return num(x.v * y.v);
    case '/':
      return y.v === 0 ? err('#DIV/0!') : num(x.v / y.v);
    default:
      return num(x.v ** y.v);
  }
}

/** Rounds half away from zero to `digits` (negative digits round left of the point). */
function round(x: number, digits: number): number {
  const shifted = Number(`${Math.abs(x)}e${digits}`);
  const r = Number.isFinite(shifted)
    ? Number(`${Math.round(shifted)}e${-digits}`)
    : Math.round(Math.abs(x) * 10 ** digits) / 10 ** digits;
  return Math.sign(x) * r;
}

const AGGREGATES = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT']);

/** Evaluates every formula of a sheet; the map holds a value for each non-empty cell. */
export function evaluateSheet(sheet: SheetSnapshot): Map<string, CellValue> {
  const rowIndex = new Map(sheet.rows.map((r, i) => [r.id, i]));
  const colIndex = new Map(sheet.cols.map((c, i) => [c.id, i]));
  const values = new Map<string, CellValue>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclic = new Set<string>();
  const asts = new Map<string, Ast | null>();

  const refKey = (ref: IdRef): string | null =>
    rowIndex.has(ref.row) && colIndex.has(ref.col) ? cellKey(ref.row, ref.col) : null;

  const valueOf = (key: string): CellValue => {
    const known = values.get(key);
    if (known) return known;
    if (onStack.has(key)) {
      for (let i = stack.lastIndexOf(key); i < stack.length; i++) cyclic.add(stack[i] as string);
      return err('#CYCLE!');
    }
    const cell = sheet.cells[key];
    let v: CellValue;
    if (!cell || cell.src === '') v = EMPTY;
    else if (!cell.src.startsWith('=')) v = literalValue(cell.src);
    else {
      let ast = asts.get(key);
      if (ast === undefined) {
        ast = parseFormula(cell.src.slice(1));
        asts.set(key, ast);
      }
      stack.push(key);
      onStack.add(key);
      v = ast ? scalar(ast) : err('#ERROR!');
      stack.pop();
      onStack.delete(key);
      if (v.t === 'empty') v = { t: 'num', v: 0 };
      if (cyclic.has(key)) v = err('#CYCLE!');
    }
    values.set(key, v);
    return v;
  };

  /** The values of a rectangular range in the current order; #REF! if a corner is gone. */
  const rangeValues = (from: IdRef, to: IdRef): CellValue[] | Err => {
    const r0 = rowIndex.get(from.row);
    const r1 = rowIndex.get(to.row);
    const c0 = colIndex.get(from.col);
    const c1 = colIndex.get(to.col);
    if (r0 === undefined || r1 === undefined || c0 === undefined || c1 === undefined) return err('#REF!');
    const out: CellValue[] = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        out.push(valueOf(cellKey((sheet.rows[r] as { id: string }).id, (sheet.cols[c] as { id: string }).id)));
      }
    }
    return out;
  };

  const aggregate = (name: string, args: Ast[]): CellValue => {
    if (args.length === 0) return err('#VALUE!');
    const nums: number[] = [];
    for (const a of args) {
      if (a.k === 'range' || a.k === 'ref') {
        let vals: CellValue[] | Err;
        if (a.k === 'range') vals = rangeValues(a.from, a.to);
        else {
          const key = refKey(a.ref);
          vals = key ? [valueOf(key)] : err('#REF!');
        }
        if (!Array.isArray(vals)) return vals;
        for (const v of vals) {
          if (v.t === 'err') return v;
          if (v.t === 'num') nums.push(v.v);
        }
        continue;
      }
      const v = scalar(a);
      if (v.t === 'err') return v;
      if (name === 'COUNT') {
        if (v.t === 'num') nums.push(v.v);
        continue;
      }
      const x = toNum(v);
      if (x.t === 'err') return x;
      nums.push(x.v);
    }
    const sum = nums.reduce((s, x) => s + x, 0);
    switch (name) {
      case 'SUM':
        return num(sum);
      case 'AVERAGE':
        return nums.length > 0 ? num(sum / nums.length) : err('#DIV/0!');
      case 'MIN':
        return num(nums.length > 0 ? nums.reduce((m, x) => Math.min(m, x)) : 0);
      case 'MAX':
        return num(nums.length > 0 ? nums.reduce((m, x) => Math.max(m, x)) : 0);
      default:
        return num(nums.length);
    }
  };

  const call = (name: string, args: Ast[]): CellValue => {
    if (AGGREGATES.has(name)) return aggregate(name, args);
    switch (name) {
      case 'ABS': {
        if (args.length !== 1) return err('#VALUE!');
        const x = toNum(scalar(args[0] as Ast));
        return x.t === 'num' ? num(Math.abs(x.v)) : x;
      }
      case 'ROUND': {
        if (args.length !== 2) return err('#VALUE!');
        const x = toNum(scalar(args[0] as Ast));
        if (x.t === 'err') return x;
        const d = toNum(scalar(args[1] as Ast));
        if (d.t === 'err') return d;
        return num(round(x.v, Math.trunc(d.v)));
      }
      case 'IF': {
        if (args.length < 2 || args.length > 3) return err('#VALUE!');
        const c = scalar(args[0] as Ast);
        if (c.t === 'err') return c;
        if (c.t === 'str') return err('#VALUE!');
        const truthy = c.t === 'bool' ? c.v : c.t === 'num' ? c.v !== 0 : false;
        if (truthy) return scalar(args[1] as Ast);
        return args[2] ? scalar(args[2]) : { t: 'bool', v: false };
      }
      default:
        return err('#NAME?');
    }
  };

  function scalar(node: Ast): CellValue {
    switch (node.k) {
      case 'num':
        return num(node.v);
      case 'str':
        return { t: 'str', v: node.v };
      case 'bool':
        return { t: 'bool', v: node.v };
      case 'err':
        return err(node.v);
      case 'ref': {
        const key = refKey(node.ref);
        return key ? valueOf(key) : err('#REF!');
      }
      case 'range':
        return err('#VALUE!');
      case 'neg': {
        const x = toNum(scalar(node.arg));
        return x.t === 'num' ? num(-x.v) : x;
      }
      case 'pct': {
        const x = toNum(scalar(node.arg));
        return x.t === 'num' ? num(x.v / 100) : x;
      }
      case 'bin':
        return binary(node.op, scalar(node.l), scalar(node.r));
      case 'call':
        return call(node.name, node.args);
    }
  }

  for (const key of Object.keys(sheet.cells)) valueOf(key);
  return values;
}
```

Export it from `index.ts`.

- [ ] **Step 4: Run the tests, typecheck, lint, then commit**

Run: `npm test -w @relay/core -- sheet-evaluate && npm run typecheck && npm run lint`
Expected: PASS and clean.

```bash
git add packages/core
git commit -m "feat(core): formula evaluator — arithmetic, text, comparisons, aggregates, IF, errors and cycles"
```

---

### Task 5: Core — display formatting and TSV

**Files:**
- Create: `packages/core/src/sheet/display.ts`
- Create: `packages/core/src/sheet/tsv.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/sheet-display.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export function formatValue(v: CellValue, fmt?: CellFormat, locale?: string): string;
export function defaultAlign(v: CellValue): CellAlign;   // num → right, bool/err → center, else left
export function toTsv(rows: string[][]): string;
export function parseTsv(text: string): string[][];
```

- [ ] **Step 1: Write the failing tests** — create `packages/core/test/sheet-display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultAlign, formatValue, parseTsv, toTsv } from '../src';

const n = (v: number) => ({ t: 'num' as const, v });

describe('formatValue', () => {
  it('formats by kind and number format (en-US)', () => {
    expect(formatValue({ t: 'empty' })).toBe('');
    expect(formatValue({ t: 'err', v: '#REF!' })).toBe('#REF!');
    expect(formatValue({ t: 'bool', v: true })).toBe('TRUE');
    expect(formatValue({ t: 'str', v: 'hi' })).toBe('hi');
    expect(formatValue(n(1 / 3), undefined, 'en-US')).toBe('0.3333333333');
    expect(formatValue(n(1234567), undefined, 'en-US')).toBe('1234567');
    expect(formatValue(n(1234.5), { num: 'number' }, 'en-US')).toBe('1,234.50');
    expect(formatValue(n(0.125), { num: 'percent' }, 'en-US')).toBe('12.5%');
    expect(formatValue(n(3), { num: 'eur' }, 'en-US')).toBe('€3.00');
    expect(formatValue(n(3), { num: 'usd' }, 'en-US')).toBe('$3.00');
  });

  it('aligns numbers right, booleans and errors centre, text left', () => {
    expect(defaultAlign(n(1))).toBe('right');
    expect(defaultAlign({ t: 'bool', v: false })).toBe('center');
    expect(defaultAlign({ t: 'err', v: '#NUM!' })).toBe('center');
    expect(defaultAlign({ t: 'str', v: 'x' })).toBe('left');
  });
});

describe('tsv', () => {
  it('round-trips fields with tabs, newlines and quotes', () => {
    const rows = [
      ['a', 'b\tc'],
      ['d"e', 'f\ng'],
      ['', 'h'],
    ];
    const text = toTsv(rows);
    expect(text).toBe('a\t"b\tc"\n"d""e"\t"f\ng"\n\th');
    expect(parseTsv(text)).toEqual(rows);
  });

  it('parses CRLF and a trailing newline as Excel writes them', () => {
    expect(parseTsv('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('solo')).toEqual([['solo']]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/core -- sheet-display`
Expected: FAIL.

- [ ] **Step 3: Write `sheet/display.ts`:**

```ts
import type { CellValue } from './evaluate';
import type { CellAlign, CellFormat, NumFormat } from './model';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string | undefined, kind: NumFormat | 'general'): Intl.NumberFormat {
  const key = `${locale ?? ''}|${kind}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.NumberFormatOptions =
      kind === 'number'
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : kind === 'percent'
          ? { style: 'percent', maximumFractionDigits: 2 }
          : kind === 'eur'
            ? { style: 'currency', currency: 'EUR' }
            : kind === 'usd'
              ? { style: 'currency', currency: 'USD' }
              : { maximumSignificantDigits: 10, useGrouping: false };
    f = new Intl.NumberFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

/** The text a cell shows. */
export function formatValue(v: CellValue, fmt?: CellFormat, locale?: string): string {
  switch (v.t) {
    case 'empty':
      return '';
    case 'err':
      return v.v;
    case 'bool':
      return v.v ? 'TRUE' : 'FALSE';
    case 'str':
      return v.v;
    case 'num':
      return formatter(locale, fmt?.num ?? 'general').format(v.v);
  }
}

export const defaultAlign = (v: CellValue): CellAlign =>
  v.t === 'num' ? 'right' : v.t === 'bool' || v.t === 'err' ? 'center' : 'left';
```

- [ ] **Step 4: Write `sheet/tsv.ts`:**

```ts
const NEEDS_QUOTE = /[\t\n\r"]/;

/** Tab-separated text as Excel and Google Sheets write it (quoted when a field has a tab, newline or quote). */
export function toTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((f) => (NEEDS_QUOTE.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join('\t'),
    )
    .join('\n');
}

/** Parses tab-separated text; quoted fields may hold tabs, newlines and doubled quotes. */
export function parseTsv(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (ch === '\t') {
      row.push(field);
      field = '';
      atFieldStart = true;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
```

Export both from `index.ts`.

- [ ] **Step 5: Run the tests, typecheck, lint, then commit**

Run: `npm test -w @relay/core -- sheet-display && npm run typecheck && npm run lint`
Expected: PASS and clean. If the ICU data on the machine formats `€3.00` differently, keep the assertion. Node 22 ships full ICU, where en-US gives `€3.00`.

```bash
git add packages/core
git commit -m "feat(core): cell display formats and tab-separated clipboard text"
```

---

### Task 6: Web — sheet plumbing (store, presence, commit, create, gating)

**Files:**
- Create: `apps/web/src/store/sheetStore.ts`
- Modify: `packages/core/src/presence/state.ts` (the `sheet` field)
- Modify: `apps/web/src/sync/presence.ts` (`setSheet`)
- Modify: `apps/web/src/board/controller.ts` (public `commit`, sheet `createPage`)
- Modify: `apps/web/src/board/session.ts` (sheet store)
- Modify: `apps/web/src/ui/PageTabs.tsx` (enable Spreadsheet)
- Modify: `apps/web/src/ui/useShortcuts.ts` and `apps/web/src/ui/useClipboard.ts` (board pages only)
- Create: `apps/web/src/sheet/SheetPage.tsx` (placeholder, replaced in Task 8)
- Modify: `apps/web/src/board/Board.tsx`
- Test: `apps/web/test/sheetStore.test.ts` (new)
- Test: `packages/core/test/presence.test.ts` (append)

**Interfaces:**
- Consumes: `readSheet`, `evaluateSheet`, `initialSheet`, `CellValue`, `SheetSnapshot` (Tasks 1–4).
- Produces:

```ts
// core presence
export interface SheetPresence { anchor: [string, string]; focus: [string, string]; editing: boolean }
// PresenceState gains: sheet?: SheetPresence | null   (parsePresence sets it only when valid)
// web
export interface SheetState { pageId: string | null; sheet: SheetSnapshot | null; values: Map<string, CellValue> }
export function createSheetStore(doc: Y.Doc, docStore: StoreApi<DocState>): { store: StoreApi<SheetState>; destroy(): void };
// BoardController gains:  commit(...commands: Command[]): boolean   — one undo step; false mid-gesture
// PresencePublisher gains: setSheet(s: SheetPresence | null): void
// BoardSession gains:      sheet: StoreApi<SheetState>
```

- [ ] **Step 1: Write the failing tests.**

Append to `packages/core/test/presence.test.ts`, inside or next to the existing `parsePresence` describe, reusing its `alice` fixture:

```ts
describe('sheet presence', () => {
  it('keeps a valid sheet selection and drops a malformed one', () => {
    const sheet = { anchor: ['r1', 'c1'], focus: ['r2', 'c3'], editing: true };
    expect(parsePresence({ user: alice, sheet })?.sheet).toEqual(sheet);
    expect(parsePresence({ user: alice, sheet: { anchor: ['r1'], focus: ['r2', 'c3'], editing: true } })?.sheet).toBeUndefined();
    expect(parsePresence({ user: alice, sheet: { anchor: ['r1', 'x'.repeat(17)], focus: ['r2', 'c3'], editing: false } })?.sheet).toBeUndefined();
    expect(parsePresence({ user: alice })).not.toHaveProperty('sheet');
  });
});
```

Create `apps/web/test/sheetStore.test.ts`:

```ts
import { applyCommand, cellKey, LOCAL_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';
import { createSheetStore } from '../src/store/sheetStore';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  const sheets = createSheetStore(doc, docs.store);
  return { doc, docs, controller, sheets };
}

describe('sheet store', () => {
  it('projects the active sheet page with computed values, and nothing on a board page', () => {
    const { doc, controller, sheets } = setup();
    expect(sheets.store.getState().sheet).toBeNull();
    const id = controller.createPage('sheet');
    controller.setPage(id);
    const state = sheets.store.getState();
    expect(state.pageId).toBe(id);
    expect(state.sheet?.rows).toHaveLength(50);
    expect(state.sheet?.cols).toHaveLength(12);
    const [r1, r2] = state.sheet?.rows ?? [];
    const [c1] = state.sheet?.cols ?? [];
    if (!r1 || !r2 || !c1) throw new Error('missing grid');
    applyCommand(
      doc,
      {
        type: 'SetCells',
        pageId: id,
        cells: [
          { row: r1.id, col: c1.id, src: '4' },
          { row: r2.id, col: c1.id, src: `=[${r1.id}.${c1.id}]*2` },
        ],
      },
      LOCAL_ORIGIN,
    );
    expect(sheets.store.getState().values.get(cellKey(r2.id, c1.id))).toEqual({ t: 'num', v: 8 });
    controller.setPage('main');
    expect(sheets.store.getState()).toMatchObject({ pageId: null, sheet: null });
  });

  it('commit applies commands as one undo step and refuses mid-gesture', () => {
    const { doc, controller, sheets } = setup();
    const id = controller.createPage('sheet');
    controller.setPage(id);
    const s = sheets.store.getState().sheet;
    const row = s?.rows[0]?.id as string;
    const col = s?.cols[0]?.id as string;
    expect(
      controller.commit(
        { type: 'SetCells', pageId: id, cells: [{ row, col, src: 'a' }] },
        { type: 'SetColWidth', pageId: id, id: col, width: 200 },
      ),
    ).toBe(true);
    expect(sheets.store.getState().sheet?.cols[0]?.width).toBe(200);
    controller.undo();
    expect(sheets.store.getState().sheet?.cells).toEqual({});
    expect(sheets.store.getState().sheet?.cols[0]?.width).toBe(120);
    expect(doc).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- sheetStore && npm test -w @relay/core -- presence`
Expected: FAIL.

- [ ] **Step 3: Core presence.** In `packages/core/src/presence/state.ts`:
  - add:

```ts
/** A user's selection on a sheet page: [rowId, colId] corners, and whether they are editing. */
export interface SheetPresence {
  anchor: [string, string];
  focus: [string, string];
  editing: boolean;
}
```

  - add `/** Selection on a sheet page (only sheet pages publish it). */ sheet?: SheetPresence | null;` to `PresenceState`;
  - add above `parsePresence`:

```ts
const isCellPair = (v: unknown): v is [string, string] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 16);

const readSheetPresence = (v: unknown): SheetPresence | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isCellPair(o.anchor) || !isCellPair(o.focus) || typeof o.editing !== 'boolean') return null;
  return { anchor: [o.anchor[0], o.anchor[1]], focus: [o.focus[0], o.focus[1]], editing: o.editing };
};
```

  - in `parsePresence`, build the result in a `const state: PresenceState = { …existing fields… };`, then add `const sheet = readSheetPresence(o.sheet); if (sheet) state.sheet = sheet; return state;`.

- [ ] **Step 4: The sheet store.** Create `apps/web/src/store/sheetStore.ts`:

```ts
import {
  type CellValue,
  evaluateSheet,
  getRoots,
  readSheet,
  type SheetSnapshot,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { type DocState, touchedIds } from './docStore';

export interface SheetState {
  /** The active page when it is a sheet page, else null. */
  pageId: string | null;
  sheet: SheetSnapshot | null;
  /** Computed values of the sheet's non-empty cells. */
  values: Map<string, CellValue>;
}

/** Projects the active sheet page (if any) and evaluates its formulas after every change to it. */
export function createSheetStore(
  doc: Y.Doc,
  docStore: StoreApi<DocState>,
): { store: StoreApi<SheetState>; destroy(): void } {
  const { sheets } = getRoots(doc);
  const store = createStore<SheetState>(() => ({ pageId: null, sheet: null, values: new Map() }));

  const refresh = () => {
    const { activePage, pages } = docStore.getState();
    const isSheet = pages.find((p) => p.id === activePage)?.type === 'sheet';
    const sheet = isSheet ? readSheet(sheets.get(activePage)) : null;
    store.setState({
      pageId: isSheet ? activePage : null,
      sheet,
      values: sheet ? evaluateSheet(sheet) : new Map(),
    });
  };

  const onSheets = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const active = docStore.getState().activePage;
    if (touchedIds(events, sheets).has(active)) refresh();
  };
  const unsubscribe = docStore.subscribe((s, prev) => {
    if (s.activePage !== prev.activePage || s.pages !== prev.pages) refresh();
  });
  sheets.observeDeep(onSheets);
  refresh();

  return {
    store,
    destroy() {
      unsubscribe();
      sheets.unobserveDeep(onSheets);
    },
  };
}
```

- [ ] **Step 5: Controller, publisher, session, tabs, gating and board.**

In `controller.ts`:
- Rename the internal `commitStep` so that it returns whether it committed: `const commitStep = (...commands: Command[]): boolean => { if (commands.length === 0 || !idle()) return false; …; return true; };`. Check existing callers that use its value (`place` does). Keep their behaviour.
- Add `/** Applies commands as one undo step (LOCAL origin); false (nothing applied) mid-gesture. */ commit(...commands: Command[]): boolean;` to `BoardController`, and return `commit: commitStep`.
- Import `initialSheet` from `@relay/core`. In `createPage`, pass the sheet for sheet pages:

```ts
      commitPage({
        type: 'CreatePage',
        page: { /* unchanged */ },
        ...(type === 'sheet' ? { sheet: initialSheet() } : {}),
      });
```

In `apps/web/src/sync/presence.ts`:
- add `setSheet(s: SheetPresence | null): void;` to the interface, with the import;
- add `sheet: null` to the initial state;
- add `setSheet: (s) => awareness.setLocalStateField('sheet', s),` to the returned object.

In `session.ts`:
- import `createSheetStore` and `SheetState`;
- add `/** Projection of the active sheet page (null sheet on other pages). */ sheet: StoreApi<SheetState>;` to `BoardSession`;
- create it after the doc store with `const sheetStore = createSheetStore(conn.doc, docStore.store);`;
- expose `sheet: sheetStore.store`;
- call `sheetStore.destroy();` in `destroy()`, before `docStore.destroy()`.

In `PageTabs.tsx`, replace the disabled Spreadsheet item with:

```ts
                { label: 'Spreadsheet', testId: 'page-add-sheet', onSelect: () => add('sheet') },
```

In `useShortcuts.ts` and `useClipboard.ts`, add this helper and early return.
- **Helper**, at module level in each file:

```ts
/** Board shortcuts and clipboard handlers act only on board pages. */
const onBoardPage = (session: BoardSession): boolean => {
  const { activePage, pages } = session.doc.getState();
  return pages.find((p) => p.id === activePage)?.type === 'board';
};
```

- **Early return:** inside `useShortcuts`' `onKeyDown`, and at the start of `useClipboard`'s `skip` (return true), bail out when `!onBoardPage(session)`. The keyup (Space release) and blur handlers stay unconditional.

Create the placeholder `apps/web/src/sheet/SheetPage.tsx`, which Task 8 replaces:

```tsx
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function SheetPage({ session }: { session: BoardSession }) {
  const size = useStore(session.sheet, (s) =>
    s.sheet ? `${s.sheet.rows.length} × ${s.sheet.cols.length}` : null,
  );
  return (
    <div data-testid="sheet-page" className="grid h-full place-items-center font-mono text-xs">
      {size ?? 'This sheet could not be loaded.'}
    </div>
  );
}
```

In `Board.tsx`:
- import `SheetPage`;
- replace the `type === 'board' ? (…) : (…)` expression, so that `type === 'sheet'` renders:

```tsx
        <div className="relative min-h-0 flex-1">
          <SheetPage session={session} />
          <StatusBanner session={session} />
        </div>
```

  The existing unsupported/no-pages branch stays for the other types.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. Existing `pages.spec` e2e assertions about `page-add-sheet` being disabled will be updated in Task 11. Run `npx playwright test e2e/pages.spec.ts` now; if it asserts `toBeDisabled` on `page-add-sheet`, change that line to assert `page-add-calendar` is disabled instead, in this task's commit.

- [ ] **Step 7: Commit**

```bash
git add packages/core apps/web e2e
git commit -m "feat(web): sheet pages — projection store, presence field, one-step commit, create from tabs"
```

---

### Task 7: Web — sheet controller

**Files:**
- Create: `apps/web/src/sheet/sheetController.ts`
- Test: `apps/web/test/sheetController.test.ts` (new)

**Interfaces:**
- Consumes:
  - `SheetState`/`createSheetStore` and `controller.commit` (Task 6);
  - from core: `toStored`, `toDisplay`, `shiftStored`, `gridOf`, `keysBetween`, `sheetId`, `formatValue`, `toTsv`, `parseTsv`, `cellKey`, and the limits.
- Produces:

```ts
export interface CellPos { row: string; col: string }
export interface SheetRange { r0: number; r1: number; c0: number; c1: number }   // inclusive indices, r0 ≤ r1, c0 ≤ c1
export interface SheetUiState { anchor: CellPos | null; focus: CellPos | null; editing: { draft: string; origin: 'cell' | 'bar' } | null }
export interface FormatPatch { bold?: boolean; align?: CellAlign | null; num?: NumFormat | null }
export function rangeOf(sheet: SheetSnapshot, a: CellPos, b: CellPos): SheetRange | null;
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
  fillDown(): void;
  fillTo(target: CellPos): void;
  destroy(): void;
}
export function createSheetController(opts: {
  sheet: StoreApi<SheetState>;
  commit: (...commands: Command[]) => boolean;
  canEdit: () => boolean;
  newId?: () => string;
  notify?: (message: string) => void;
}): SheetController;
```

- [ ] **Step 1: Write the failing tests** — create `apps/web/test/sheetController.test.ts`:

```ts
import { cellKey, toDisplay, gridOf } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createSheetController } from '../src/sheet/sheetController';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';
import { createSheetStore } from '../src/store/sheetStore';

function setup(opts: { canEdit?: boolean } = {}) {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  const sheets = createSheetStore(doc, docs.store);
  const page = board.createPage('sheet');
  board.setPage(page);
  const notify = vi.fn();
  let n = 0;
  const ctl = createSheetController({
    sheet: sheets.store,
    commit: board.commit,
    canEdit: () => opts.canEdit ?? true,
    newId: () => `n${String(++n).padStart(7, '0')}`,
    notify,
  });
  const s = () => sheets.store.getState().sheet as NonNullable<ReturnType<typeof sheets.store.getState>['sheet']>;
  /** The position of an A1 address in the current order. */
  const at = (addr: string) => {
    const col = addr.charCodeAt(0) - 65;
    const row = Number(addr.slice(1)) - 1;
    return { row: s().rows[row]?.id as string, col: s().cols[col]?.id as string };
  };
  const src = (addr: string) => {
    const p = at(addr);
    return toDisplay(s().cells[cellKey(p.row, p.col)]?.src ?? '', gridOf(s()));
  };
  const value = (addr: string) => {
    const p = at(addr);
    return sheets.store.getState().values.get(cellKey(p.row, p.col));
  };
  const type = (addr: string, text: string) => {
    ctl.select(at(addr));
    ctl.startEdit(text);
    ctl.commitEdit();
  };
  return { board, ctl, s, at, src, value, type, notify };
}

describe('sheet controller', () => {
  it('starts on A1 and edits cells, storing formulas by id', () => {
    const { ctl, at, src, value, type } = setup();
    expect(ctl.ui.getState().anchor).toEqual(at('A1'));
    type('A1', '4');
    type('B1', '=a1*2');
    expect(value('B1')).toEqual({ t: 'num', v: 8 });
    expect(src('B1')).toBe('=A1*2');
  });

  it('commitEdit moves afterwards; cancelEdit keeps the cell', () => {
    const { ctl, at, src } = setup();
    ctl.startEdit('x');
    ctl.commitEdit({ dRow: 1, dCol: 0 });
    expect(ctl.ui.getState().anchor).toEqual(at('A2'));
    ctl.startEdit('y');
    ctl.cancelEdit();
    expect(src('A2')).toBe('');
  });

  it('startEdit without text edits the current content in A1 form', () => {
    const { ctl, at, type } = setup();
    type('A1', '=B2+1');
    ctl.select(at('A1'));
    ctl.startEdit();
    expect(ctl.ui.getState().editing).toEqual({ draft: '=B2+1', origin: 'cell' });
  });

  it('references survive inserting a row above; deleting the referenced row gives #REF!', () => {
    const { ctl, at, src, value, type } = setup();
    type('A1', '3');
    type('B2', '=A1*2');
    ctl.select(at('A1'));
    ctl.insertRows('above');
    expect(src('B3')).toBe('=A2*2');
    expect(value('B3')).toEqual({ t: 'num', v: 6 });
    ctl.select(at('A2'));
    ctl.deleteRows();
    expect(src('B2')).toBe('=#REF!*2');
    expect(value('B2')).toEqual({ t: 'err', v: '#REF!' });
  });

  it('moves selection with clamping and extends with shift', () => {
    const { ctl, at } = setup();
    ctl.move(-1, -1);
    expect(ctl.ui.getState().anchor).toEqual(at('A1'));
    ctl.move(1, 2, true);
    expect(ctl.range()).toEqual({ r0: 0, r1: 1, c0: 0, c1: 2 });
    ctl.selectAll();
    expect(ctl.range()).toEqual({ r0: 0, r1: 49, c0: 0, c1: 11 });
  });

  it('clear removes sources but keeps formats; toggleBold and setFormat', () => {
    const { ctl, s, at, type } = setup();
    type('A1', '1');
    ctl.select(at('A1'));
    ctl.toggleBold();
    ctl.setFormat({ num: 'eur', align: 'center' });
    ctl.clear();
    expect(s().cells[cellKey(at('A1').row, at('A1').col)]).toEqual({
      src: '',
      fmt: { bold: true, num: 'eur', align: 'center' },
    });
    ctl.toggleBold();
    ctl.setFormat({ num: null, align: null });
    expect(s().cells[cellKey(at('A1').row, at('A1').col)]).toBeUndefined();
  });

  it('copies displayed values as TSV and pastes its own copy with shifted references', () => {
    const { ctl, at, src, type } = setup();
    type('A1', '2');
    type('B1', '=A1+1');
    ctl.select(at('A1'));
    ctl.select(at('B1'), true);
    const text = ctl.copy();
    expect(text).toBe('2\t3');
    ctl.select(at('A3'));
    expect(ctl.paste(text as string)).toBe(true);
    expect(src('B3')).toBe('=A3+1');
    expect(ctl.range()).toEqual({ r0: 2, r1: 2, c0: 0, c1: 1 });
  });

  it('pastes outside text, growing the sheet, with A1 formulas at their target', () => {
    const { ctl, s, at, src, value } = setup();
    ctl.select(at('L50'));
    expect(ctl.paste('5\t=L50*2\n6\t7')).toBe(true);
    expect(s().rows).toHaveLength(51);
    expect(s().cols).toHaveLength(13);
    expect(src('M50')).toBe('=L50*2');
    expect(value('M50')).toEqual({ t: 'num', v: 10 });
  });

  it('paste and cut are one undo step each', () => {
    const { board, ctl, s, at, type } = setup();
    ctl.select(at('A1'));
    ctl.paste('1\t2\n3\t4');
    board.undo();
    expect(s().cells).toEqual({});
    type('A1', 'x');
    ctl.select(at('A1'));
    expect(ctl.cut()).toBe('x');
    expect(s().cells).toEqual({});
  });

  it('fills down and to the right, shifting relative references', () => {
    const { ctl, at, src, type } = setup();
    type('A1', '1');
    type('B1', '=A1*10');
    ctl.select(at('B1'));
    ctl.select(at('B3'), true);
    ctl.fillDown();
    expect(src('B3')).toBe('=A3*10');
    ctl.select(at('B1'));
    ctl.fillTo(at('D1'));
    expect(src('D1')).toBe('=C1*10');
    expect(ctl.range()).toEqual({ r0: 0, r1: 0, c0: 1, c1: 3 });
  });

  it('moves rows and columns and resizes columns', () => {
    const { ctl, s, at, type } = setup();
    type('A1', 'first');
    const row = at('A1').row;
    ctl.moveRow(row, 2);
    expect(s().rows[2]?.id).toBe(row);
    const col = at('A1').col;
    ctl.moveCol(col, 1);
    expect(s().cols[1]?.id).toBe(col);
    ctl.setColWidth(col, 250);
    expect(s().cols[1]?.width).toBe(250);
  });

  it('enforces limits and the batch budget', () => {
    const { ctl, s, at, notify } = setup();
    ctl.select(at('A1'));
    ctl.selectAll();
    ctl.deleteRows();
    expect(s().rows).toHaveLength(50);
    expect(notify).toHaveBeenCalledWith('A sheet needs at least one row');
    ctl.select(at('A1'));
    expect(ctl.paste(Array.from({ length: 400 }, () => 'y'.repeat(600)).join('\n'))).toBe(false);
    expect(notify).toHaveBeenCalledWith('Too much to paste at once');
  });

  it('viewers can select and copy but not change anything', () => {
    const { ctl, s, at } = setup({ canEdit: false });
    ctl.startEdit('x');
    expect(ctl.ui.getState().editing).toBeNull();
    expect(ctl.paste('1')).toBe(false);
    ctl.insertRows('below');
    expect(s().rows).toHaveLength(50);
    ctl.select(at('B2'));
    expect(ctl.copy()).toBe('');
  });

  it('resets the selection when its row is deleted by anyone', () => {
    const { ctl, at } = setup();
    ctl.select(at('C3'));
    ctl.deleteRows();
    expect(ctl.ui.getState().anchor).toEqual(at('A1'));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- sheetController`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/sheet/sheetController.ts`:**

```ts
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
/** Rough size of a SetCells batch as a Yjs update (JSON text plus per-entry overhead). */
const batchBytes = (cells: SheetCellWrite[]) => JSON.stringify(cells).length + cells.length * 16;

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

  const setCells = (cells: SheetCellWrite[]): boolean => {
    const pageId = page();
    if (!pageId || cells.length === 0) return false;
    if (batchBytes(cells) > MAX_SHEET_BATCH_BYTES) {
      notify('Too much to paste at once');
      return false;
    }
    return run({ type: 'SetCells', pageId, cells });
  };

  const cellAt = (s: SheetSnapshot, r: number, c: number): { row: string; col: string; cell?: CellData } | null => {
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
    const shifted = src.startsWith('=') ? shiftStored(src, toR - fromR, toC - fromC, gridOf(s)) : src;
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
    const writes: SheetCellWrite[] = [];
    for (let i = r.r0; i <= r.r1; i++)
      for (let j = r.c0; j <= r.c1; j++) {
        const c = cellAt(s, i, j);
        if (c?.cell?.src) writes.push(write(c.row, c.col, '', c.cell.fmt));
      }
    setCells(writes);
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

  let clip: { text: string; r0: number; c0: number; cells: (CellData | null)[][] } | null = null;

  const copy = (): string | null => {
    const s = snap();
    const r = range();
    if (!s || !r) return null;
    const values = opts.sheet.getState().values;
    const lines: string[][] = [];
    const cells: (CellData | null)[][] = [];
    for (let i = r.r0; i <= r.r1; i++) {
      const line: string[] = [];
      const row: (CellData | null)[] = [];
      for (let j = r.c0; j <= r.c1; j++) {
        const c = cellAt(s, i, j);
        const key = c ? cellKey(c.row, c.col) : '';
        line.push(formatValue(values.get(key) ?? { t: 'empty' }, c?.cell?.fmt));
        row.push(c?.cell ?? null);
      }
      lines.push(line);
      cells.push(row);
    }
    const text = toTsv(lines);
    clip = { text, r0: r.r0, c0: r.c0, cells };
    return text;
  };

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
      ui.setState({
        editing: { draft: (initialText ?? toDisplay(current, gridOf(s))).slice(0, MAX_CELL_SRC), origin },
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
      ui.setState({ editing: null });
      if (e && s && a) {
        const cell = s.cells[cellKey(a.row, a.col)];
        const src = toStored(e.draft, gridOf(s));
        if (src.length > MAX_CELL_SRC) notify('That formula is too long');
        else if (src !== (cell?.src ?? '')) setCells([write(a.row, a.col, src, cell?.fmt)]);
      }
      if (then) move(then.dRow, then.dCol);
    },
    cancelEdit() {
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
      run({ type: 'DeleteRows', pageId, ids: s.rows.slice(r.r0, r.r1 + 1).map((x) => x.id) });
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
      run({ type: 'DeleteCols', pageId, ids: s.cols.slice(r.c0, r.c1 + 1).map((x) => x.id) });
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
    paste(text) {
      const s = snap();
      const r = range();
      const pageId = page();
      if (!s || !r || !pageId || !opts.canEdit()) return false;
      const own = clip && clip.text === text ? clip : null;
      const block: { src: string; fmt?: CellFormat }[][] = own
        ? own.cells.map((row) => row.map((c) => (c?.fmt ? { src: c.src, fmt: c.fmt } : { src: c?.src ?? '' })))
        : parseTsv(text).map((row) => row.map((src) => ({ src })));
      if (block.length === 0) return false;
      const height = block.length;
      const width = Math.max(...block.map((row) => row.length));
      const rowsNeeded = Math.min(MAX_SHEET_ROWS, r.r0 + height) - s.rows.length;
      const colsNeeded = Math.min(MAX_SHEET_COLS, r.c0 + width) - s.cols.length;
      const newRows =
        rowsNeeded > 0
          ? keysBetween(s.rows.at(-1)?.order ?? null, null, rowsNeeded).map((order) => ({ id: newId(), order }))
          : [];
      const newCols =
        colsNeeded > 0
          ? keysBetween(s.cols.at(-1)?.order ?? null, null, colsNeeded).map((order) => ({ id: newId(), order }))
          : [];
      const grid = {
        rows: [...s.rows.map((x) => x.id), ...newRows.map((x) => x.id)],
        cols: [...s.cols.map((x) => x.id), ...newCols.map((x) => x.id)],
      };
      const writes: SheetCellWrite[] = [];
      block.forEach((line, i) => {
        line.forEach((b, j) => {
          const row = grid.rows[r.r0 + i];
          const col = grid.cols[r.c0 + j];
          if (!row || !col) return;
          let src = b.src;
          if (src.startsWith('=')) {
            src = own ? shiftStored(src, r.r0 - own.r0, r.c0 - own.c0, grid) : toStored(src, grid);
          }
          const fmt = own ? b.fmt : s.cells[cellKey(row, col)]?.fmt;
          writes.push(write(row, col, src.slice(0, MAX_CELL_SRC), fmt));
        });
      });
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
        ui.setState({ anchor: { row: firstRow, col: firstCol }, focus: { row: lastRow, col: lastCol } });
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
      if (setCells(writes) && focus) ui.setState({ focus });
    },
    destroy() {
      unsubscribe();
    },
  };
}
```

**Note on the viewer test:** `copy()` for B2 of an empty sheet returns `''` (one empty field). That is the expected text.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npm test -w @relay/web -- sheetController && npm run typecheck && npm run lint`
Expected: PASS and clean.

If a test number is provably wrong, fix the test minimally and explain it in the report. For example, the budget test depends on `batchBytes`: 400 cells × 600 chars ≈ 246 KB > 192 KiB. Never loosen a behaviour assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): sheet controller — selection, editing, format, structure, clipboard and fill"
```

---

### Task 8: Web — the grid, formula bar and format bar

**Files:**
- Create: `apps/web/src/sheet/layout.ts`
- Create: `apps/web/src/sheet/SheetGrid.tsx`
- Create: `apps/web/src/sheet/FormulaBar.tsx`
- Create: `apps/web/src/sheet/FormatBar.tsx`
- Modify: `apps/web/src/sheet/SheetPage.tsx` (replace the placeholder)
- Test: `apps/web/test/sheetLayout.test.ts` (new)

**Interfaces:**
- Consumes:
  - `SheetController`, `rangeOf`, `SheetRange` (Task 7);
  - `session.sheet`, `session.publisher.setSheet`, `session.presence`, `session.controller.commit` (Task 6);
  - `onPage` (`render/pageFilter.ts`).
- Produces:

```ts
// layout.ts
export const ROW_H = 28; export const HEADER_H = 28; export const ROW_HEADER_W = 48; export const OVERSCAN = 10;
export function colOffsets(cols: readonly { width: number }[]): number[];            // prefix sums, length n+1
export function visibleRows(scrollTop: number, viewportH: number, rowCount: number): { start: number; end: number }; // [start, end)
export function rangeBox(r: SheetRange, offsets: readonly number[]): { left: number; top: number; width: number; height: number }; // content coords (headers included)
export function indexAt(offsets: readonly number[], x: number): number;              // column index under content x (−1 outside)
export function addressOf(sheet: SheetSnapshot, p: CellPos): string;                 // 'B3', '' if missing
```

- Test ids:
  - `sheet-page`, `sheet-grid`, `cell-<A1>` (one per rendered cell), `col-header-<letters>`, `row-header-<n>`;
  - `sheet-selection`, `sheet-peer-range`;
  - `formula-bar`, `sheet-address`;
  - `sheet-bold`, `sheet-align-left|center|right`, `sheet-num-format`.

- [ ] **Step 1: Write the failing test** — create `apps/web/test/sheetLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addressOf,
  colOffsets,
  HEADER_H,
  indexAt,
  OVERSCAN,
  ROW_HEADER_W,
  ROW_H,
  rangeBox,
  visibleRows,
} from '../src/sheet/layout';

describe('sheet layout', () => {
  it('computes column offsets and hit-tests them', () => {
    const offsets = colOffsets([{ width: 100 }, { width: 50 }, { width: 120 }]);
    expect(offsets).toEqual([0, 100, 150, 270]);
    expect(indexAt(offsets, ROW_HEADER_W + 99)).toBe(0);
    expect(indexAt(offsets, ROW_HEADER_W + 100)).toBe(1);
    expect(indexAt(offsets, ROW_HEADER_W + 400)).toBe(-1);
    expect(indexAt(offsets, 10)).toBe(-1);
  });

  it('renders only visible rows plus overscan', () => {
    expect(visibleRows(0, 280, 500)).toEqual({ start: 0, end: 10 + OVERSCAN });
    expect(visibleRows(ROW_H * 100, 280, 500)).toEqual({ start: 100 - OVERSCAN, end: 110 + OVERSCAN });
    expect(visibleRows(ROW_H * 495, 280, 500)).toEqual({ start: 495 - OVERSCAN, end: 500 });
  });

  it('boxes a range in content coordinates', () => {
    const offsets = colOffsets([{ width: 100 }, { width: 50 }]);
    expect(rangeBox({ r0: 1, r1: 2, c0: 1, c1: 1 }, offsets)).toEqual({
      left: ROW_HEADER_W + 100,
      top: HEADER_H + ROW_H,
      width: 50,
      height: ROW_H * 2,
    });
  });

  it('addresses cells in the current order', () => {
    const sheet = {
      rows: [{ id: 'r1', order: 'a0' }, { id: 'r2', order: 'a1' }],
      cols: [{ id: 'c1', order: 'a0', width: 120 }, { id: 'c2', order: 'a1', width: 120 }],
      cells: {},
    };
    expect(addressOf(sheet, { row: 'r2', col: 'c2' })).toBe('B2');
    expect(addressOf(sheet, { row: 'x', col: 'c2' })).toBe('');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -w @relay/web -- sheetLayout`
Expected: FAIL.

- [ ] **Step 3: Write `apps/web/src/sheet/layout.ts`:**

```ts
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
```

- [ ] **Step 4: The format bar and formula bar.**

`apps/web/src/sheet/FormatBar.tsx`:

```tsx
import { type CellAlign, cellKey, type NumFormat } from '@relay/core';
import { AlignCenter, AlignLeft, AlignRight, Bold } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { SheetController } from './sheetController';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

/** Bold, alignment and number format for the selection (editors only). */
export function FormatBar({ session, ctl }: { session: BoardSession; ctl: SheetController }) {
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const fmt = useStore(session.sheet, (s) =>
    anchor ? s.sheet?.cells[cellKey(anchor.row, anchor.col)]?.fmt : undefined,
  );
  const button = (active: boolean) =>
    `grid size-7 place-items-center border-2 ${active ? 'border-ink bg-sun' : 'border-transparent hover:border-ink'}`;
  return (
    <div
      role="toolbar"
      aria-label="Cell format"
      className="flex h-10 shrink-0 items-center gap-1 border-b-2 border-ink bg-white px-2"
    >
      <button
        type="button"
        data-testid="sheet-bold"
        aria-label="Bold (Ctrl+B)"
        aria-pressed={fmt?.bold === true}
        className={button(fmt?.bold === true)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ctl.toggleBold()}
      >
        <Bold className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-ink/20" aria-hidden />
      {(['left', 'center', 'right'] as const satisfies readonly CellAlign[]).map((align) => {
        const Icon = ALIGN_ICONS[align];
        const active = fmt?.align === align;
        return (
          <button
            key={align}
            type="button"
            data-testid={`sheet-align-${align}`}
            aria-label={`Align ${align}`}
            aria-pressed={active}
            className={button(active)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctl.setFormat({ align: active ? null : align })}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
      <span className="mx-1 h-5 w-px bg-ink/20" aria-hidden />
      <label className="flex items-center gap-1 font-mono text-[10px] uppercase text-ink/60">
        Format
        <select
          data-testid="sheet-num-format"
          value={fmt?.num ?? ''}
          onChange={(e) => ctl.setFormat({ num: (e.target.value || null) as NumFormat | null })}
          className="border-2 border-ink bg-white px-1 py-0.5 font-mono text-xs text-ink"
        >
          <option value="">General</option>
          <option value="number">Number</option>
          <option value="percent">Percent</option>
          <option value="eur">€ Euro</option>
          <option value="usd">$ Dollar</option>
        </select>
      </label>
    </div>
  );
}
```

`apps/web/src/sheet/FormulaBar.tsx`:

```tsx
import { cellKey, gridOf, MAX_CELL_SRC, toDisplay } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { addressOf } from './layout';
import type { SheetController } from './sheetController';

/** The active cell's address and source (A1 form); editors edit it here too. */
export function FormulaBar({
  session,
  ctl,
  canEdit,
}: {
  session: BoardSession;
  ctl: SheetController;
  canEdit: boolean;
}) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const editing = useStore(ctl.ui, (s) => s.editing);
  const address = sheet && anchor ? addressOf(sheet, anchor) : '';
  const stored = sheet && anchor ? (sheet.cells[cellKey(anchor.row, anchor.col)]?.src ?? '') : '';
  const shown = editing ? editing.draft : sheet ? toDisplay(stored, gridOf(sheet)) : '';
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b-2 border-ink bg-white px-2">
      <span data-testid="sheet-address" className="w-14 shrink-0 font-mono text-xs font-bold">
        {address}
      </span>
      <span className="font-mono text-xs text-ink/50" aria-hidden>
        fx
      </span>
      <input
        data-testid="formula-bar"
        aria-label="Cell contents"
        readOnly={!canEdit}
        value={shown}
        maxLength={MAX_CELL_SRC}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
        onFocus={() => {
          if (canEdit && !ctl.ui.getState().editing) ctl.startEdit(undefined, 'bar');
        }}
        onChange={(e) => ctl.setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            ctl.commitEdit({ dRow: e.shiftKey ? -1 : 1, dCol: 0 });
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            ctl.cancelEdit();
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (ctl.ui.getState().editing?.origin === 'bar') ctl.commitEdit();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: The grid.** Create `apps/web/src/sheet/SheetGrid.tsx`:

```tsx
import {
  cellKey,
  colLetters,
  defaultAlign,
  formatValue,
  type CellValue,
} from '@relay/core';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from '../render/pageFilter';
import { colOffsets, HEADER_H, ROW_H, ROW_HEADER_W, rangeBox, visibleRows } from './layout';
import { type CellPos, rangeOf, type SheetController } from './sheetController';

const EMPTY: CellValue = { t: 'empty' };

const Cell = memo(function Cell({
  address,
  row,
  col,
  width,
  text,
  align,
  bold,
}: {
  address: string;
  row: string;
  col: string;
  width: number;
  text: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
}) {
  return (
    <div
      data-cell
      data-row={row}
      data-col={col}
      data-testid={`cell-${address}`}
      className={`shrink-0 truncate border-b border-r border-ink/15 px-1.5 font-mono text-xs leading-[27px] ${bold ? 'font-bold' : ''}`}
      style={{ width, height: ROW_H, textAlign: align }}
    >
      {text}
    </div>
  );
});

/** Reads the cell under a client point. */
export function cellFromPoint(x: number, y: number): CellPos | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]');
  const row = el?.dataset.row;
  const col = el?.dataset.col;
  return row && col ? { row, col } : null;
}

export function SheetGrid({
  session,
  ctl,
  canEdit,
  headers,
  overlay,
}: {
  session: BoardSession;
  ctl: SheetController;
  canEdit: boolean;
  /** Column and row header renderers (Task 10 adds menus, reorder and resize). */
  headers?: {
    col(index: number, id: string, width: number): ReactNode;
    row(index: number, id: string): ReactNode;
  };
  /** Extra content drawn over the grid (cell editor, fill handle). */
  overlay?: ReactNode;
}) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const values = useStore(session.sheet, (s) => s.values);
  const pageId = useStore(session.sheet, (s) => s.pageId);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const focus = useStore(ctl.ui, (s) => s.focus);
  const peers = useStore(session.presence, (s) => s.peers);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const dragging = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!sheet) return null;
  const offsets = colOffsets(sheet.cols);
  const totalW = ROW_HEADER_W + (offsets.at(-1) ?? 0);
  const totalH = HEADER_H + sheet.rows.length * ROW_H;
  const { start, end } = visibleRows(view.top, view.height, sheet.rows.length);
  const selection = anchor && focus ? rangeOf(sheet, anchor, focus) : null;
  const peerRanges = peers.flatMap((p) => {
    if (!pageId || !onPage(p, pageId) || !p.sheet) return [];
    const r = rangeOf(
      sheet,
      { row: p.sheet.anchor[0], col: p.sheet.anchor[1] },
      { row: p.sheet.focus[0], col: p.sheet.focus[1] },
    );
    return r ? [{ peer: p, box: rangeBox(r, offsets), editing: p.sheet.editing }] : [];
  });

  return (
    <div
      ref={scroller}
      data-scroll-region
      data-testid="sheet-grid"
      className="relative min-h-0 flex-1 select-none overflow-auto bg-white"
      onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const p = cellFromPoint(e.clientX, e.clientY);
        if (!p) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
        if (ctl.ui.getState().editing) ctl.commitEdit();
        ctl.select(p, e.shiftKey);
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const p = cellFromPoint(e.clientX, e.clientY);
        if (p) ctl.select(p, true);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={(e) => {
        if (!canEdit || !cellFromPoint(e.clientX, e.clientY)) return;
        ctl.startEdit();
      }}
    >
      <div className="relative" style={{ width: totalW, height: totalH }}>
        <div className="sticky top-0 z-20 flex bg-paper" style={{ height: HEADER_H, width: totalW }}>
          <button
            type="button"
            aria-label="Select all"
            className="sticky left-0 z-30 shrink-0 border-b-2 border-r-2 border-ink bg-paper"
            style={{ width: ROW_HEADER_W, height: HEADER_H }}
            onClick={() => ctl.selectAll()}
          />
          {sheet.cols.map((c, i) =>
            headers ? (
              headers.col(i, c.id, c.width)
            ) : (
              <div
                key={c.id}
                data-testid={`col-header-${colLetters(i)}`}
                className="grid shrink-0 place-items-center border-b-2 border-r border-ink font-mono text-[11px] font-bold"
                style={{ width: c.width, height: HEADER_H }}
              >
                {colLetters(i)}
              </div>
            ),
          )}
        </div>
        {sheet.rows.slice(start, end).map((r, k) => {
          const i = start + k;
          return (
            <div key={r.id} className="absolute left-0 flex" style={{ top: HEADER_H + i * ROW_H, height: ROW_H }}>
              {headers ? (
                headers.row(i, r.id)
              ) : (
                <div
                  data-testid={`row-header-${i + 1}`}
                  className="sticky left-0 z-10 grid shrink-0 place-items-center border-b border-r-2 border-ink bg-paper font-mono text-[11px]"
                  style={{ width: ROW_HEADER_W, height: ROW_H }}
                >
                  {i + 1}
                </div>
              )}
              {sheet.cols.map((c, j) => {
                const key = cellKey(r.id, c.id);
                const cell = sheet.cells[key];
                const value = values.get(key) ?? EMPTY;
                return (
                  <Cell
                    key={c.id}
                    address={`${colLetters(j)}${i + 1}`}
                    row={r.id}
                    col={c.id}
                    width={c.width}
                    text={formatValue(value, cell?.fmt)}
                    align={cell?.fmt?.align ?? defaultAlign(value)}
                    bold={cell?.fmt?.bold === true}
                  />
                );
              })}
            </div>
          );
        })}
        {peerRanges.map(({ peer, box, editing }) => (
          <div
            key={peer.clientId}
            data-testid="sheet-peer-range"
            className="pointer-events-none absolute z-10 border-2"
            style={{ ...box, borderColor: peer.user.color }}
          >
            <span
              className="absolute -top-4 left-0 whitespace-nowrap px-1 font-mono text-[9px] font-bold text-white"
              style={{ background: peer.user.color }}
            >
              {editing ? `${peer.user.name} · typing…` : peer.user.name}
            </span>
          </div>
        ))}
        {selection && (
          <div
            data-testid="sheet-selection"
            className="pointer-events-none absolute z-10 border-2 border-cobalt bg-cobalt/10"
            style={rangeBox(selection, offsets)}
          />
        )}
        {overlay}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: The page.** Replace `apps/web/src/sheet/SheetPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { toast } from '../ui/toasts';
import { FormatBar } from './FormatBar';
import { FormulaBar } from './FormulaBar';
import { SheetGrid } from './SheetGrid';
import { createSheetController, type SheetController } from './sheetController';

export function SheetPage({ session }: { session: BoardSession }) {
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const hasSheet = useStore(session.sheet, (s) => s.sheet !== null);
  const [ctl, setCtl] = useState<SheetController | null>(null);

  useEffect(() => {
    const c = createSheetController({
      sheet: session.sheet,
      commit: session.controller.commit,
      canEdit: () => session.conn.clock.getState().role === 'edit',
      notify: toast,
    });
    // Publish only real changes: draft keystrokes change `editing` but not what peers see.
    let last = '';
    const publish = () => {
      const { anchor, focus, editing } = c.ui.getState();
      const next =
        anchor && focus
          ? { anchor: [anchor.row, anchor.col] as [string, string], focus: [focus.row, focus.col] as [string, string], editing: editing !== null }
          : null;
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      session.publisher.setSheet(next);
    };
    publish();
    const unsubscribe = c.ui.subscribe(publish);
    setCtl(c);
    return () => {
      unsubscribe();
      session.publisher.setSheet(null);
      c.destroy();
    };
  }, [session]);

  if (!ctl) return null;
  if (!hasSheet) {
    return (
      <div data-testid="unsupported-page" className="grid h-full place-items-center px-4 text-center font-mono text-xs">
        This sheet could not be loaded.
      </div>
    );
  }
  return (
    <div data-testid="sheet-page" className="flex h-full min-h-0 flex-col">
      {canEdit && <FormatBar session={session} ctl={ctl} />}
      <FormulaBar session={session} ctl={ctl} canEdit={canEdit} />
      <SheetGrid session={session} ctl={ctl} canEdit={canEdit} />
    </div>
  );
}
```

- [ ] **Step 7: Check it in a browser.** Write a throwaway Playwright spec (`e2e/zz-scratch-sheet.spec.ts`; delete it before committing):
  1. open a new room and add a Spreadsheet page;
  2. click `cell-B2` and check that `sheet-address` reads `B2`;
  3. scroll the grid to the bottom and check that `cell-A50` exists;
  4. take a screenshot to the scratchpad.

  Fix any layout issue it reveals.

- [ ] **Step 8: Run the tests, typecheck, lint and build, then commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint && npm run build -w @relay/web`
Expected: all green.

```bash
git add apps/web
git commit -m "feat(web): sheet grid with virtualised rows, selection, peer ranges, formula and format bars"
```

---

### Task 9: Web — keyboard, cell editor and clipboard on sheets

**Files:**
- Create: `apps/web/src/sheet/CellEditor.tsx`
- Create: `apps/web/src/sheet/useSheetKeys.ts`
- Create: `apps/web/src/sheet/useSheetClipboard.ts`
- Modify: `apps/web/src/sheet/SheetPage.tsx` (wire them)

**Interfaces:**
- Consumes: `SheetController` (Task 7); `SheetGrid` with its `overlay` prop, `rangeBox`, `colOffsets` (Task 8); `isTyping` (`ui/typing.ts`); `session.controller.undo/redo`.
- Produces:
  - `useSheetKeys(session, ctl)`
  - `useSheetClipboard(session, ctl)`
  - `<CellEditor session ctl />`, which renders an `input[data-testid=cell-editor]` over the active cell while an edit that started in the cell is open.

- [ ] **Step 1: Write the cell editor** — create `apps/web/src/sheet/CellEditor.tsx`:

```tsx
import { MAX_CELL_SRC } from '@relay/core';
import { useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { colOffsets, rangeBox } from './layout';
import { rangeOf, type SheetController } from './sheetController';

/** The inline editor over the active cell (edits that start in the grid). */
export function CellEditor({ session, ctl }: { session: BoardSession; ctl: SheetController }) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const editing = useStore(ctl.ui, (s) => s.editing);
  const ref = useRef<HTMLInputElement>(null);
  const open = editing?.origin === 'cell';

  // Layout effect: the editor must hold focus before the next keystroke arrives (typing
  // "=A1*2" starts the edit with "=" and the rest must land in this input, not the window).
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  if (!open || !sheet || !anchor) return null;
  const r = rangeOf(sheet, anchor, anchor);
  if (!r) return null;
  const box = rangeBox(r, colOffsets(sheet.cols));
  return (
    <input
      ref={ref}
      data-testid="cell-editor"
      aria-label="Edit cell"
      value={editing.draft}
      maxLength={MAX_CELL_SRC}
      className="absolute z-20 border-2 border-cobalt bg-white px-1.5 font-mono text-xs outline-none"
      style={{ ...box, minWidth: box.width }}
      onChange={(e) => ctl.setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          ctl.commitEdit({ dRow: e.shiftKey ? -1 : 1, dCol: 0 });
        } else if (e.key === 'Tab') {
          e.preventDefault();
          ctl.commitEdit({ dRow: 0, dCol: e.shiftKey ? -1 : 1 });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          ctl.cancelEdit();
        }
      }}
      onBlur={() => {
        if (ctl.ui.getState().editing?.origin === 'cell') ctl.commitEdit();
      }}
    />
  );
}
```

- [ ] **Step 2: Keyboard** — create `apps/web/src/sheet/useSheetKeys.ts`:

```ts
import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from '../ui/typing';
import type { SheetController } from './sheetController';

const ARROWS: Partial<Record<string, [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Grid keys on a sheet page (the formula bar and cell editor handle their own keys). */
export function useSheetKeys(session: BoardSession, ctl: SheetController | null) {
  useEffect(() => {
    if (!ctl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || ctl.ui.getState().editing) return;
      const canEdit = session.conn.clock.getState().role === 'edit';
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'a') {
          e.preventDefault();
          ctl.selectAll();
        } else if (!canEdit) {
          return;
        } else if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) session.controller.redo();
          else session.controller.undo();
        } else if (k === 'y') {
          e.preventDefault();
          session.controller.redo();
        } else if (k === 'b') {
          e.preventDefault();
          ctl.toggleBold();
        } else if (k === 'd') {
          e.preventDefault();
          ctl.fillDown();
        }
        return;
      }
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        ctl.move(arrow[0], arrow[1], e.shiftKey);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        ctl.move(0, e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        ctl.move(e.shiftKey ? -1 : 1, 0);
        return;
      }
      if (!canEdit) return;
      if (e.key === 'F2') {
        e.preventDefault();
        ctl.startEdit();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        ctl.clear();
      } else if (e.key.length === 1) {
        e.preventDefault();
        ctl.startEdit(e.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, ctl]);
}
```

- [ ] **Step 3: Clipboard** — create `apps/web/src/sheet/useSheetClipboard.ts`:

```ts
import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from '../ui/typing';
import type { SheetController } from './sheetController';

/** Ctrl/⌘+C, X and V on a sheet: tab-separated text, compatible with Excel and Google Sheets. */
export function useSheetClipboard(session: BoardSession, ctl: SheetController | null) {
  useEffect(() => {
    if (!ctl) return;
    const skip = (e: ClipboardEvent) =>
      !e.clipboardData ||
      isTyping(e.target) ||
      ctl.ui.getState().editing !== null ||
      (e.target instanceof Element && e.target.closest('[role="dialog"]') !== null);
    const canEdit = () => session.conn.clock.getState().role === 'edit';
    const onCopy = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const text = ctl.copy();
      if (text === null) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      const text = ctl.cut();
      if (text === null) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      if (ctl.paste(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [session, ctl]);
}
```

- [ ] **Step 4: Wire them into `SheetPage.tsx`:**
  - import the three modules;
  - call `useSheetKeys(session, ctl);` and `useSheetClipboard(session, ctl);` right after the `useState`/`useEffect`, before any early return (hooks must run unconditionally);
  - pass `overlay={<CellEditor session={session} ctl={ctl} />}` to `<SheetGrid>`.

- [ ] **Step 5: Check it in a browser.** Write a throwaway Playwright spec and delete it before committing:
  1. on a new sheet, type `4` then Enter, so A1 = 4 and the selection moves to A2;
  2. type `=A1*3` then Enter, and check that `cell-A2` shows `12`;
  3. press ArrowUp, then F2, and check that `cell-editor` holds `4`, then press Escape;
  4. dispatch a synthetic `paste` event with the data `1\t2\n3\t4` (as in `e2e/canvas-ux.spec.ts`) and check the values;
  5. press Ctrl+Z and check that the paste is undone;
  6. press `s` and check that no board tool changed (the board's shortcuts are off); a cell editor with `s` opens instead.

- [ ] **Step 6: Run the tests, typecheck, lint and build, then commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint && npm run build -w @relay/web`
Expected: all green.

```bash
git add apps/web
git commit -m "feat(web): sheet keyboard, inline cell editor and tab-separated clipboard"
```

---

### Task 10: Web — header menus, reorder, column resize and fill handle

**Files:**
- Create: `apps/web/src/sheet/SheetHeaders.tsx`
- Modify: `apps/web/src/sheet/SheetPage.tsx` (pass `headers`, add the fill handle to the overlay)

**Interfaces:**
- Consumes:
  - `SheetController`: `selectRow`, `selectCol`, `insertRows`, `insertCols`, `deleteRows`, `deleteCols`, `moveRow`, `moveCol`, `setColWidth`, `fillTo`, `range`;
  - `ContextMenu` (`ui/ContextMenu.tsx`);
  - layout constants and helpers, and `cellFromPoint` from `SheetGrid.tsx`.
- Produces:
  - `useSheetHeaders(session, ctl, canEdit)`, which returns `{ headers, menu }`. `headers` is the `SheetGrid` `headers` prop; `menu` is the open ContextMenu element or null.
  - `<FillHandle session ctl />`.
  - Test ids:
    - `col-header-<letters>` and `row-header-<n>` (kept);
    - `col-resize-<letters>` and `fill-handle`;
    - menu items `sheet-menu-insert-above`, `sheet-menu-insert-below`, `sheet-menu-delete-rows`, `sheet-menu-insert-left`, `sheet-menu-insert-right` and `sheet-menu-delete-cols`.

- [ ] **Step 1: Write `apps/web/src/sheet/SheetHeaders.tsx`:**

```tsx
import { colLetters, COL_WIDTH_MAX, COL_WIDTH_MIN } from '@relay/core';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { colOffsets, HEADER_H, ROW_H, ROW_HEADER_W, rangeBox } from './layout';
import { cellFromPoint } from './SheetGrid';
import { rangeOf, type SheetController } from './sheetController';

const DRAG_PX = 4;

type Drag = { kind: 'row' | 'col'; id: string; startX: number; startY: number; moved: boolean };

/** Header renderers with selection, context menus, drag-to-reorder and column resize. */
export function useSheetHeaders(session: BoardSession, ctl: SheetController, canEdit: boolean) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [resize, setResize] = useState<{ id: string; width: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const inSelection = (kind: 'row' | 'col', index: number) => {
    const r = ctl.range();
    if (!r) return false;
    return kind === 'row' ? index >= r.r0 && index <= r.r1 : index >= r.c0 && index <= r.c1;
  };

  const openMenu = (kind: 'row' | 'col', index: number, id: string, x: number, y: number) => {
    if (!canEdit) return;
    if (!inSelection(kind, index)) {
      if (kind === 'row') ctl.selectRow(id);
      else ctl.selectCol(id);
    }
    const items: MenuItem[] =
      kind === 'row'
        ? [
            { label: 'Insert row above', testId: 'sheet-menu-insert-above', onSelect: () => ctl.insertRows('above') },
            { label: 'Insert row below', testId: 'sheet-menu-insert-below', onSelect: () => ctl.insertRows('below') },
            { label: 'Delete rows', testId: 'sheet-menu-delete-rows', danger: true, onSelect: () => ctl.deleteRows() },
          ]
        : [
            { label: 'Insert column left', testId: 'sheet-menu-insert-left', onSelect: () => ctl.insertCols('left') },
            { label: 'Insert column right', testId: 'sheet-menu-insert-right', onSelect: () => ctl.insertCols('right') },
            { label: 'Delete columns', testId: 'sheet-menu-delete-cols', danger: true, onSelect: () => ctl.deleteCols() },
          ];
    setMenu({ x, y, items });
  };

  const pointerHandlers = (kind: 'row' | 'col', id: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (ctl.ui.getState().editing) ctl.commitEdit();
      drag.current = { kind, id, startX: e.clientX, startY: e.clientY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (kind === 'row') ctl.selectRow(id, e.shiftKey);
      else ctl.selectCol(id, e.shiftKey);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || !canEdit) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_PX) return;
      d.moved = true;
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (!d?.moved || !canEdit || !sheet) return;
      // Drop onto the row or column header under the pointer: the moved one takes its index.
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-header-index]');
      const index = el?.dataset.headerKind === d.kind ? Number(el.dataset.headerIndex) : -1;
      if (index < 0) return;
      if (d.kind === 'row') ctl.moveRow(d.id, index);
      else ctl.moveCol(d.id, index);
    },
  });

  const headers = {
    col(index: number, id: string, width: number): ReactNode {
      const letters = colLetters(index);
      const w = resize?.id === id ? resize.width : width;
      return (
        <div
          key={id}
          data-testid={`col-header-${letters}`}
          data-header-kind="col"
          data-header-index={index}
          className="relative grid shrink-0 cursor-default place-items-center border-b-2 border-r border-ink font-mono text-[11px] font-bold hover:bg-sun/40"
          style={{ width: w, height: HEADER_H }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu('col', index, id, e.clientX, e.clientY);
          }}
          {...pointerHandlers('col', id)}
        >
          {letters}
          {canEdit && (
            <div
              data-testid={`col-resize-${letters}`}
              aria-hidden
              className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const start = w;
                const onMove = (ev: PointerEvent) =>
                  setResize({ id, width: Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, start + ev.clientX - startX)) });
                const target = e.currentTarget;
                const onUp = (ev: PointerEvent) => {
                  target.removeEventListener('pointermove', onMove);
                  target.removeEventListener('pointerup', onUp);
                  const final = Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, start + ev.clientX - startX));
                  setResize(null);
                  if (final !== start) ctl.setColWidth(id, final);
                };
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', onUp);
              }}
            />
          )}
        </div>
      );
    },
    row(index: number, id: string): ReactNode {
      return (
        <div
          data-testid={`row-header-${index + 1}`}
          data-header-kind="row"
          data-header-index={index}
          className="sticky left-0 z-10 grid shrink-0 cursor-default place-items-center border-b border-r-2 border-ink bg-paper font-mono text-[11px] hover:bg-sun/40"
          style={{ width: ROW_HEADER_W, height: ROW_H }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu('row', index, id, e.clientX, e.clientY);
          }}
          {...pointerHandlers('row', id)}
        >
          {index + 1}
        </div>
      );
    },
  };

  const menuElement = menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null;
  return { headers, menu: menuElement };
}

/** The square at the selection's bottom-right corner: drag it down or right to fill. */
export function FillHandle({ session, ctl }: { session: BoardSession; ctl: SheetController }) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const focus = useStore(ctl.ui, (s) => s.focus);
  const editing = useStore(ctl.ui, (s) => s.editing);
  if (!sheet || !anchor || !focus || editing) return null;
  const r = rangeOf(sheet, anchor, focus);
  if (!r) return null;
  const box = rangeBox(r, colOffsets(sheet.cols));
  return (
    <div
      data-testid="fill-handle"
      aria-hidden
      className="absolute z-20 size-2.5 cursor-crosshair border border-white bg-cobalt"
      style={{ left: box.left + box.width - 5, top: box.top + box.height - 5 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        const target = cellFromPoint(e.clientX, e.clientY);
        if (target) ctl.fillTo(target);
      }}
    />
  );
}
```

**Implementer note:** the `React.PointerEvent` type needs `import type React from 'react'`, or import `PointerEvent as ReactPointerEvent` from 'react'. Pick whichever the codebase already uses (`Canvas.tsx` imports `type PointerEvent` from 'react').

**Interaction check:** the grid's `onPointerDown` must ignore presses that start on a header or the fill handle. Both call `stopPropagation`, and the grid only reacts to presses over `[data-cell]`.

- [ ] **Step 2: Wire them into `SheetPage.tsx`.**
  - Call `const { headers, menu } = useSheetHeaders(session, ctl, canEdit)`. `ctl` is null on the first render, so move the grid-level UI into a child component `SheetBody({ session, ctl, canEdit })` that is rendered only once `ctl` exists. It holds the hooks (`useSheetKeys`, `useSheetClipboard`, `useSheetHeaders`) and the three bars.
  - Always pass `headers={headers}` to the grid. Viewers also need header clicks to select rows and columns, and the hook already gates the menu, reorder and resize on `canEdit`.
  - Pass `overlay={<><CellEditor …/>{canEdit && <FillHandle …/>}</>}`.
  - Render `{menu}` after the grid.

- [ ] **Step 3: Check it in a browser.** Write a throwaway spec and delete it before committing:
  1. right-click `row-header-1`, choose `sheet-menu-insert-above`, and check the row count;
  2. drag `col-resize-A` 80 px right and check the new width of `col-header-A`;
  3. drag `row-header-3` onto `row-header-1` and check that its content moved;
  4. select A1:A2 with 1 and 2, drag `fill-handle` to A4, and check that A3 and A4 repeat 1 and 2.

- [ ] **Step 4: Run the tests, typecheck, lint and build, then commit**

Run: `npm test -w @relay/web && npm run typecheck && npm run lint && npm run build -w @relay/web`
Expected: all green.

```bash
git add apps/web
git commit -m "feat(web): sheet header menus, drag to reorder, column resize and fill handle"
```

---

### Task 11: E2E — sheets, then full verification

**Files:**
- Create: `e2e/sheets.spec.ts`

**Interfaces:**
- Consumes these test ids from Tasks 6–10:
  - `page-add`, `page-add-sheet`, `page-tab`;
  - `sheet-page`, `cell-<A1>`, `formula-bar`, `sheet-address`, `cell-editor`;
  - `row-header-<n>`, `sheet-menu-insert-above`, `col-header-<L>`, `col-resize-<L>`;
  - `sheet-bold`, `fill-handle`, `sheet-peer-range`, `toast`.

- [ ] **Step 1: Write the spec** — create `e2e/sheets.spec.ts`:

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function addSheet(page: Page) {
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-sheet').click();
  await expect(page.getByTestId('sheet-page')).toBeVisible();
}

async function typeInto(page: Page, address: string, text: string) {
  await page.getByTestId(`cell-${address}`).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('two users edit a sheet; formulas follow inserted rows', async ({ page, browser, request }) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  await addSheet(page);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);
  await pb.getByTestId('page-tab').nth(1).click();
  await expect(pb.getByTestId('sheet-page')).toBeVisible();

  await typeInto(page, 'A1', '4');
  await typeInto(page, 'B1', '=A1*2+SUM(A1:A3)');
  await expect(pb.getByTestId('cell-B1')).toHaveText('12');
  await typeInto(pb, 'A2', '6');
  await expect(page.getByTestId('cell-B1')).toHaveText('18');

  // B sees where A is.
  await expect(pb.getByTestId('sheet-peer-range')).toHaveCount(1);

  // Insert a row above row 1: the formula moves down and still points at its cells.
  await page.getByTestId('row-header-1').click({ button: 'right' });
  await page.getByTestId('sheet-menu-insert-above').click();
  await expect(pb.getByTestId('cell-B2')).toHaveText('18');
  await page.getByTestId('cell-B2').click();
  await expect(page.getByTestId('formula-bar')).toHaveValue('=A2*2+SUM(A2:A4)');
  await expect(page.getByTestId('sheet-address')).toHaveText('B2');

  // Undo the insert.
  await page.getByTestId('cell-C5').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('cell-B1')).toHaveText('18');
  await other.close();
});

test('paste from a spreadsheet app, fill down, format and resize', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);

  await page.getByTestId('cell-A1').click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '1\t=A1*10\n2\t\n3\t\n');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect(page.getByTestId('cell-B1')).toHaveText('10');

  await page.getByTestId('cell-B1').click();
  await page.getByTestId('cell-B3').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('cell-B3')).toHaveText('30');

  await page.getByTestId('cell-A1').click();
  await page.getByTestId('cell-A2').click({ modifiers: ['Shift'] });
  const handle = await page.getByTestId('fill-handle').boundingBox();
  const target = await page.getByTestId('cell-A5').boundingBox();
  if (!handle || !target) throw new Error('fill handle or A5 missing');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('cell-A5')).toHaveText('1');

  await page.getByTestId('cell-A1').click();
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('cell-A1')).toHaveClass(/font-bold/);
  await expect(page.getByTestId('sheet-bold')).toHaveAttribute('aria-pressed', 'true');

  const before = await page.getByTestId('col-header-A').boundingBox();
  const grip = await page.getByTestId('col-resize-A').boundingBox();
  if (!before || !grip) throw new Error('header missing');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await page.getByTestId('col-header-A').boundingBox())?.width ?? 0)
    .toBeGreaterThan(before.width + 60);
});

test('errors, cycles and deleted references show their codes', async ({ page, request }) => {
  const { roomId, editKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);
  await typeInto(page, 'A1', '=1/0');
  await expect(page.getByTestId('cell-A1')).toHaveText('#DIV/0!');
  await typeInto(page, 'B1', '=C1');
  await typeInto(page, 'C1', '=B1');
  await expect(page.getByTestId('cell-B1')).toHaveText('#CYCLE!');
  await typeInto(page, 'A3', '5');
  await typeInto(page, 'B4', '=A3+1');
  await expect(page.getByTestId('cell-B4')).toHaveText('6');
  await page.getByTestId('row-header-3').click();
  await page.getByTestId('row-header-3').click({ button: 'right' });
  await page.getByTestId('sheet-menu-delete-rows').click();
  await expect(page.getByTestId('cell-B3')).toHaveText('#REF!');
  await typeInto(page, 'D1', '=NOPE()');
  await expect(page.getByTestId('cell-D1')).toHaveText('#NAME?');
});

test('viewers can read and copy a sheet but not change it', async ({ page, browser, request }) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await addSheet(page);
  await typeInto(page, 'A1', 'read me');
  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await viewer.getByTestId('page-tab').nth(1).click();
  await expect(viewer.getByTestId('cell-A1')).toHaveText('read me');
  await viewer.getByTestId('cell-A1').click();
  await viewer.keyboard.type('x');
  await expect(viewer.getByTestId('cell-editor')).toHaveCount(0);
  await expect(viewer.getByTestId('formula-bar')).toHaveAttribute('readonly', '');
  await expect(viewer.getByTestId('sheet-bold')).toHaveCount(0);
  const copied = await viewer.evaluate(() => {
    const data = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
  expect(copied).toBe('read me');
  await viewerCtx.close();
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/sheets.spec.ts`
Expected: 4 passed.

If an assertion fails, find out whether the product or the test is wrong. Fix a product bug in its own commit, and never weaken an assertion.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run e2e && npm run build -w @relay/web`
Expected:
- all unit suites pass;
- every e2e test passes (the previous 25 plus these 4);
- lint and typecheck are clean;
- the build succeeds.

- [ ] **Step 4: Commit**

```bash
git add e2e/sheets.spec.ts
git commit -m "test(e2e): collaborative sheets — formulas, structure, paste, fill, format, viewers"
```
