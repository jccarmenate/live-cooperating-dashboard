import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  readConnector,
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

  it('Connect stores a connector once, above existing ones', () => {
    const doc = new Y.Doc();
    const base = {
      from: { shapeId: 'a', anchor: 'auto' as const },
      to: { x: 10, y: 20 },
      routing: 'straight' as const,
      head: 'arrow' as const,
      createdBy: 'u1',
    };
    applyCommand(doc, { type: 'Connect', connector: { id: 'k1', ...base } });
    applyCommand(doc, { type: 'Connect', connector: { id: 'k2', ...base } });
    applyCommand(doc, { type: 'Connect', connector: { id: 'k1', ...base, routing: 'elbow' } });
    const { connectors } = getRoots(doc);
    const k1 = readConnector('k1', connectors.get('k1') as Y.Map<unknown>);
    const k2 = readConnector('k2', connectors.get('k2') as Y.Map<unknown>);
    expect(k1).toMatchObject({
      from: { shapeId: 'a', anchor: 'auto' },
      to: { x: 10, y: 20 },
      routing: 'straight',
      head: 'arrow',
    });
    expect((k2?.z ?? '') > (k1?.z ?? '')).toBe(true);
  });

  it('SetRouting switches a connector between straight and elbow', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'k1',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    applyCommand(doc, { type: 'SetRouting', id: 'k1', routing: 'elbow' });
    applyCommand(doc, { type: 'SetRouting', id: 'gone', routing: 'elbow' });
    expect(getRoots(doc).connectors.get('k1')?.get('routing')).toBe('elbow');
    expect(getRoots(doc).connectors.has('gone')).toBe(false);
  });

  it('DeleteShapes also deletes listed connectors', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'k1',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['k1'] });
    expect(getRoots(doc).connectors.has('k1')).toBe(false);
  });

  it('Connect is a no-op when the id is already used by a shape', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('dup') });
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'dup',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    expect(getRoots(doc).connectors.has('dup')).toBe(false);
    expect(read(doc, 'dup')).not.toBeNull();
  });

  it('CreateShape is a no-op when the id is already used by a connector', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id: 'dup',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('dup') });
    expect(read(doc, 'dup')).toBeNull();
    expect(getRoots(doc).connectors.has('dup')).toBe(true);
  });
});

describe('canvas UX commands', () => {
  const frame = (id: string): NewShape => ({
    id,
    type: 'frame',
    x: 0,
    y: 0,
    w: 720,
    h: 440,
    style: DEFAULT_STYLE.frame,
    text: '',
    columns: [{ id: 'c1', title: 'A' }],
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 1,
  });
  const z = (doc: Y.Doc, id: string) => read(doc, id)?.z ?? '';
  const connect = (doc: Y.Doc, id: string, a: string, b: string) =>
    applyCommand(doc, {
      type: 'Connect',
      connector: {
        id,
        from: { shapeId: a, anchor: 'auto' },
        to: { shapeId: b, anchor: 'auto' },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    });
  const connectorZ = (doc: Y.Doc, id: string) => {
    const m = getRoots(doc).connectors.get(id);
    return (m ? readConnector(id, m)?.z : '') ?? '';
  };

  it('SetZ front puts the ids above the rest of their layer, keeping their order', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2', 's3'])
      applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    applyCommand(doc, { type: 'SetZ', ids: ['s2', 's1'], where: 'front' });
    expect(z(doc, 's3') < z(doc, 's1')).toBe(true);
    expect(z(doc, 's1') < z(doc, 's2')).toBe(true);
  });

  it('SetZ back puts the ids below the rest of their layer', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2', 's3'])
      applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    applyCommand(doc, { type: 'SetZ', ids: ['s3'], where: 'back' });
    expect(z(doc, 's3') < z(doc, 's1')).toBe(true);
  });

  it('SetZ restacks frames only among frames', () => {
    const doc = new Y.Doc();
    // z keys: s1 a0, f1 a1, f2 a2, s2 a3.
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: frame('f1') });
    applyCommand(doc, { type: 'CreateShape', shape: frame('f2') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s2') });
    applyCommand(doc, { type: 'SetZ', ids: ['f1'], where: 'front' });
    expect(z(doc, 'f1') > z(doc, 'f2')).toBe(true);
    // Only frames were compared: the frame did not have to climb above the top sticky.
    expect(z(doc, 'f1') <= z(doc, 's2')).toBe(true);
  });

  it('SetZ restacks connectors among connectors', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    connect(doc, 'k1', 's1', 's2');
    connect(doc, 'k2', 's2', 's1');
    applyCommand(doc, { type: 'SetZ', ids: ['k1'], where: 'front' });
    expect(connectorZ(doc, 'k1') > connectorZ(doc, 'k2')).toBe(true);
  });

  it('SetStyle merges the patch into the stored style', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'SetStyle', ids: ['s1'], patch: { fill: '#3B3BF5', size: 'l' } });
    expect(read(doc, 's1')?.style).toEqual({
      fill: '#3B3BF5',
      stroke: DEFAULT_STYLE.sticky.stroke,
      font: 'sans',
      size: 'l',
    });
  });

  it('reads an unknown font as the default and an unknown size as absent', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    getRoots(doc)
      .shapes.get('s1')
      ?.set('style', { fill: '#fff', stroke: '#000', font: 'comic', size: 'xl' });
    const style = read(doc, 's1')?.style;
    expect(style?.font).toBe('sans');
    expect(style?.size).toBeUndefined();
  });

  it('SetLocked sets and clears the flag; only `true` reads as locked', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    expect(read(doc, 's1')?.locked).toBe(true);
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: false });
    expect(read(doc, 's1')?.locked).toBeUndefined();
    expect(getRoots(doc).shapes.get('s1')?.has('locked')).toBe(false);
    getRoots(doc).shapes.get('s1')?.set('locked', 'yes');
    expect(read(doc, 's1')?.locked).toBeUndefined();
  });

  it('a locked shape ignores move, resize, text, delete, restyle, reparent and column rename', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: frame('f1') });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1', 'f1'], locked: true });
    applyCommand(doc, { type: 'MoveShapes', moves: [{ id: 's1', x: 50, y: 50 }] });
    applyCommand(doc, { type: 'ResizeShapes', rects: [{ id: 's1', x: 0, y: 0, w: 10, h: 10 }] });
    applyCommand(doc, { type: 'SetText', id: 's1', index: 0, deleteCount: 2, insert: 'yo' });
    applyCommand(doc, { type: 'SetStyle', ids: ['s1'], patch: { fill: '#000000' } });
    applyCommand(doc, { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c1' }] });
    applyCommand(doc, { type: 'RenameColumn', frameId: 'f1', columnId: 'c1', title: 'Z' });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1', 'f1'] });
    const s = read(doc, 's1');
    expect(s).toMatchObject({ x: 0, y: 0, w: 180, h: 140, text: 'hi' });
    expect(s?.style.fill).toBe(DEFAULT_STYLE.sticky.fill);
    expect(s?.parentId).toBeUndefined();
    expect(read(doc, 'f1')?.columns).toEqual([{ id: 'c1', title: 'A' }]);
  });

  it('a mixed delete removes only the unlocked shapes', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1') });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s2') });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1', 's2'] });
    expect(read(doc, 's1')).not.toBeNull();
    expect(read(doc, 's2')).toBeNull();
  });

  it('SetZ still restacks a locked shape', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    applyCommand(doc, { type: 'SetZ', ids: ['s1'], where: 'front' });
    expect(z(doc, 's1') > z(doc, 's2')).toBe(true);
  });

  it('DeletePage still removes locked shapes on that page', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'CreatePage',
      page: { id: 'p2', type: 'board', title: 'Two', order: 'a1', createdBy: 'u1', createdAt: 1 },
    });
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { pageId: 'p2' }) });
    applyCommand(doc, { type: 'SetLocked', ids: ['s1'], locked: true });
    applyCommand(doc, { type: 'DeletePage', id: 'p2' });
    expect(read(doc, 's1')).toBeNull();
  });

  it('SetHead sets a connector head', () => {
    const doc = new Y.Doc();
    for (const id of ['s1', 's2']) applyCommand(doc, { type: 'CreateShape', shape: sticky(id) });
    connect(doc, 'k1', 's1', 's2');
    applyCommand(doc, { type: 'SetHead', id: 'k1', head: 'none' });
    const m = getRoots(doc).connectors.get('k1');
    expect(m ? readConnector('k1', m)?.head : null).toBe('none');
  });

  it('PasteItems creates everything above the existing items, in order, in one transaction', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('old') });
    let updates = 0;
    doc.on('update', () => updates++);
    applyCommand(
      doc,
      {
        type: 'PasteItems',
        shapes: [sticky('p1'), sticky('p2')],
        connectors: [
          {
            id: 'pk',
            from: { shapeId: 'p1', anchor: 'auto' },
            to: { shapeId: 'p2', anchor: 'auto' },
            routing: 'elbow',
            head: 'arrow',
            createdBy: 'u1',
          },
        ],
      },
      LOCAL_ORIGIN,
    );
    expect(updates).toBe(1);
    expect(z(doc, 'old') < z(doc, 'p1')).toBe(true);
    expect(z(doc, 'p1') < z(doc, 'p2')).toBe(true);
    expect(read(doc, 'p1')?.text).toBe('hi');
    expect(getRoots(doc).connectors.has('pk')).toBe(true);
  });

  it('PasteItems skips ids that already exist', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { text: 'original' }) });
    applyCommand(doc, {
      type: 'PasteItems',
      shapes: [sticky('s1', { text: 'pasted' })],
      connectors: [],
    });
    expect(read(doc, 's1')?.text).toBe('original');
  });
});
