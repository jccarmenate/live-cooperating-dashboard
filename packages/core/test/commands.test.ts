import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  readShape,
} from '../src';

function sticky(id: string, extra: Partial<NewShape> = {}): NewShape {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 180,
    h: 140,
    style: DEFAULT_STYLE.sticky,
    text: 'hi',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 1,
    ...extra,
  };
}

function read(doc: Y.Doc, id: string) {
  const m = getRoots(doc).shapes.get(id);
  return m ? readShape(id, m) : null;
}

describe('applyCommand', () => {
  it('CreateShape stores fields, Y.Text and a z key', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    const s = read(doc, 's1');
    expect(s?.text).toBe('hi');
    expect(s?.z).toBe('a0');
    expect(getRoots(doc).shapes.get('s1')?.get('text')).toBeInstanceOf(Y.Text);
  });

  it('CreateShape stacks new shapes on top', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s2') });
    const z1 = read(doc, 's1')?.z ?? '';
    const z2 = read(doc, 's2')?.z ?? '';
    expect(z2 > z1).toBe(true);
  });

  it('CreateShape is a no-op for an existing id', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { x: 1 }) });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { x: 99 }) });
    expect(read(doc, 's1')?.x).toBe(1);
  });

  it('MoveShapes updates positions and ignores missing ids', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, {
      type: 'MoveShapes',
      moves: [
        { id: 's1', x: 10, y: 20 },
        { id: 'gone', x: 1, y: 1 },
      ],
    });
    expect(read(doc, 's1')).toMatchObject({ x: 10, y: 20 });
  });

  it('SetText inserts, deletes and clamps', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { text: 'hello' }) });
    applyCommand(doc, { type: 'SetText', id: 's1', index: 5, deleteCount: 0, insert: '!' });
    expect(read(doc, 's1')?.text).toBe('hello!');
    applyCommand(doc, { type: 'SetText', id: 's1', index: 0, deleteCount: 1, insert: 'J' });
    expect(read(doc, 's1')?.text).toBe('Jello!');
    applyCommand(doc, { type: 'SetText', id: 's1', index: 99, deleteCount: 99, insert: '?' });
    expect(read(doc, 's1')?.text).toBe('Jello!?');
  });

  it('DeleteShapes removes shapes and attached connectors', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('a') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('b') });
    const { connectors } = getRoots(doc);
    const c1 = new Y.Map<unknown>();
    connectors.set('c1', c1);
    c1.set('from', { shapeId: 'a', anchor: 'auto' });
    c1.set('to', { shapeId: 'b', anchor: 'auto' });
    const c2 = new Y.Map<unknown>();
    connectors.set('c2', c2);
    c2.set('from', { x: 0, y: 0 });
    c2.set('to', { shapeId: 'b', anchor: 'auto' });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['a'] });
    expect(getRoots(doc).shapes.has('a')).toBe(false);
    expect(connectors.has('c1')).toBe(false);
    expect(connectors.has('c2')).toBe(true);
  });

  it('ResizeShapes sets geometry and ignores missing ids', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, {
      type: 'ResizeShapes',
      rects: [
        { id: 's1', x: 5, y: 6, w: 300, h: 200 },
        { id: 'gone', x: 0, y: 0, w: 1, h: 1 },
      ],
    });
    expect(read(doc, 's1')).toMatchObject({ x: 5, y: 6, w: 300, h: 200 });
    expect(getRoots(doc).shapes.has('gone')).toBe(false);
  });

  it('passes the origin to the transaction', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr) => origins.push(tr.origin));
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') }, LOCAL_ORIGIN);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});
