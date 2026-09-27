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
  MAIN_PAGE,
  orderBetween,
  readPages,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 200);
const REMOTE = 'remote';
const N = 3;
/** Page slot 0 is main; the others are per-replica pages. */
const SLOTS = 4;

/**
 * Only main can be created concurrently under the same id: every other page id
 * embeds the replica that creates it (`owner`), as a random id would in the app.
 */
const pageId = (slot: number, owner: number) => (slot === 0 ? MAIN_PAGE : `p${slot}-r${owner}`);

type Step =
  | { kind: 'create'; r: number; page: number; key: number }
  | { kind: 'rename'; r: number; page: number; owner: number; title: string }
  | { kind: 'move'; r: number; page: number; owner: number; key: number }
  | { kind: 'delete'; r: number; page: number; owner: number }
  | { kind: 'shape'; r: number; page: number; owner: number }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const page = fc.integer({ min: 0, max: SLOTS - 1 });
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
    owner: replica,
    title: fc.string({ maxLength: 4 }),
  }),
  fc.record({ kind: fc.constant('move' as const), r: replica, page, owner: replica, key }),
  fc.record({ kind: fc.constant('delete' as const), r: replica, page, owner: replica }),
  {
    arbitrary: fc.record({ kind: fc.constant('shape' as const), r: replica, page, owner: replica }),
    weight: 3,
  },
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
        /** Every page some replica deleted while it knew the page. */
        const deleted = new Set<string>();
        let n = 0;
        for (const s of steps) {
          if (s.kind === 'deliver') {
            if (s.from !== s.to) deliver(s.from, s.to, s.count);
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const id = pageId(s.page, s.kind === 'create' ? s.r : s.owner);
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
            // Main always exists; any other page counts once this replica has seen it.
            if (id === MAIN_PAGE || getRoots(doc).pages.has(id)) {
              deleted.add(id);
              deletes++;
            }
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
        const views = docs.map((d) => {
          const roots = getRoots(d);
          return {
            pages: readPages(roots.pages, roots.pageTombstones),
            shapes: roots.shapes.toJSON(),
          };
        });
        for (const v of views.slice(1)) expect(v).toEqual(views[0]);
        // A deleted page never comes back, on any replica.
        for (const v of views) {
          expect(v.pages.map((p) => p.id).filter((id) => deleted.has(id))).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
    expect(deletes).toBeGreaterThan(0);
  });
});
