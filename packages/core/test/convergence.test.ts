declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  createUndo,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  normalizeShapes,
  readShape,
  type Shape,
  type Undo,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 200);
const REMOTE = 'remote';
const N = 3;

interface Net {
  docs: Y.Doc[];
  /** queues[from][to] */
  queues: Uint8Array[][][];
  undos: Undo[];
}

function makeNet(): Net {
  const docs = Array.from({ length: N }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = i + 1;
    getRoots(d);
    return d;
  });
  const queues = docs.map(() => docs.map(() => [] as Uint8Array[]));
  docs.forEach((d, from) => {
    d.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      for (let to = 0; to < N; to++) if (to !== from) queues[from]?.[to]?.push(update);
    });
  });
  const undos = docs.map((d) => createUndo(d, { captureTimeout: 0 }));
  return { docs, queues, undos };
}

function deliver(net: Net, from: number, to: number, count: number) {
  const q = net.queues[from]?.[to];
  const doc = net.docs[to];
  if (!q || !doc) return;
  for (let i = 0; i < count && q.length > 0; i++) {
    const u = q.shift();
    if (u) Y.applyUpdate(doc, u, REMOTE);
  }
}

function flushAll(net: Net) {
  for (let from = 0; from < N; from++)
    for (let to = 0; to < N; to++) deliver(net, from, to, Number.POSITIVE_INFINITY);
}

type Step =
  | { kind: 'create'; r: number; type: 'rect' | 'sticky' | 'text'; x: number; y: number }
  | { kind: 'move'; r: number; pick: number; x: number; y: number }
  | { kind: 'resize'; r: number; pick: number; w: number; h: number }
  | { kind: 'text'; r: number; pick: number; index: number; del: number; insert: string }
  | { kind: 'delete'; r: number; pick: number }
  | { kind: 'undo'; r: number }
  | { kind: 'redo'; r: number }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const coord = fc.integer({ min: -1000, max: 1000 });

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('create' as const),
    r: replica,
    type: fc.constantFrom('rect' as const, 'sticky' as const, 'text' as const),
    x: coord,
    y: coord,
  }),
  fc.record({ kind: fc.constant('move' as const), r: replica, pick: fc.nat(), x: coord, y: coord }),
  fc.record({
    kind: fc.constant('resize' as const),
    r: replica,
    pick: fc.nat(),
    w: fc.integer({ min: 8, max: 400 }),
    h: fc.integer({ min: 8, max: 400 }),
  }),
  fc.record({
    kind: fc.constant('text' as const),
    r: replica,
    pick: fc.nat(),
    index: fc.nat(20),
    del: fc.nat(3),
    insert: fc.string({ maxLength: 4 }),
  }),
  fc.record({ kind: fc.constant('delete' as const), r: replica, pick: fc.nat() }),
  fc.record({ kind: fc.constant('undo' as const), r: replica }),
  fc.record({ kind: fc.constant('redo' as const), r: replica }),
  fc.record({
    kind: fc.constant('deliver' as const),
    from: replica,
    to: replica,
    count: fc.integer({ min: 1, max: 3 }),
  }),
);

function pickId(doc: Y.Doc, pick: number): string | undefined {
  const ids = [...getRoots(doc).shapes.keys()].sort();
  return ids.length ? ids[pick % ids.length] : undefined;
}

function run(net: Net, steps: Step[]) {
  let n = 0;
  for (const s of steps) {
    if (s.kind === 'deliver') {
      if (s.from !== s.to) deliver(net, s.from, s.to, s.count);
      continue;
    }
    if (s.kind === 'undo' || s.kind === 'redo') {
      const undo = net.undos[s.r];
      if (s.kind === 'undo') undo?.undo();
      else undo?.redo();
      continue;
    }
    const doc = net.docs[s.r];
    if (!doc) continue;
    if (s.kind === 'create') {
      applyCommand(
        doc,
        {
          type: 'CreateShape',
          shape: {
            id: `r${s.r}-${n++}`,
            type: s.type,
            x: s.x,
            y: s.y,
            w: 100,
            h: 80,
            style: DEFAULT_STYLE[s.type],
            text: '',
            createdBy: `u${s.r}`,
            authorName: `User ${s.r}`,
            createdAt: 0,
          },
        },
        LOCAL_ORIGIN,
      );
      continue;
    }
    const id = pickId(doc, s.pick);
    if (!id) continue;
    if (s.kind === 'move')
      applyCommand(doc, { type: 'MoveShapes', moves: [{ id, x: s.x, y: s.y }] }, LOCAL_ORIGIN);
    if (s.kind === 'resize')
      applyCommand(
        doc,
        { type: 'ResizeShapes', rects: [{ id, x: s.w, y: s.h, w: s.w, h: s.h }] },
        LOCAL_ORIGIN,
      );
    if (s.kind === 'text')
      applyCommand(
        doc,
        {
          type: 'SetText',
          id,
          index: s.index,
          deleteCount: s.del,
          insert: s.insert,
        },
        LOCAL_ORIGIN,
      );
    if (s.kind === 'delete') applyCommand(doc, { type: 'DeleteShapes', ids: [id] }, LOCAL_ORIGIN);
  }
}

function snapshot(doc: Y.Doc) {
  const raw: Record<string, Shape> = {};
  for (const [id, m] of getRoots(doc).shapes.entries()) {
    const s = readShape(id, m);
    if (s) raw[id] = s;
  }
  return normalizeShapes(raw);
}

describe('convergence', () => {
  it('replicas converge under arbitrary concurrent commands and delivery order', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 60 }), (steps) => {
        const net = makeNet();
        run(net, steps);
        flushAll(net);
        const [first, ...rest] = net.docs.map((d) => getRoots(d).shapes.toJSON());
        for (const json of rest) expect(json).toEqual(first);
        const snaps = net.docs.map(snapshot);
        for (const [i, snap] of snaps.entries()) {
          expect(snap.order.length).toBe(getRoots(net.docs[i] as Y.Doc).shapes.size);
          expect(snap.order).toEqual(snaps[0]?.order);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('a concurrent move and delete converge to deleted', () => {
    const net = makeNet();
    run(net, [{ kind: 'create', r: 0, type: 'rect', x: 0, y: 0 }]);
    flushAll(net);
    const [a, b] = net.docs as [Y.Doc, Y.Doc, Y.Doc];
    applyCommand(a, { type: 'MoveShapes', moves: [{ id: 'r0-0', x: 50, y: 50 }] });
    applyCommand(b, { type: 'DeleteShapes', ids: ['r0-0'] });
    flushAll(net);
    for (const d of net.docs) expect(getRoots(d).shapes.has('r0-0')).toBe(false);
  });

  it('concurrent inserts at the same index keep both texts', () => {
    const net = makeNet();
    run(net, [{ kind: 'create', r: 0, type: 'sticky', x: 0, y: 0 }]);
    flushAll(net);
    const [a, b] = net.docs as [Y.Doc, Y.Doc, Y.Doc];
    applyCommand(a, { type: 'SetText', id: 'r0-0', index: 0, deleteCount: 0, insert: 'AA' });
    applyCommand(b, { type: 'SetText', id: 'r0-0', index: 0, deleteCount: 0, insert: 'BB' });
    flushAll(net);
    const text = snapshot(a).shapes['r0-0']?.text ?? '';
    expect(text).toHaveLength(4);
    expect(text).toContain('AA');
    expect(text).toContain('BB');
    expect(snapshot(b).shapes['r0-0']?.text).toBe(text);
  });
});
