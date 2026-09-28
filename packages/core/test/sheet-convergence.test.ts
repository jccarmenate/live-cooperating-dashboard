declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  getRoots,
  keysBetween,
  LOCAL_ORIGIN,
  readSheet,
  SESSION_ORIGIN,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 150);
const REMOTE = 'remote';
const N = 3;

type Step =
  | { kind: 'insertRow'; r: number; at: number }
  | { kind: 'deleteRow'; r: number; pick: number }
  | { kind: 'moveRow'; r: number; pick: number; at: number }
  | { kind: 'insertCol'; r: number; at: number }
  | { kind: 'deleteCol'; r: number; pick: number }
  | { kind: 'width'; r: number; pick: number; width: number }
  | { kind: 'set'; r: number; row: number; col: number; src: string; bold: boolean }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('insertRow' as const), r: replica, at: fc.nat(10) }),
  fc.record({ kind: fc.constant('deleteRow' as const), r: replica, pick: fc.nat() }),
  fc.record({ kind: fc.constant('moveRow' as const), r: replica, pick: fc.nat(), at: fc.nat(10) }),
  fc.record({ kind: fc.constant('insertCol' as const), r: replica, at: fc.nat(6) }),
  fc.record({ kind: fc.constant('deleteCol' as const), r: replica, pick: fc.nat() }),
  fc.record({
    kind: fc.constant('width' as const),
    r: replica,
    pick: fc.nat(),
    width: fc.integer({ min: 0, max: 900 }),
  }),
  {
    arbitrary: fc.record({
      kind: fc.constant('set' as const),
      r: replica,
      row: fc.nat(),
      col: fc.nat(),
      src: fc.constantFrom('', '1', 'x', '=1+1'),
      bold: fc.boolean(),
    }),
    weight: 4,
  },
  fc.record({
    kind: fc.constant('deliver' as const),
    from: replica,
    to: replica,
    count: fc.integer({ min: 1, max: 3 }),
  }),
);

function setup() {
  const docs = Array.from({ length: N }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = i + 1;
    return d;
  });
  applyCommand(
    docs[0] as Y.Doc,
    {
      type: 'CreatePage',
      page: { id: 'p', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
      sheet: {
        rows: ['a0', 'a1', 'a2'].map((order, i) => ({ id: `r${i}`, order })),
        cols: ['a0', 'a1'].map((order, i) => ({ id: `c${i}`, order })),
      },
    },
    SESSION_ORIGIN,
  );
  const base = Y.encodeStateAsUpdate(docs[0] as Y.Doc);
  for (const d of docs.slice(1)) Y.applyUpdate(d, base);
  const queues = docs.map(() => docs.map(() => [] as Uint8Array[]));
  docs.forEach((d, from) => {
    d.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      for (let to = 0; to < N; to++) if (to !== from) queues[from]?.[to]?.push(u);
    });
  });
  const deliver = (from: number, to: number, count: number) => {
    const q = queues[from]?.[to];
    for (let i = 0; i < count && q && q.length > 0; i++) {
      const u = q.shift();
      if (u) Y.applyUpdate(docs[to] as Y.Doc, u, REMOTE);
    }
  };
  return { docs, deliver };
}

describe('sheet convergence', () => {
  it('replicas converge under concurrent structure and cell edits', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 10, maxLength: 50 }), (steps) => {
        const { docs, deliver } = setup();
        let n = 0;
        for (const s of steps) {
          if (s.kind === 'deliver') {
            if (s.from !== s.to) deliver(s.from, s.to, s.count);
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const sheet = readSheet(getRoots(doc).sheets.get('p'));
          if (!sheet) continue;
          const rows = sheet.rows;
          const cols = sheet.cols;
          const run = (c: Parameters<typeof applyCommand>[1]) => applyCommand(doc, c, LOCAL_ORIGIN);
          switch (s.kind) {
            case 'insertRow': {
              const at = Math.min(s.at, rows.length);
              const [order] = keysBetween(rows[at - 1]?.order ?? null, rows[at]?.order ?? null, 1);
              run({
                type: 'InsertRows',
                pageId: 'p',
                rows: [{ id: `n${s.r}-${n++}`, order: order as string }],
              });
              break;
            }
            case 'deleteRow': {
              const row = rows[s.pick % Math.max(1, rows.length)];
              if (row) run({ type: 'DeleteRows', pageId: 'p', ids: [row.id] });
              break;
            }
            case 'moveRow': {
              const row = rows[s.pick % Math.max(1, rows.length)];
              if (!row) break;
              const others = rows.filter((x) => x.id !== row.id);
              const at = Math.min(s.at, others.length);
              const [order] = keysBetween(
                others[at - 1]?.order ?? null,
                others[at]?.order ?? null,
                1,
              );
              run({ type: 'MoveRow', pageId: 'p', id: row.id, order: order as string });
              break;
            }
            case 'insertCol': {
              const at = Math.min(s.at, cols.length);
              const [order] = keysBetween(cols[at - 1]?.order ?? null, cols[at]?.order ?? null, 1);
              run({
                type: 'InsertCols',
                pageId: 'p',
                cols: [{ id: `k${s.r}-${n++}`, order: order as string }],
              });
              break;
            }
            case 'deleteCol': {
              const col = cols[s.pick % Math.max(1, cols.length)];
              if (col) run({ type: 'DeleteCols', pageId: 'p', ids: [col.id] });
              break;
            }
            case 'width': {
              const col = cols[s.pick % Math.max(1, cols.length)];
              if (col) run({ type: 'SetColWidth', pageId: 'p', id: col.id, width: s.width });
              break;
            }
            case 'set': {
              const row = rows[s.row % Math.max(1, rows.length)];
              const col = cols[s.col % Math.max(1, cols.length)];
              if (row && col)
                run({
                  type: 'SetCells',
                  pageId: 'p',
                  cells: [
                    {
                      row: row.id,
                      col: col.id,
                      src: s.src,
                      ...(s.bold ? { fmt: { bold: true } } : {}),
                    },
                  ],
                });
              break;
            }
          }
        }
        for (let from = 0; from < N; from++)
          for (let to = 0; to < N; to++)
            if (from !== to) deliver(from, to, Number.POSITIVE_INFINITY);
        const snaps = docs.map((d) => readSheet(getRoots(d).sheets.get('p')));
        for (const s of snaps) expect(s).toEqual(snaps[0]);
      }),
      { numRuns: RUNS },
    );
  });
});
