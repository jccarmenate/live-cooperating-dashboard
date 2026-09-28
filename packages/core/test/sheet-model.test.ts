import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  COL_WIDTH_DEFAULT,
  cellKey,
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
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'p',
      cells: [{ row: 'r1', col: 'c1', src: '' }],
    });
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
    applyCommand(doc, {
      type: 'InsertCols',
      pageId: 'p',
      cols: [{ id: 'c3', order: 'a5', width: 300 }],
    });
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
    const cellsMap = getRoots(doc).sheets.get('p')?.get('cells');
    expect(cellsMap).toBeInstanceOf(Y.Map);
    expect([...(cellsMap as Y.Map<unknown>).keys()]).toEqual([]);
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
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'other',
      cells: [{ row: 'r1', col: 'c1', src: 'x' }],
    });
    expect(getRoots(doc).sheets.has('other')).toBe(false);
  });

  it('reads defensively: orphan cells, bad widths, bad formats, row cap', () => {
    const doc = sheetDoc();
    const sheet = getRoots(doc).sheets.get('p') as Y.Map<unknown>;
    const cells = sheet.get('cells') as Y.Map<unknown>;
    cells.set(cellKey('ghost', 'c1'), { src: 'orphan' });
    cells.set(cellKey('r1', 'c1'), {
      src: 'ok',
      fmt: { bold: 'yes', align: 'middle', num: 'eur' },
    });
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
    applyCommand(
      doc,
      { type: 'SetCells', pageId: 'p', cells: [{ row: 'r1', col: 'c1', src: '1' }] },
      LOCAL_ORIGIN,
    );
    undo.undo();
    expect(snap(doc)?.cells).toEqual({});
    expect(getRoots(doc).sheets.has('p')).toBe(true);
  });
});
