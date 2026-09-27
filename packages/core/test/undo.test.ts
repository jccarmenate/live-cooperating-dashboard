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
  SESSION_ORIGIN,
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

  it('undoing a shape delete restores the shape and a connector attached to it', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    applyCommand(doc, { type: 'CreateShape', shape: shape('a') }, LOCAL_ORIGIN);
    applyCommand(doc, { type: 'CreateShape', shape: shape('b') }, LOCAL_ORIGIN);
    applyCommand(
      doc,
      {
        type: 'Connect',
        connector: {
          id: 'k1',
          from: { shapeId: 'a', anchor: 'auto' },
          to: { shapeId: 'b', anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u',
        },
      },
      LOCAL_ORIGIN,
    );
    undo.stopCapturing();
    applyCommand(doc, { type: 'DeleteShapes', ids: ['a'] }, LOCAL_ORIGIN);
    expect(read(doc, 'a')).toBeNull();
    expect(getRoots(doc).connectors.has('k1')).toBe(false);
    expect(undo.undo()).toBe(true);
    expect(read(doc, 'a')).not.toBeNull();
    expect(read(doc, 'b')).not.toBeNull();
    expect(getRoots(doc).connectors.has('k1')).toBe(true);
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

  it('never undoes votes or comments (SESSION origin)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc, { captureTimeout: 0 });
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    applyCommand(
      doc,
      {
        type: 'AddComment',
        id: 'c1',
        anchor: { x: 0, y: 0 },
        createdBy: 'u1',
        createdAt: 0,
        entry: { id: 'e1', authorId: 'u1', author: 'A', body: 'hi', ts: 0 },
      },
      SESSION_ORIGIN,
    );
    expect(undo.canUndo()).toBe(false);
    expect(getRoots(doc).votes.size).toBe(1);
    expect(getRoots(doc).comments.size).toBe(1);
  });
});
