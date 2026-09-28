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
    const { controller, sheets } = setup();
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
    // Mid-gesture (a marquee on the canvas) nothing is applied.
    controller.dispatch({
      type: 'pointerDown',
      p: { world: { x: 0, y: 0 }, shift: false, hitId: null },
    });
    expect(controller.ui.getState().tool.mode).not.toBe('idle');
    expect(controller.commit({ type: 'SetColWidth', pageId: id, id: col, width: 300 })).toBe(false);
    expect(sheets.store.getState().sheet?.cols[0]?.width).toBe(120);
    controller.dispatch({ type: 'cancel' });
  });
});
