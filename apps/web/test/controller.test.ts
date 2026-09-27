import {
  applyCommand,
  createUndo,
  DEFAULT_STYLE,
  getRoots,
  type PointerInfo,
  worldToScreen,
} from '@relay/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { type CameraStorage, createBoardController } from '../src/board/controller';
import { createDocStore } from '../src/store/docStore';

// Wraps the real createUndo so tests can spy on the Undo instance a controller
// creates internally (it isn't part of BoardController's public surface).
vi.mock('@relay/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@relay/core')>();
  return { ...actual, createUndo: vi.fn(actual.createUndo) };
});

const user = { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' };
const at = (x: number, y: number, hitId: string | null = null): PointerInfo => ({
  world: { x, y },
  shift: false,
  hitId,
});

function setup(opts: { cameraStorage?: CameraStorage } = {}) {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  let n = 0;
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    user,
    newId: () => `s${++n}`,
    now: () => 1000,
    ...opts,
  });
  return { doc, docs, controller };
}

describe('board controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates a sticky and opens the editor', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(300, 200) });
    expect(getRoots(doc).shapes.has('s1')).toBe(true);
    expect(controller.ui.getState().editingId).toBe('s1');
    expect(controller.ui.getState().tool.selection).toEqual(['s1']);
  });

  it('drags with throttled commits and lands exactly on the final position', () => {
    const { doc, controller } = setup();
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 'r1',
        type: 'rect',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        style: DEFAULT_STYLE.rect,
        text: '',
        createdBy: 'u1',
        authorName: 'Brisk Otter',
        createdAt: 0,
      },
    });
    const x = () => getRoots(doc).shapes.get('r1')?.get('x');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(20, 10) });
    expect(x()).toBe(10); // leading call commits immediately
    controller.dispatch({ type: 'pointerMove', p: at(30, 10) });
    expect(x()).toBe(10); // throttled
    controller.dispatch({ type: 'pointerUp', p: at(40, 10) });
    expect(x()).toBe(30); // final commit
    vi.advanceTimersByTime(200);
    expect(x()).toBe(30); // stale throttled move was cancelled
  });

  it('applyText writes a diff into Y.Text', () => {
    const { doc, docs, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.applyText('s1', { index: 0, deleteCount: 0, insert: 'Ship it' });
    expect(docs.store.getState().shapes.s1?.text).toBe('Ship it');
    expect(getRoots(doc).shapes.get('s1')?.get('text')?.toString()).toBe('Ship it');
  });

  it('closes the editor when the edited shape disappears', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1'] });
    expect(controller.ui.getState().editingId).toBeNull();
  });

  function addRect(doc: Y.Doc, id = 'r1', x = 0) {
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id,
        type: 'rect',
        x,
        y: 0,
        w: 100,
        h: 100,
        style: DEFAULT_STYLE.rect,
        text: '',
        createdBy: 'u1',
        authorName: 'Brisk Otter',
        createdAt: 0,
      },
    });
  }

  it('shows a local overlay on every move and clears it when the drag ends', () => {
    const { doc, controller } = setup();
    addRect(doc);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(20, 10) });
    expect(controller.ui.getState().overlay).toEqual({ r1: { x: 10, y: 0, w: 100, h: 100 } });
    controller.dispatch({ type: 'pointerMove', p: at(30, 10) });
    expect(controller.ui.getState().overlay).toEqual({ r1: { x: 20, y: 0, w: 100, h: 100 } });
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(10); // commit still throttled
    controller.dispatch({ type: 'pointerUp', p: at(40, 10) });
    expect(controller.ui.getState().overlay).toBeNull();
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(30);
  });

  it('undoes a whole drag in one step and redoes it', () => {
    const { doc, controller } = setup();
    addRect(doc);
    const x = () => getRoots(doc).shapes.get('r1')?.get('x');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(20, 10) });
    controller.dispatch({ type: 'pointerMove', p: at(30, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(40, 10) });
    expect(x()).toBe(30);
    controller.undo();
    expect(x()).toBe(0);
    controller.redo();
    expect(x()).toBe(30);
  });

  it('dragging a shape into a frame column groups the move and reparent into one undo step', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'frame' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.dispatch({ type: 'pointerUp', p: at(600, 400) });
    const frameId = controller.ui.getState().tool.selection[0] as string;
    const cols = getRoots(doc).shapes.get(frameId)?.get('columns') as
      | Y.Array<{ id: string; title: string }>
      | undefined;
    const firstColumnId = cols?.toArray()[0]?.id as string;
    addRect(doc, 'r1', 800);
    const rect = () => getRoots(doc).shapes.get('r1');
    controller.dispatch({ type: 'pointerDown', p: at(850, 50, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(150, 150) });
    controller.dispatch({ type: 'pointerUp', p: at(150, 150) });
    expect(rect()?.get('x')).toBe(100);
    expect(rect()?.get('y')).toBe(100);
    expect(rect()?.get('parentId')).toBe(frameId);
    expect(rect()?.get('columnId')).toBe(firstColumnId);
    controller.undo();
    expect(rect()?.get('x')).toBe(800);
    expect(rect()?.get('y')).toBe(0);
    expect(rect()?.get('parentId')).toBeUndefined();
    expect(rect()?.get('columnId')).toBeUndefined();
  });

  it('never undoes a remote change', () => {
    const { doc, controller } = setup();
    applyCommand(
      doc,
      {
        type: 'CreateShape',
        shape: {
          id: 'remote',
          type: 'rect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          style: DEFAULT_STYLE.rect,
          text: '',
          createdBy: 'u2',
          authorName: 'Calm Heron',
          createdAt: 0,
        },
      },
      'remote',
    );
    controller.undo();
    expect(getRoots(doc).shapes.has('remote')).toBe(true);
  });

  it('treats a text-editing session as its own undo step', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.applyText('s1', { index: 0, deleteCount: 0, insert: 'Hi' });
    controller.applyText('s1', { index: 2, deleteCount: 0, insert: ' there' });
    controller.stopEditing();
    const text = () => getRoots(doc).shapes.get('s1')?.get('text')?.toString();
    expect(text()).toBe('Hi there');
    controller.undo();
    expect(text()).toBe('');
    controller.undo();
    expect(getRoots(doc).shapes.has('s1')).toBe(false);
  });

  it('closes the undo step (not just the editor) when the edited shape is deleted remotely', () => {
    const { doc, controller } = setup();
    const undoInstance = vi.mocked(createUndo).mock.results.at(-1)?.value as ReturnType<
      typeof createUndo
    >;
    const stopCapturing = vi.spyOn(undoInstance, 'stopCapturing');

    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) }); // creates s1, opens the editor
    addRect(doc, 'r1');
    stopCapturing.mockClear(); // ignore the create's own endGesture call

    controller.applyText('s1', { index: 0, deleteCount: 0, insert: 'Hi' });
    expect(stopCapturing).not.toHaveBeenCalled(); // still mid text-editing session

    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1'] }, 'remote');
    expect(controller.ui.getState().editingId).toBeNull();
    // The text-editing step must be closed here — not left open for the next
    // local change to merge into (React may not fire onBlur for an unmounted textarea).
    expect(stopCapturing).toHaveBeenCalledTimes(1);

    const x = () => getRoots(doc).shapes.get('r1')?.get('x');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(20, 10) });
    controller.dispatch({ type: 'pointerMove', p: at(30, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(40, 10) });
    expect(x()).toBe(30);

    controller.undo(); // must revert only the drag, not the unrelated text step
    expect(x()).toBe(0);
  });

  it('ignores undo while a gesture is in progress', () => {
    const { doc, controller } = setup();
    addRect(doc);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    controller.undo();
    expect(controller.ui.getState().tool.mode).toBe('dragging');
  });

  it('creates a connector between two shapes and toggles its routing', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1');
    addRect(doc, 'r2', 400);
    controller.dispatch({ type: 'setTool', tool: 'connector' });
    controller.dispatch({ type: 'pointerDown', p: at(50, 50, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(300, 50) });
    controller.dispatch({ type: 'pointerUp', p: at(450, 50, 'r2') });
    const { connectors } = getRoots(doc);
    expect(connectors.size).toBe(1);
    const [id] = [...connectors.keys()];
    expect(controller.ui.getState().tool.selection).toEqual([id]);
    controller.dispatch({ type: 'toggleRouting' });
    expect(connectors.get(id as string)?.get('routing')).toBe('elbow');
  });

  it('creates a connector as its own undo step', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1');
    addRect(doc, 'r2', 400);
    controller.dispatch({ type: 'setTool', tool: 'connector' });
    controller.dispatch({ type: 'pointerDown', p: at(50, 50, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(300, 50) });
    controller.dispatch({ type: 'pointerUp', p: at(450, 50, 'r2') });
    expect(getRoots(doc).connectors.size).toBe(1);
    controller.undo();
    expect(getRoots(doc).connectors.size).toBe(0);
    expect(getRoots(doc).shapes.has('r1')).toBe(true);
    expect(getRoots(doc).shapes.has('r2')).toBe(true);
  });

  it('opens the column editor and renames a column as its own undo step', () => {
    const { doc, controller } = setup();
    controller.dispatch({ type: 'setTool', tool: 'frame' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.dispatch({ type: 'pointerUp', p: at(600, 400) });
    const frameId = controller.ui.getState().tool.selection[0] as string;
    const columns = () => {
      const cols = getRoots(doc).shapes.get(frameId)?.get('columns') as
        | Y.Array<{ id: string; title: string }>
        | undefined;
      return cols?.toArray() ?? [];
    };
    const firstColumn = columns()[0]?.id as string;
    controller.dispatch({
      type: 'doubleClick',
      p: { ...at(50, 50, frameId), column: { frameId, columnId: firstColumn } },
    });
    expect(controller.ui.getState().editingColumn).toEqual({ frameId, columnId: firstColumn });
    controller.renameColumn(frameId, firstColumn, 'Wins');
    expect(controller.ui.getState().editingColumn).toBeNull();
    expect(columns()[0]?.title).toBe('Wins');
    controller.undo();
    expect(columns()[0]?.title).toBe('Went well');
    expect(getRoots(doc).shapes.has(frameId)).toBe(true);
  });

  /** Draws a frame, opens its first column's editor, and returns the ids needed to act on it. */
  function openFrameColumnEditor(doc: Y.Doc, controller: ReturnType<typeof createBoardController>) {
    controller.dispatch({ type: 'setTool', tool: 'frame' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.dispatch({ type: 'pointerUp', p: at(600, 400) });
    const frameId = controller.ui.getState().tool.selection[0] as string;
    const cols = getRoots(doc).shapes.get(frameId)?.get('columns') as
      | Y.Array<{ id: string; title: string }>
      | undefined;
    const columnId = cols?.toArray()[0]?.id as string;
    controller.dispatch({
      type: 'doubleClick',
      p: { ...at(50, 50, frameId), column: { frameId, columnId } },
    });
    return { frameId, columnId };
  }

  it('stopEditingColumn closes the column editor', () => {
    const { doc, controller } = setup();
    const { frameId, columnId } = openFrameColumnEditor(doc, controller);
    expect(controller.ui.getState().editingColumn).toEqual({ frameId, columnId });
    controller.stopEditingColumn();
    expect(controller.ui.getState().editingColumn).toBeNull();
  });

  it('undo and redo close the column editor', () => {
    const { doc, controller } = setup();
    const { frameId, columnId } = openFrameColumnEditor(doc, controller);
    expect(controller.ui.getState().editingColumn).toEqual({ frameId, columnId });
    controller.undo();
    expect(controller.ui.getState().editingColumn).toBeNull();
    controller.redo();
    expect(controller.ui.getState().editingColumn).toBeNull();
  });

  it('closes the column editor when the edited frame is deleted remotely', () => {
    const { doc, controller } = setup();
    const { frameId, columnId } = openFrameColumnEditor(doc, controller);
    expect(controller.ui.getState().editingColumn).toEqual({ frameId, columnId });
    applyCommand(doc, { type: 'DeleteShapes', ids: [frameId] }, 'remote');
    expect(controller.ui.getState().editingColumn).toBeNull();
  });

  it('selects an existing connector hit by the pointer', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1');
    addRect(doc, 'r2', 400);
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'k1',
        from: { shapeId: 'r1', anchor: 'auto' },
        to: { shapeId: 'r2', anchor: 'auto' },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    controller.dispatch({
      type: 'pointerDown',
      p: { world: { x: 200, y: 50 }, shift: false, hitId: null, connectorId: 'k1' },
    });
    expect(controller.ui.getState().tool.selection).toEqual(['k1']);
  });
});

function addRect(doc: Y.Doc, id: string, x: number, y: number) {
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id,
      type: 'rect',
      x,
      y,
      w: 200,
      h: 100,
      style: DEFAULT_STYLE.rect,
      text: '',
      createdBy: 'u1',
      authorName: 'Brisk Otter',
      createdAt: 0,
    },
  });
}

describe('camera', () => {
  it('zooms around the viewport centre or an anchor, and resets to 100%', () => {
    const { controller } = setup();
    controller.setViewportSize(800, 600);
    controller.zoomBy(2);
    const cam = controller.ui.getState().camera;
    expect(cam.zoom).toBe(2);
    expect(worldToScreen(cam, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
    controller.resetZoom();
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    controller.zoomBy(2, { x: 0, y: 0 });
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it('centres on a world point', () => {
    const { controller } = setup();
    controller.setViewportSize(800, 600);
    controller.centerOn({ x: 1000, y: 500 });
    expect(controller.ui.getState().camera).toEqual({ x: -600, y: -200, zoom: 1 });
  });

  it('restores a stored camera and saves every camera change', () => {
    const save = vi.fn();
    const { controller } = setup({
      cameraStorage: { load: () => ({ x: 10, y: 20, zoom: 2 }), save },
    });
    expect(controller.ui.getState().camera).toEqual({ x: 10, y: 20, zoom: 2 });
    controller.setCamera({ x: 1, y: 2, zoom: 1 });
    expect(save).toHaveBeenLastCalledWith({ x: 1, y: 2, zoom: 1 });
  });

  it('fits the content once, after the first sync, without saving the fit', () => {
    const save = vi.fn();
    const { doc, controller } = setup({ cameraStorage: { load: () => null, save } });
    addRect(doc, 'r1', 1000, 1000);
    controller.setViewportSize(800, 600);
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    controller.markSynced();
    const cam = controller.ui.getState().camera;
    expect(cam.zoom).toBe(1);
    expect(worldToScreen(cam, { x: 1100, y: 1050 })).toEqual({ x: 400, y: 300 });
    expect(save).not.toHaveBeenCalled();
    addRect(doc, 'r2', 5000, 5000);
    controller.markSynced();
    expect(controller.ui.getState().camera).toEqual(cam);
  });

  it('fits when the canvas is measured after the sync', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1', 1000, 1000);
    controller.markSynced();
    controller.setViewportSize(800, 600);
    expect(worldToScreen(controller.ui.getState().camera, { x: 1100, y: 1050 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('does not fit an empty board, a restored camera, or one the user already moved', () => {
    const empty = setup();
    empty.controller.setViewportSize(800, 600);
    empty.controller.markSynced();
    expect(empty.controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });

    const restored = setup({
      cameraStorage: { load: () => ({ x: 5, y: 5, zoom: 1 }), save: vi.fn() },
    });
    addRect(restored.doc, 'r1', 1000, 1000);
    restored.controller.setViewportSize(800, 600);
    restored.controller.markSynced();
    expect(restored.controller.ui.getState().camera).toEqual({ x: 5, y: 5, zoom: 1 });

    const moved = setup();
    addRect(moved.doc, 'r1', 1000, 1000);
    moved.controller.setViewportSize(800, 600);
    moved.controller.setCamera({ x: 7, y: 7, zoom: 1 });
    moved.controller.markSynced();
    expect(moved.controller.ui.getState().camera).toEqual({ x: 7, y: 7, zoom: 1 });
  });

  it('a pointerDown before the first sync cancels the pending fit', () => {
    const { doc, controller } = setup();
    addRect(doc, 'r1', 1000, 1000);
    controller.setViewportSize(800, 600);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(10, 10) });
    controller.markSynced();
    expect(controller.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('tracks the pointer and whether Space is held', () => {
    const { controller } = setup();
    controller.setPointer({ x: 1, y: 2 });
    controller.setSpaceHeld(true);
    expect(controller.ui.getState().pointer).toEqual({ x: 1, y: 2 });
    expect(controller.ui.getState().spaceHeld).toBe(true);
    controller.setPointer(null);
    expect(controller.ui.getState().pointer).toBeNull();
  });
});
