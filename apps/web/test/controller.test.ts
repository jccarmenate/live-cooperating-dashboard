import { applyCommand, DEFAULT_STYLE, getRoots, type PointerInfo } from '@relay/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createDocStore } from '../src/store/docStore';

const user = { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' };
const at = (x: number, y: number, hitId: string | null = null): PointerInfo => ({
  world: { x, y },
  shift: false,
  hitId,
});

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  let n = 0;
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    user,
    newId: () => `s${++n}`,
    now: () => 1000,
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

  function addRect(doc: Y.Doc, id = 'r1') {
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id,
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

  it('ignores undo while a gesture is in progress', () => {
    const { doc, controller } = setup();
    addRect(doc);
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    controller.undo();
    expect(controller.ui.getState().tool.mode).toBe('dragging');
  });
});
