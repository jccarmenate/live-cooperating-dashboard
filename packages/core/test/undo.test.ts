import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  createUndo,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  readShape,
} from '../src';

const shape = (id: string, type: 'rect' | 'sticky' = 'rect'): NewShape => ({
  id,
  type,
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  style: DEFAULT_STYLE[type],
  text: '',
  createdBy: 'u',
  authorName: 'U',
  createdAt: 0,
});

function read(doc: Y.Doc, id: string) {
  const m = getRoots(doc).shapes.get(id);
  return m ? readShape(id, m) : null;
}

describe('createUndo', () => {
  it('undoes and redoes local commands', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(read(doc, 'a')).toBeNull();
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(read(doc, 'a')?.w).toBe(100);
  });

  it('never undoes changes from other origins', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    applyCommand(doc, { type: 'CreateShape', shape: shape('remote') }, 'remote');
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(read(doc, 'remote')).not.toBeNull();
  });

  it('groups everything between stopCapturing calls into one step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc, { captureTimeout: 60_000 });
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    undo.stopCapturing();
    for (const x of [10, 20, 30]) {
      applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 'a', x, y: 0 }] }, LOCAL_ORIGIN);
    }
    undo.stopCapturing();
    applyCommand(
      doc,
      { type: 'ResizeShapes', rects: [{ id: 'a', x: 30, y: 0, w: 300, h: 50 }] },
      LOCAL_ORIGIN,
    );
    undo.undo();
    expect(read(doc, 'a')).toMatchObject({ x: 30, w: 100 });
    undo.undo();
    expect(read(doc, 'a')).toMatchObject({ x: 0, w: 100 });
    undo.undo();
    expect(read(doc, 'a')).toBeNull();
  });

  it('keeps a remote text edit when undoing a local move of the same shape', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc, { captureTimeout: 60_000 });
    applyCommand(doc, { type: 'CreateShape', shape: shape('s', 'sticky') }, LOCAL_ORIGIN);
    undo.stopCapturing();
    applyCommand(
      doc,
      { type: 'SetText', id: 's', index: 0, deleteCount: 0, insert: 'hi' },
      'remote',
    );
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 's', x: 50, y: 0 }] }, LOCAL_ORIGIN);
    undo.undo();
    expect(read(doc, 's')).toMatchObject({ x: 0, text: 'hi' });
  });

  it('notifies listeners until unsubscribed', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    let calls = 0;
    const off = undo.onChange(() => {
      calls++;
    });
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    undo.undo();
    expect(calls).toBe(before);
    undo.destroy();
  });
});
