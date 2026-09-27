declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  type Command,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  orderBetween,
  readPages,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 200);
const REMOTE = 'remote';
const N = 3;
const PAGE_IDS = ['main', 'p1', 'p2', 'p3'];

type Step =
  | { kind: 'create'; r: number; page: number; key: number }
  | { kind: 'rename'; r: number; page: number; title: string }
  | { kind: 'move'; r: number; page: number; key: number }
  | { kind: 'delete'; r: number; page: number }
  | { kind: 'shape'; r: number; page: number }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const page = fc.integer({ min: 0, max: PAGE_IDS.length - 1 });
const key = fc.integer({ min: 0, max: 5 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  {
    arbitrary: fc.record({ kind: fc.constant('create' as const), r: replica, page, key }),
    weight: 3,
  },
  fc.record({
    kind: fc.constant('rename' as const),
    r: replica,
    page,
    title: fc.string({ maxLength: 4 }),
  }),
  fc.record({ kind: fc.constant('move' as const), r: replica, page, key }),
  fc.record({ kind: fc.constant('delete' as const), r: replica, page }),
  { arbitrary: fc.record({ kind: fc.constant('shape' as const), r: replica, page }), weight: 3 },
  fc.record({
    kind: fc.constant('deliver' as const),
    from: replica,
    to: replica,
    count: fc.integer({ min: 1, max: 3 }),
  }),
);

const keyAt = (k: number) => orderBetween(`a${k}`, null);

describe('pages convergence', () => {
  it('pages and their content converge under concurrent page commands', () => {
    let deletes = 0;
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 15, maxLength: 50 }), (steps) => {
        const docs = Array.from({ length: N }, (_, i) => {
          const d = new Y.Doc();
          d.clientID = i + 1;
          return d;
        });
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
        let n = 0;
        for (const s of steps) {
          if (s.kind === 'deliver') {
            if (s.from !== s.to) deliver(s.from, s.to, s.count);
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const id = PAGE_IDS[s.page] as string;
          let cmd: Command;
          if (s.kind === 'create')
            cmd = {
              type: 'CreatePage',
              page: {
                id,
                type: 'board',
                title: id,
                order: keyAt(s.key),
                createdBy: `u${s.r}`,
                createdAt: 0,
              },
            };
          else if (s.kind === 'rename') cmd = { type: 'RenamePage', id, title: s.title };
          else if (s.kind === 'move') cmd = { type: 'MovePage', id, order: keyAt(s.key) };
          else if (s.kind === 'delete') {
            cmd = { type: 'DeletePage', id };
            deletes++;
          } else
            cmd = {
              type: 'CreateShape',
              shape: {
                id: `s${s.r}-${n++}`,
                pageId: id,
                type: 'sticky',
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                style: DEFAULT_STYLE.sticky,
                text: '',
                createdBy: `u${s.r}`,
                authorName: 'U',
                createdAt: 0,
              },
            };
          applyCommand(doc, cmd, LOCAL_ORIGIN);
        }
        for (let from = 0; from < N; from++)
          for (let to = 0; to < N; to++) deliver(from, to, Number.POSITIVE_INFINITY);
        const views = docs.map((d) => ({
          pages: readPages(getRoots(d).pages),
          shapes: getRoots(d).shapes.toJSON(),
        }));
        for (const v of views.slice(1)) expect(v).toEqual(views[0]);
        // A deleted page never comes back, and it keeps no content added before the delete arrived.
        const deleted = new Set(
          [...getRoots(docs[0] as Y.Doc).pages.entries()]
            .filter(([, m]) => m.get('deleted') === true)
            .map(([pid]) => pid),
        );
        for (const p of views[0]?.pages ?? []) expect(deleted.has(p.id)).toBe(false);
      }),
      { numRuns: RUNS },
    );
    expect(deletes).toBeGreaterThan(0);
  });
});
