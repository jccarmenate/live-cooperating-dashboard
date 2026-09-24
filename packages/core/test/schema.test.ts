import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DEFAULT_STYLE,
  getRoots,
  initMeta,
  normalizeShapes,
  readMeta,
  readShape,
  type Shape,
} from '../src';

function shape(partial: Partial<Shape> & Pick<Shape, 'id'>): Shape {
  return {
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    style: DEFAULT_STYLE.rect,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
    ...partial,
  };
}

describe('readShape', () => {
  it('returns null for unknown types', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).shapes.set('s1', m);
    m.set('type', 'hexagon');
    expect(readShape('s1', m)).toBeNull();
  });

  it('reads fields, text and falls back to default style', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).shapes.set('s1', m);
    doc.transact(() => {
      m.set('type', 'sticky');
      m.set('x', 5);
      m.set('y', 6);
      m.set('w', 180);
      m.set('h', 140);
      m.set('z', 'a1');
      m.set('text', new Y.Text('hello'));
      m.set('createdBy', 'u1');
      m.set('authorName', 'Brisk Otter');
      m.set('createdAt', 42);
    });
    expect(readShape('s1', m)).toEqual({
      id: 's1',
      type: 'sticky',
      x: 5,
      y: 6,
      w: 180,
      h: 140,
      z: 'a1',
      style: DEFAULT_STYLE.sticky,
      text: 'hello',
      createdBy: 'u1',
      authorName: 'Brisk Otter',
      createdAt: 42,
    });
  });

  it('replaces non-finite numbers with 0', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).shapes.set('s1', m);
    m.set('type', 'rect');
    m.set('x', 'nope');
    expect(readShape('s1', m)?.x).toBe(0);
  });
});

describe('meta', () => {
  it('readMeta has defaults', () => {
    const doc = new Y.Doc();
    expect(readMeta(getRoots(doc).meta)).toEqual({
      schemaVersion: 1,
      title: 'Untitled board',
      breadcrumb: [],
    });
  });

  it('initMeta only initializes once', () => {
    const doc = new Y.Doc();
    expect(initMeta(doc, { title: 'Sprint 14 Retro', breadcrumb: ['Q3 Planning'] })).toBe(true);
    expect(initMeta(doc, { title: 'Other', breadcrumb: [] })).toBe(false);
    expect(readMeta(getRoots(doc).meta)).toEqual({
      schemaVersion: 1,
      title: 'Sprint 14 Retro',
      breadcrumb: ['Q3 Planning'],
    });
  });
});

describe('normalizeShapes', () => {
  it('orders by z, then id', () => {
    const raw = {
      b: shape({ id: 'b', z: 'a1' }),
      a: shape({ id: 'a', z: 'a1' }),
      c: shape({ id: 'c', z: 'a0' }),
    };
    expect(normalizeShapes(raw).order).toEqual(['c', 'a', 'b']);
  });

  it('keeps object identity for untouched shapes', () => {
    const a = shape({ id: 'a' });
    expect(normalizeShapes({ a }).shapes.a).toBe(a);
  });

  it('treats missing or non-frame parents as root', () => {
    const raw = {
      f: shape({ id: 'f', type: 'frame' }),
      ok: shape({ id: 'ok', parentId: 'f', columnId: 'c1' }),
      orphan: shape({ id: 'orphan', parentId: 'gone', columnId: 'c1' }),
      bad: shape({ id: 'bad', parentId: 'ok' }),
    };
    const { shapes } = normalizeShapes(raw);
    expect(shapes.ok?.parentId).toBe('f');
    expect(shapes.orphan?.parentId).toBeUndefined();
    expect(shapes.orphan?.columnId).toBeUndefined();
    expect(shapes.bad?.parentId).toBeUndefined();
  });
});
