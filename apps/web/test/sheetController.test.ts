import { cellKey, gridOf, toDisplay } from '@relay/core';
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
  const s = () =>
    sheets.store.getState().sheet as NonNullable<ReturnType<typeof sheets.store.getState>['sheet']>;
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
