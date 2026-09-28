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
});
