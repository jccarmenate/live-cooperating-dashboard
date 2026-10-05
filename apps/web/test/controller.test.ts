import {
  applyCommand,
  type BoardAccess,
  createUndo,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  MAX_BOARD_TITLE,
  MAX_PAGE_TITLE,
  type PointerInfo,
  SESSION_ORIGIN,
  type Undo,
  worldToScreen,
} from '@relay/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { type CameraStorage, createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
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

function setup(
  opts: {
    cameraStorage?: CameraStorage;
    serverNow?: () => number;
    access?: () => BoardAccess;
  } = {},
) {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  let n = 0;
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user,
    newId: () => `s${++n}`,
    now: () => 1000,
    serverNow: () => 1_000_000,
    ...opts,
  });
  return { doc, docs, activity, controller };
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

/** The Undo instance the most recently created controller wraps (see the createUndo mock). */
function lastUndo(): Undo {
  return vi.mocked(createUndo).mock.results.at(-1)?.value as Undo;
}

function addRect(doc: Y.Doc, id: string, x: number, y: number, pageId?: string) {
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id,
      ...(pageId ? { pageId } : {}),
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

function addSticky(doc: Y.Doc, id: string, x = 0) {
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id,
      type: 'sticky',
      x,
      y: 0,
      w: 160,
      h: 120,
      style: DEFAULT_STYLE.sticky,
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
    expect(save).toHaveBeenLastCalledWith('main', { x: 1, y: 2, zoom: 1 });
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

describe('voting', () => {
  it('starts a vote on server time, toggles votes, caps at three and ends it', () => {
    const { doc, controller, activity } = setup();
    for (const id of ['a', 'b', 'c', 'd']) addSticky(doc, id);
    controller.startVote(3);
    expect(activity.store.getState().vote).toEqual({
      open: true,
      endsAt: 1_000_000 + 180_000,
      maxPerUser: 3,
      startedBy: 'u1',
    });
    for (const id of ['a', 'b', 'c', 'd']) controller.toggleVote(id);
    expect(activity.store.getState().voteKeys).toEqual(['a:u1', 'b:u1', 'c:u1']);
    controller.toggleVote('a');
    expect(activity.store.getState().voteKeys).toEqual(['b:u1', 'c:u1']);
    controller.endVote();
    expect(activity.store.getState().vote?.open).toBe(false);
    controller.toggleVote('d');
    expect(activity.store.getState().voteKeys).toEqual(['b:u1', 'c:u1']);
  });

  it('refuses votes on non-stickies and outside an open vote, and never enters undo', () => {
    const { doc, controller, activity } = setup();
    addSticky(doc, 'a');
    addRect(doc, 'r', 500, 0);
    controller.toggleVote('a');
    expect(activity.store.getState().voteKeys).toEqual([]);
    controller.startVote(1);
    controller.toggleVote('r');
    controller.toggleVote('a');
    expect(activity.store.getState().voteKeys).toEqual(['a:u1']);
    controller.undo();
    expect(activity.store.getState().voteKeys).toEqual(['a:u1']);
  });
});

describe('comments', () => {
  it('the comment tool opens a composer; posting creates a thread and opens it', () => {
    const { controller, activity } = setup();
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(40, 50) });
    expect(controller.ui.getState().composer).toEqual({
      anchor: { x: 40, y: 50 },
      at: { x: 40, y: 50 },
    });
    controller.addComment('  Looks good  ');
    const [id] = activity.store.getState().commentOrder;
    expect(activity.store.getState().comments[id as string]?.entries[0]).toMatchObject({
      authorId: 'u1',
      author: 'Brisk Otter',
      body: 'Looks good',
    });
    expect(controller.ui.getState().composer).toBeNull();
    expect(controller.ui.getState().openThread).toBe(id);
  });

  it('an empty body cancels; replies and resolve work; canvas clicks close popovers', () => {
    const { controller, activity } = setup();
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.addComment('   ');
    expect(activity.store.getState().commentOrder).toEqual([]);
    expect(controller.ui.getState().composer).toBeNull();

    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.addComment('first');
    const [id] = activity.store.getState().commentOrder as [string];
    controller.replyComment(id, 'second');
    controller.replyComment(id, '  ');
    expect(activity.store.getState().comments[id]?.entries.map((e) => e.body)).toEqual([
      'first',
      'second',
    ]);
    controller.resolveComment(id, true);
    expect(activity.store.getState().comments[id]?.resolved).toBe(true);

    controller.dispatch({ type: 'setTool', tool: 'select' });
    controller.dispatch({ type: 'pointerDown', p: at(900, 900) });
    controller.dispatch({ type: 'pointerUp', p: at(900, 900) });
    expect(controller.ui.getState().openThread).toBeNull();
  });

  it('commits votes and comments under SESSION_ORIGIN, which undo never tracks', () => {
    const { doc, controller, activity } = setup();
    addSticky(doc, 'a');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    controller.startVote(1);
    controller.toggleVote('a');
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.addComment('first');
    const [id] = activity.store.getState().commentOrder as [string];
    controller.replyComment(id, 'second');
    expect(origins).toHaveLength(4);
    expect(origins.every((o) => o === SESSION_ORIGIN)).toBe(true);
  });

  it('toggles the comments panel', () => {
    const { controller } = setup();
    controller.toggleCommentsPanel();
    expect(controller.ui.getState().commentsPanel).toBe(true);
    controller.toggleCommentsPanel();
    expect(controller.ui.getState().commentsPanel).toBe(false);
  });
});

describe('pages', () => {
  it('stamps the active page on created shapes, connectors and comments', () => {
    const { doc, controller } = setup();
    const p2 = controller.createPage('board');
    controller.setPage(p2);
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(100, 100) });
    const sid = controller.ui.getState().tool.selection[0] as string;
    expect(getRoots(doc).shapes.get(sid)?.get('pageId')).toBe(p2);
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(500, 500) });
    controller.addComment('here');
    const [cid] = [...getRoots(doc).comments.keys()];
    expect(
      getRoots(doc)
        .comments.get(cid as string)
        ?.get('pageId'),
    ).toBe(p2);
  });

  it('switching pages resets tool state, clears undo, and loads that page camera', () => {
    const cams: Record<string, { x: number; y: number; zoom: number }> = {
      p9: { x: 3, y: 4, zoom: 2 },
    };
    const { doc, controller } = setup({
      cameraStorage: {
        load: (page) => cams[page] ?? null,
        save: (page, c) => {
          cams[page] = c;
        },
      },
    });
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id: 'p9', type: 'board', title: 'Nine', order: 'a5', createdBy: 'u', createdAt: 0 },
      },
      LOCAL_ORIGIN,
    );
    const undoStack = lastUndo();
    addRect(doc, 'r1', 0, 0);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(60, 10) });
    // A second drag, undone, leaves something on the redo stack too.
    controller.dispatch({ type: 'pointerDown', p: at(60, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(110, 10) });
    controller.dispatch({ type: 'pointerUp', p: at(110, 10) });
    controller.undo();
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(50);
    expect(undoStack.canRedo()).toBe(true);
    controller.setCamera({ x: 7, y: 7, zoom: 1 });
    controller.setPage('p9');
    expect(controller.ui.getState().camera).toEqual({ x: 3, y: 4, zoom: 2 });
    expect(controller.ui.getState().tool.selection).toEqual([]);
    expect(undoStack.canUndo()).toBe(false);
    expect(undoStack.canRedo()).toBe(false);
    controller.undo();
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(50); // the drag on main was not undone
    controller.redo();
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(50); // nor redone
    controller.setPage('main');
    expect(controller.ui.getState().camera).toEqual({ x: 7, y: 7, zoom: 1 });
  });

  it('a remote delete of the active page falls back and resets editor, popovers, undo and camera', () => {
    const cams: Record<string, { x: number; y: number; zoom: number }> = {};
    const { doc, controller } = setup({
      cameraStorage: {
        load: (page) => cams[page] ?? null,
        save: (page, c) => {
          cams[page] = c;
        },
      },
    });
    const undoStack = lastUndo();
    controller.setCamera({ x: 7, y: 7, zoom: 1 });
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id: 'p9', type: 'board', title: 'Nine', order: 'a5', createdBy: 'u', createdAt: 0 },
      },
      LOCAL_ORIGIN,
    );
    controller.setPage('p9');
    controller.setCamera({ x: 1, y: 1, zoom: 3 });
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) }); // an undo step, and the editor opens
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(500, 500) }); // the composer opens
    controller.openThread('t1');
    const before = controller.ui.getState();
    expect(before.editingId).not.toBeNull();
    expect(before.composer).not.toBeNull();
    expect(before.openThread).toBe('t1');
    expect(undoStack.canUndo()).toBe(true);

    applyCommand(doc, { type: 'DeletePage', id: 'p9' }, 'remote');

    const after = controller.ui.getState();
    expect(after.editingId).toBeNull();
    expect(after.composer).toBeNull();
    expect(after.openThread).toBeNull();
    expect(after.camera).toEqual({ x: 7, y: 7, zoom: 1 });
    expect(undoStack.canUndo()).toBe(false);
    expect(undoStack.canRedo()).toBe(false);
  });

  it('stamps the active page on a connector drawn with the connector tool', () => {
    const { doc, controller } = setup();
    const p2 = controller.createPage('board');
    addRect(doc, 'r1', 0, 0, p2);
    addRect(doc, 'r2', 400, 0, p2);
    controller.setPage(p2);
    controller.dispatch({ type: 'setTool', tool: 'connector' });
    controller.dispatch({ type: 'pointerDown', p: at(50, 50, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(300, 50) });
    controller.dispatch({ type: 'pointerUp', p: at(450, 50, 'r2') });
    const { connectors } = getRoots(doc);
    expect(connectors.size).toBe(1);
    const [kid] = [...connectors.keys()];
    expect(connectors.get(kid as string)?.get('pageId')).toBe(p2);
  });

  it('page actions: create after the last, rename, move between neighbours, delete', () => {
    const { docs, controller } = setup();
    const a = controller.createPage('board');
    const b = controller.createPage('board');
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main', a, b]);
    expect(docs.store.getState().pages[1]?.title).toBe('Board 2');
    controller.renamePage(a, '  Ideas  ');
    controller.renamePage(b, '   ');
    expect(docs.store.getState().pages.map((p) => p.title)).toEqual(['Board', 'Ideas', 'Board 3']);
    controller.movePage(b, 0);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual([b, 'main', a]);
    controller.deletePage(a);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual([b, 'main']);
  });

  it('never deletes the last visible page', () => {
    const { docs, controller } = setup();
    controller.deletePage('main');
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main']);
  });

  it('deletePage reports whether it deleted: false for the last or a missing page', () => {
    const { docs, controller } = setup();
    expect(controller.deletePage('main')).toBe(false);
    const a = controller.createPage('board');
    const b = controller.createPage('board');
    expect(controller.deletePage(a)).toBe(true);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main', b]);
    expect(controller.deletePage(a)).toBe(false);
    expect(controller.deletePage('nope')).toBe(false);
    expect(controller.deletePage(b)).toBe(true);
    expect(controller.deletePage('main')).toBe(false);
    expect(docs.store.getState().pages.map((p) => p.id)).toEqual(['main']);
  });

  it('vote cap counts stickies on every page', () => {
    const { doc, controller, activity } = setup();
    const p2 = controller.createPage('board');
    addSticky(doc, 'm1');
    addSticky(doc, 'm2');
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 'q1',
        pageId: p2,
        type: 'sticky',
        x: 0,
        y: 0,
        w: 160,
        h: 120,
        style: DEFAULT_STYLE.sticky,
        text: '',
        createdBy: 'u1',
        authorName: 'A',
        createdAt: 0,
      },
    });
    addSticky(doc, 'm3');
    controller.startVote(3);
    controller.toggleVote('m1');
    controller.toggleVote('m2');
    controller.setPage(p2);
    controller.toggleVote('q1');
    controller.setPage('main');
    controller.toggleVote('m3');
    expect(activity.store.getState().voteKeys).toEqual(['m1:u1', 'm2:u1', 'q1:u1']);
  });

  it('renameBoard trims and ignores empty titles', () => {
    const { docs, controller } = setup();
    controller.renameBoard('  Q3 Retro ');
    controller.renameBoard('  ');
    expect(docs.store.getState().meta.title).toBe('Q3 Retro');
  });

  it('writes page and board titles cut to their caps', () => {
    const { doc, controller } = setup();
    const a = controller.createPage('board');
    controller.renamePage(a, ` ${'p'.repeat(200)} `);
    controller.renameBoard(` ${'b'.repeat(300)} `);
    const { pages, meta } = getRoots(doc);
    expect(pages.get(a)?.get('title')).toBe('p'.repeat(MAX_PAGE_TITLE));
    expect(meta.get('title')).toBe('b'.repeat(MAX_BOARD_TITLE));
  });
});

describe('board controller by access', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const sticky = (id: string) => ({
    type: 'CreateShape' as const,
    shape: {
      id,
      type: 'sticky' as const,
      x: 0,
      y: 0,
      w: 180,
      h: 140,
      style: DEFAULT_STYLE.sticky,
      text: 'note',
      createdBy: 'u1',
      authorName: 'Test',
      createdAt: 0,
    },
  });

  it('on a full board applies deletions and drops everything else', () => {
    let access: BoardAccess = 'edit';
    const { doc, activity, controller } = setup({ access: () => access });
    controller.commit(sticky('a'), sticky('b'));
    controller.startVote(3);
    expect(getRoots(doc).shapes.size).toBe(2);

    access = 'delete-only';
    controller.commit(sticky('c'));
    controller.commit({ type: 'MoveShapes', moves: [{ id: 'a', x: 50, y: 50 }] });
    controller.commitSession({ type: 'EndVote' });
    expect(getRoots(doc).shapes.has('c')).toBe(false);
    expect(getRoots(doc).shapes.get('a')?.get('x')).toBe(0);
    expect(activity.store.getState().vote?.open).toBe(true);

    controller.commit({ type: 'DeleteShapes', ids: ['a'] });
    expect(getRoots(doc).shapes.has('a')).toBe(false);
  });

  it('for a viewer applies nothing, a deletion included', () => {
    let access: BoardAccess = 'edit';
    const { doc, controller } = setup({ access: () => access });
    controller.commit(sticky('a'));

    access = 'read-only';
    controller.commit(sticky('b'));
    controller.commit({ type: 'DeleteShapes', ids: ['a'] });
    controller.renameBoard('Mine now');
    expect(getRoots(doc).shapes.has('b')).toBe(false);
    expect(getRoots(doc).shapes.has('a')).toBe(true);
    expect(getRoots(doc).meta.get('title')).toBeUndefined();
  });

  it('does not undo or redo unless the board takes edits: an undo would write content back', () => {
    let access: BoardAccess = 'edit';
    const { doc, controller } = setup({ access: () => access });
    controller.commit(sticky('a'));
    for (const blocked of ['delete-only', 'read-only'] as const) {
      access = blocked;
      controller.undo();
      expect(getRoots(doc).shapes.has('a')).toBe(true);
    }
    access = 'edit';
    controller.undo();
    expect(getRoots(doc).shapes.has('a')).toBe(false);
  });
});
