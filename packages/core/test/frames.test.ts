import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  COLUMN_HEADER_H,
  childrenOf,
  columnCounts,
  DEFAULT_STYLE,
  dropTarget,
  FRAME_TITLE_H,
  frameColumns,
  getRoots,
  normalizeShapes,
  readShape,
  rectContains,
  type Shape,
} from '../src';

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    style: DEFAULT_STYLE.sticky,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
    ...partial,
  };
}

const columns = [
  { id: 'c1', title: 'Went well' },
  { id: 'c2', title: 'To improve' },
  { id: 'c3', title: 'Actions' },
];
const frame = shape('f1', { type: 'frame', x: 0, y: 0, w: 600, h: 400, z: 'a0', columns });

describe('frame geometry', () => {
  it('constants', () => {
    expect(FRAME_TITLE_H).toBe(36);
    expect(COLUMN_HEADER_H).toBe(28);
  });

  it('frameColumns splits the body under the title band equally', () => {
    expect(frameColumns(frame)).toEqual([
      { id: 'c1', title: 'Went well', x: 0, y: 36, w: 200, h: 364 },
      { id: 'c2', title: 'To improve', x: 200, y: 36, w: 200, h: 364 },
      { id: 'c3', title: 'Actions', x: 400, y: 36, w: 200, h: 364 },
    ]);
    expect(frameColumns({ ...frame, columns: undefined })).toEqual([]);
  });

  it('dropTarget finds the topmost frame and its column', () => {
    const upper = shape('f2', {
      type: 'frame',
      x: 100,
      y: 100,
      w: 300,
      h: 300,
      z: 'a5',
      columns: [{ id: 'x', title: 'X' }],
    });
    const shapes = { f1: frame, f2: upper };
    expect(dropTarget(shapes, { x: 50, y: 100 }, new Set())).toEqual({
      parentId: 'f1',
      columnId: 'c1',
    });
    expect(dropTarget(shapes, { x: 200, y: 200 }, new Set())).toEqual({
      parentId: 'f2',
      columnId: 'x',
    });
    expect(dropTarget(shapes, { x: 200, y: 200 }, new Set(['f2']))).toEqual({
      parentId: 'f1',
      columnId: 'c2',
    });
    expect(dropTarget(shapes, { x: 50, y: 10 }, new Set())).toEqual({
      parentId: 'f1',
      columnId: null,
    });
    expect(dropTarget(shapes, { x: 900, y: 900 }, new Set())).toBeNull();
  });

  it('columnCounts and childrenOf are derived from parentId/columnId', () => {
    const shapes = {
      f1: frame,
      a: shape('a', { parentId: 'f1', columnId: 'c1' }),
      b: shape('b', { parentId: 'f1', columnId: 'c1' }),
      c: shape('c', { parentId: 'f1', columnId: 'c3' }),
      d: shape('d', { parentId: 'f1' }),
      e: shape('e', {}),
    };
    expect(columnCounts(shapes, 'f1')).toEqual({ c1: 2, c3: 1 });
    expect(childrenOf(shapes, 'f1')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rectContains requires full containment', () => {
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 6, h: 1 })).toBe(false);
  });
});

describe('frame commands and snapshots', () => {
  const newFrame = {
    id: 'f1',
    type: 'frame' as const,
    x: 0,
    y: 0,
    w: 600,
    h: 400,
    style: DEFAULT_STYLE.frame,
    text: 'Sprint 14 retro',
    columns,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
  };
  const read = (doc: Y.Doc, id: string) => {
    const m = getRoots(doc).shapes.get(id);
    return m ? readShape(id, m) : null;
  };

  it('CreateShape stores frame columns as a Y.Array and the title as Y.Text', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: newFrame });
    const m = getRoots(doc).shapes.get('f1');
    expect(m?.get('columns')).toBeInstanceOf(Y.Array);
    expect(m?.get('text')).toBeInstanceOf(Y.Text);
    expect(read(doc, 'f1')).toMatchObject({ type: 'frame', text: 'Sprint 14 retro', columns });
  });

  it('RenameColumn renames in place; Reparent sets and clears parents', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: newFrame });
    applyCommand(doc, { type: 'RenameColumn', frameId: 'f1', columnId: 'c2', title: 'Blockers' });
    expect(read(doc, 'f1')?.columns?.map((c) => c.title)).toEqual([
      'Went well',
      'Blockers',
      'Actions',
    ]);
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        ...newFrame,
        id: 's1',
        type: 'sticky',
        style: DEFAULT_STYLE.sticky,
        columns: undefined,
      },
    });
    applyCommand(doc, { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c3' }] });
    expect(read(doc, 's1')).toMatchObject({ parentId: 'f1', columnId: 'c3' });
    applyCommand(doc, { type: 'Reparent', moves: [{ id: 's1', parentId: null, columnId: null }] });
    expect(read(doc, 's1')?.parentId).toBeUndefined();
    expect(read(doc, 's1')?.columnId).toBeUndefined();
  });

  it('concurrent renames of one column converge without duplicate columns', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyCommand(a, { type: 'CreateShape', shape: newFrame });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyCommand(a, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Wins' });
    applyCommand(b, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Good' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ca = read(a, 'f1')?.columns ?? [];
    expect(ca).toHaveLength(3);
    expect(read(b, 'f1')?.columns).toEqual(ca);

    applyCommand(a, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Wins!' });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const rawA = getRoots(a).shapes.get('f1')?.get('columns') as Y.Array<unknown>;
    const rawB = getRoots(b).shapes.get('f1')?.get('columns') as Y.Array<unknown>;
    expect(rawA.length).toBe(3);
    expect(rawB.length).toBe(3);
    const cb = read(b, 'f1')?.columns ?? [];
    expect(read(a, 'f1')?.columns).toEqual(cb);
    expect(cb[0]).toEqual({ id: 'c1', title: 'Wins!' });
  });
});

describe('frame normalization', () => {
  it('frames never nest and unknown columns are dropped', () => {
    const raw = {
      f1: frame,
      f2: shape('f2', { type: 'frame', parentId: 'f1', columnId: 'c1' }),
      ok: shape('ok', { parentId: 'f1', columnId: 'c2' }),
      stray: shape('stray', { parentId: 'f1', columnId: 'nope' }),
    };
    const { shapes } = normalizeShapes(raw);
    expect(shapes.f2?.parentId).toBeUndefined();
    expect(shapes.ok).toBe(raw.ok);
    expect(shapes.stray?.parentId).toBe('f1');
    expect(shapes.stray?.columnId).toBeUndefined();
  });
});
