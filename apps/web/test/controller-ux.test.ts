import {
  applyCommand,
  CLIP_PREFIX,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  readShape,
} from '@relay/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

const user = { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' };

function setup() {
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
    newId: () => `id${++n}`,
    now: () => 1000,
    serverNow: () => 1_000_000,
  });
  return { doc, docs, controller };
}

const sticky = (id: string, extra: Partial<NewShape> = {}): NewShape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 180,
  h: 140,
  style: DEFAULT_STYLE.sticky,
  text: id,
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 1,
  ...extra,
});
const frame = (id: string): NewShape =>
  sticky(id, { type: 'frame', w: 600, h: 400, style: DEFAULT_STYLE.frame, text: '' });
const add = (doc: Y.Doc, shape: NewShape) =>
  applyCommand(doc, { type: 'CreateShape', shape }, LOCAL_ORIGIN);
const read = (doc: Y.Doc, id: string) => {
  const m = getRoots(doc).shapes.get(id);
  return m ? readShape(id, m) : null;
};
const selection = (c: ReturnType<typeof setup>['controller']) => c.ui.getState().tool.selection;

describe('controller canvas actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('copies the selection as a Relay clip and remembers it', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    expect(controller.copySelection()).toBeNull();
    controller.select(['a']);
    const text = controller.copySelection();
    expect(text?.startsWith(CLIP_PREFIX)).toBe(true);
    expect(controller.lastCopied()).toBe(text);
  });

  it('pastes a clip at +24 px, then +48 px, selected, each paste one undo step', () => {
    const { doc, docs, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    const text = controller.copySelection() as string;
    expect(controller.pasteText(text)).toBe(true);
    const first = selection(controller)[0] as string;
    expect(read(doc, first)).toMatchObject({ x: 24, y: 24, text: 'a' });
    controller.pasteText(text);
    const second = selection(controller)[0] as string;
    expect(read(doc, second)).toMatchObject({ x: 48, y: 48 });
    controller.undo();
    expect(read(doc, second)).toBeNull();
    expect(read(doc, first)).not.toBeNull();
    expect(Object.keys(docs.store.getState().shapes)).toHaveLength(2);
  });

  it('pastes centred on a point', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    controller.pasteText(controller.copySelection() as string, { x: 500, y: 500 });
    expect(read(doc, selection(controller)[0] as string)).toMatchObject({ x: 410, y: 430 });
  });

  it('pastes plain text as a sticky; blank text pastes nothing', () => {
    const { doc, controller } = setup();
    expect(controller.pasteText('   ')).toBe(false);
    expect(controller.pasteText('From elsewhere', { x: 0, y: 0 })).toBe(true);
    expect(read(doc, selection(controller)[0] as string)?.text).toBe('From elsewhere');
  });

  it('pastes onto the active page', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    const text = controller.copySelection() as string;
    const page = controller.createPage('board');
    controller.setPage(page);
    controller.pasteText(text);
    expect(
      getRoots(doc)
        .shapes.get(selection(controller)[0] as string)
        ?.get('pageId'),
    ).toBe(page);
  });

  it('cut deletes the unlocked part and keeps locked shapes selected', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b', { x: 300 }));
    applyCommand(doc, { type: 'SetLocked', ids: ['b'], locked: true }, LOCAL_ORIGIN);
    controller.select(['a', 'b']);
    expect(controller.cutSelection()?.startsWith(CLIP_PREFIX)).toBe(true);
    expect(read(doc, 'a')).toBeNull();
    expect(read(doc, 'b')).not.toBeNull();
    expect(selection(controller)).toEqual(['b']);
  });

  it('mutating actions do nothing mid-gesture; cut returns null without copying', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.dispatch({
      type: 'pointerDown',
      p: { world: { x: 5, y: 5 }, shift: false, hitId: 'a' },
    });
    controller.dispatch({
      type: 'pointerMove',
      p: { world: { x: 60, y: 60 }, shift: false, hitId: null },
    });
    expect(controller.ui.getState().tool.mode).toBe('dragging');
    expect(controller.cutSelection()).toBeNull();
    controller.setStyle({ fill: '#000000' });
    expect(read(doc, 'a')).not.toBeNull();
    expect(read(doc, 'a')?.style.fill).toBe(DEFAULT_STYLE.sticky.fill);
    expect(controller.lastCopied()).toBeNull();
  });

  it('cutting a locked frame leaves it and its unlocked child', () => {
    const { doc, controller } = setup();
    add(doc, frame('f'));
    add(doc, sticky('c', { x: 20, y: 20, parentId: 'f' }));
    applyCommand(doc, { type: 'SetLocked', ids: ['f'], locked: true }, LOCAL_ORIGIN);
    controller.select(['f']);
    expect(controller.cutSelection()?.startsWith(CLIP_PREFIX)).toBe(true);
    expect(read(doc, 'f')).not.toBeNull();
    expect(read(doc, 'c')).not.toBeNull();
    expect(selection(controller)).toEqual(['f']);
  });

  it('cutting an unlocked frame deletes it and its child as one undo step', () => {
    const { doc, controller } = setup();
    add(doc, frame('f'));
    add(doc, sticky('c', { x: 20, y: 20, parentId: 'f' }));
    controller.select(['f']);
    controller.cutSelection();
    expect(read(doc, 'f')).toBeNull();
    expect(read(doc, 'c')).toBeNull();
    controller.undo();
    expect(read(doc, 'f')).not.toBeNull();
    expect(read(doc, 'c')).not.toBeNull();
  });

  it('cut never deletes a selected connector the copy dropped', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b', { x: 400 }));
    applyCommand(doc, { type: 'SetLocked', ids: ['a'], locked: true }, LOCAL_ORIGIN);
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          from: { shapeId: 'a', anchor: 'auto' },
          to: { shapeId: 'b', anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    controller.select(['a', 'k']);
    controller.cutSelection();
    expect(read(doc, 'a')).not.toBeNull();
    expect(read(doc, 'b')).not.toBeNull();
    expect(getRoots(doc).connectors.get('k')).toBeDefined();
  });

  it('cutting only locked shapes keeps the connector between them unless it was selected', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b', { x: 400 }));
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          from: { shapeId: 'a', anchor: 'auto' },
          to: { shapeId: 'b', anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    applyCommand(doc, { type: 'SetLocked', ids: ['a', 'b'], locked: true }, LOCAL_ORIGIN);
    controller.select(['a', 'b']);
    expect(controller.cutSelection()?.startsWith(CLIP_PREFIX)).toBe(true);
    expect(read(doc, 'a')).not.toBeNull();
    expect(read(doc, 'b')).not.toBeNull();
    expect(getRoots(doc).connectors.get('k')).toBeDefined();
    controller.select(['a', 'b', 'k']);
    controller.cutSelection();
    expect(getRoots(doc).connectors.get('k')).toBeUndefined();
  });

  it('a Relay clip that fails to parse pastes nothing', () => {
    const { docs, controller } = setup();
    expect(controller.pasteText(`${CLIP_PREFIX}{not json`)).toBe(false);
    expect(controller.pasteText(`${CLIP_PREFIX}{"shapes":[]}`)).toBe(false);
    expect(Object.keys(docs.store.getState().shapes)).toHaveLength(0);
  });

  it('duplicate copies the selection at +24 px without touching the clipboard', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.select(['a']);
    controller.duplicate();
    expect(read(doc, selection(controller)[0] as string)).toMatchObject({ x: 24, y: 24 });
    expect(controller.lastCopied()).toBeNull();
  });

  it('setZ, setStyle and toggleLock act on the selection', () => {
    const { doc, docs, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b'));
    controller.select(['a']);
    controller.setZ('front');
    expect(docs.store.getState().order).toEqual(['b', 'a']);
    controller.setStyle({ fill: '#3B3BF5' });
    expect(read(doc, 'a')?.style.fill).toBe('#3B3BF5');
    controller.toggleLock();
    expect(read(doc, 'a')?.locked).toBe(true);
    controller.setStyle({ fill: '#FFFFFF' });
    expect(read(doc, 'a')?.style.fill).toBe('#3B3BF5');
    controller.toggleLock();
    expect(read(doc, 'a')?.locked).toBeUndefined();
  });

  it('setHead and setRouting change selected connectors', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b', { x: 400 }));
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k',
          from: { shapeId: 'a', anchor: 'auto' },
          to: { shapeId: 'b', anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u1',
        },
      },
      LOCAL_ORIGIN,
    );
    controller.select(['k']);
    controller.setHead('none');
    controller.setRouting('elbow');
    const k = getRoots(doc).connectors.get('k');
    expect(k?.get('head')).toBe('none');
    expect(k?.get('routing')).toBe('elbow');
  });

  it('selectAll selects every shape and connector on the page', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b'));
    controller.selectAll();
    expect(selection(controller)).toEqual(['a', 'b']);
  });

  it('openMenu selects an unselected hit, keeps a selection that contains it, clears on empty canvas', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    add(doc, sticky('b'));
    const at = { screen: { x: 1, y: 2 }, world: { x: 3, y: 4 }, connectorId: null };
    controller.openMenu({ ...at, hitId: 'a' });
    expect(selection(controller)).toEqual(['a']);
    expect(controller.ui.getState().menu).toEqual({
      screen: at.screen,
      world: at.world,
      hitId: 'a',
    });
    controller.select(['a', 'b']);
    controller.openMenu({ ...at, hitId: 'b' });
    expect(selection(controller)).toEqual(['a', 'b']);
    controller.openMenu({ ...at, hitId: null });
    expect(selection(controller)).toEqual([]);
    controller.closeMenu();
    expect(controller.ui.getState().menu).toBeNull();
  });

  it('createAt makes a sticky (editing) or a centred rectangle at the point', () => {
    const { doc, controller } = setup();
    controller.createAt('sticky', { x: 100, y: 100 });
    const s = selection(controller)[0] as string;
    expect(read(doc, s)).toMatchObject({ type: 'sticky', x: 10, y: 30 });
    expect(controller.ui.getState().editingId).toBe(s);
    controller.stopEditing();
    controller.createAt('rect', { x: 100, y: 100 });
    expect(read(doc, selection(controller)[0] as string)).toMatchObject({
      type: 'rect',
      x: 20,
      y: 52,
    });
    expect(controller.ui.getState().tool.tool).toBe('select');
  });

  it('commentAt opens the composer anchored to the shape under the point', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a', { x: 10, y: 10 }));
    controller.commentAt({ x: 30, y: 40 }, 'a');
    expect(controller.ui.getState().composer).toEqual({
      anchor: { shapeId: 'a', dx: 20, dy: 30 },
      at: { x: 30, y: 40 },
    });
  });

  it('zoomToFit fits the page content into the viewport', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a', { x: 1000, y: 1000 }));
    controller.setViewportSize(800, 600);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    controller.zoomToFit();
    expect(controller.ui.getState().camera).not.toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('closes the text editor when the edited shape becomes locked', () => {
    const { doc, controller } = setup();
    add(doc, sticky('a'));
    controller.dispatch({
      type: 'doubleClick',
      p: { world: { x: 5, y: 5 }, shift: false, hitId: 'a' },
    });
    expect(controller.ui.getState().editingId).toBe('a');
    applyCommand(doc, { type: 'SetLocked', ids: ['a'], locked: true }, 'remote');
    expect(controller.ui.getState().editingId).toBeNull();
  });

  it('help, menu and synced flags', () => {
    const { controller } = setup();
    expect(controller.ui.getState().synced).toBe(false);
    controller.markSynced();
    expect(controller.ui.getState().synced).toBe(true);
    controller.setHelp(true);
    expect(controller.ui.getState().help).toBe(true);
  });

  it('refuses a paste or duplicate whose update would be too large for the sync server', () => {
    const doc = new Y.Doc();
    const docs = createDocStore(doc);
    const activity = createActivityStore(doc);
    const notify = vi.fn();
    let n = 0;
    const controller = createBoardController({
      doc,
      docStore: docs.store,
      setPage: docs.setPage,
      activity: activity.store,
      user,
      newId: () => `id${++n}`,
      now: () => 1000,
      notify,
    });
    const long = 'y'.repeat(400);
    const ids = Array.from({ length: 500 }, (_, i) => `s${i}`);
    doc.transact(() => {
      for (const [i, id] of ids.entries()) add(doc, sticky(id, { x: i * 10, text: long }));
    }, LOCAL_ORIGIN);
    controller.select(ids);
    const text = controller.copySelection() as string;
    expect(controller.pasteText(text)).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('Too much to paste at once');
    expect(Object.keys(docs.store.getState().shapes)).toHaveLength(500);
    expect(selection(controller)).toEqual(ids);
    notify.mockClear();
    controller.duplicate();
    expect(notify).toHaveBeenLastCalledWith('Too much to paste at once');
    expect(Object.keys(docs.store.getState().shapes)).toHaveLength(500);
    expect(selection(controller)).toEqual(ids);
  });

  it('notifies after an undo or redo that did something', () => {
    const doc = new Y.Doc();
    const docs = createDocStore(doc);
    const activity = createActivityStore(doc);
    const notify = vi.fn();
    const controller = createBoardController({
      doc,
      docStore: docs.store,
      setPage: docs.setPage,
      activity: activity.store,
      user,
      notify,
    });
    controller.undo();
    expect(notify).not.toHaveBeenCalled();
    controller.createAt('rect', { x: 0, y: 0 });
    controller.undo();
    expect(notify).toHaveBeenLastCalledWith('Undone');
    controller.redo();
    expect(notify).toHaveBeenLastCalledWith('Redone');
  });

  it('notifies when a remote delete moves the user, not when they deleted the page', () => {
    const doc = new Y.Doc();
    const docs = createDocStore(doc);
    const activity = createActivityStore(doc);
    const notify = vi.fn();
    let n = 0;
    const controller = createBoardController({
      doc,
      docStore: docs.store,
      setPage: docs.setPage,
      activity: activity.store,
      user,
      newId: () => `p${++n}`,
      notify,
    });
    const a = controller.createPage('board');
    controller.setPage(a);
    controller.deletePage(a);
    expect(notify).not.toHaveBeenCalledWith('The page you were on was deleted');
    const b = controller.createPage('board');
    controller.setPage(b);
    applyCommand(doc, { type: 'DeletePage', id: b }, 'remote');
    expect(notify).toHaveBeenCalledWith('The page you were on was deleted');
  });

  it('never repeats an existing page title', () => {
    const { docs, controller } = setup();
    const two = controller.createPage('board');
    controller.createPage('board');
    controller.deletePage(two);
    controller.createPage('board');
    expect(docs.store.getState().pages.map((p) => p.title)).toEqual([
      'Board',
      'Board 3',
      'Board 4',
    ]);
  });
});
