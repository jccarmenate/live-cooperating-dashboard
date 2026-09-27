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
  readComment,
  readShape,
  readVote,
  SESSION_ORIGIN,
  type Shape,
  voteTallies,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 200);
const REMOTE = 'remote';
const N = 3;
const STICKIES = ['s0', 's1', 's2', 's3'];

type Step =
  | { kind: 'start'; r: number; endsAt: number }
  | { kind: 'end'; r: number }
  | { kind: 'cast'; r: number; sticky: number; user: number }
  | { kind: 'retract'; r: number; sticky: number; user: number }
  | { kind: 'comment'; r: number; thread: number; body: string }
  | { kind: 'reply'; r: number; thread: number; body: string }
  | { kind: 'resolve'; r: number; thread: number; resolved: boolean }
  | { kind: 'deleteSticky'; r: number; sticky: number }
  | { kind: 'deliver'; from: number; to: number; count: number };

const replica = fc.integer({ min: 0, max: N - 1 });
const small = fc.integer({ min: 0, max: 3 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('start' as const),
    r: replica,
    endsAt: fc.integer({ min: 1, max: 9 }),
  }),
  fc.record({ kind: fc.constant('end' as const), r: replica }),
  {
    arbitrary: fc.record({
      kind: fc.constant('cast' as const),
      r: replica,
      sticky: small,
      user: small,
    }),
    weight: 4,
  },
  fc.record({ kind: fc.constant('retract' as const), r: replica, sticky: small, user: small }),
  {
    arbitrary: fc.record({
      kind: fc.constant('comment' as const),
      r: replica,
      thread: small,
      body: fc.string({ maxLength: 5 }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('reply' as const),
      r: replica,
      thread: small,
      body: fc.string({ maxLength: 5 }),
    }),
    weight: 2,
  },
  fc.record({
    kind: fc.constant('resolve' as const),
    r: replica,
    thread: small,
    resolved: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('deleteSticky' as const), r: replica, sticky: small }),
  fc.record({
    kind: fc.constant('deliver' as const),
    from: replica,
    to: replica,
    count: fc.integer({ min: 1, max: 3 }),
  }),
);

function makeNet() {
  const docs = Array.from({ length: N }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = i + 1;
    return d;
  });
  // Every replica starts from the same four stickies.
  const seed = new Y.Doc();
  for (const id of STICKIES) {
    applyCommand(
      seed,
      {
        type: 'CreateShape',
        shape: {
          id,
          type: 'sticky',
          x: 0,
          y: 0,
          w: 160,
          h: 120,
          z: `a${id}`,
          style: DEFAULT_STYLE.sticky,
          text: '',
          createdBy: 'u',
          authorName: 'U',
          createdAt: 0,
        },
      },
      LOCAL_ORIGIN,
    );
  }
  const base = Y.encodeStateAsUpdate(seed);
  for (const d of docs) Y.applyUpdate(d, base, REMOTE);
  const queues = docs.map(() => docs.map(() => [] as Uint8Array[]));
  docs.forEach((d, from) => {
    d.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      for (let to = 0; to < N; to++) if (to !== from) queues[from]?.[to]?.push(update);
    });
  });
  return { docs, queues };
}

function deliver(net: ReturnType<typeof makeNet>, from: number, to: number, count: number) {
  const q = net.queues[from]?.[to];
  const doc = net.docs[to];
  if (!q || !doc) return;
  for (let i = 0; i < count && q.length > 0; i++) {
    const u = q.shift();
    if (u) Y.applyUpdate(doc, u, REMOTE);
  }
}

function derived(doc: Y.Doc) {
  const { shapes, session, votes, comments } = getRoots(doc);
  const snap: Record<string, Shape> = {};
  for (const [id, m] of shapes.entries()) {
    const s = readShape(id, m);
    if (s) snap[id] = s;
  }
  const vote = readVote(session);
  const threads = [...comments.entries()]
    .map(([id, m]) => readComment(id, m))
    .sort((a, b) => ((a?.id ?? '') < (b?.id ?? '') ? -1 : 1));
  // Every StartVote in this test uses maxPerUser 2; before any vote exists, cap at 2 too.
  return { vote, tallies: voteTallies([...votes.keys()], snap, vote?.maxPerUser ?? 2), threads };
}

describe('session convergence', () => {
  it('votes and comment threads converge under concurrent commands and delivery order', () => {
    let replies = 0;
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 15, maxLength: 50 }), (steps) => {
        const net = makeNet();
        let n = 0;
        for (const s of steps) {
          if (s.kind === 'deliver') {
            if (s.from !== s.to) deliver(net, s.from, s.to, s.count);
            continue;
          }
          const doc = net.docs[s.r] as Y.Doc;
          let cmd: Command | null = null;
          if (s.kind === 'start')
            cmd = { type: 'StartVote', endsAt: s.endsAt, maxPerUser: 2, startedBy: `u${s.r}` };
          if (s.kind === 'end') cmd = { type: 'EndVote' };
          if (s.kind === 'cast')
            cmd = { type: 'CastVote', shapeId: `s${s.sticky}`, userId: `u${s.user}` };
          if (s.kind === 'retract')
            cmd = { type: 'RetractVote', shapeId: `s${s.sticky}`, userId: `u${s.user}` };
          if (s.kind === 'deleteSticky') {
            applyCommand(doc, { type: 'DeleteShapes', ids: [`s${s.sticky}`] }, LOCAL_ORIGIN);
            continue;
          }
          const entry = {
            id: `e${s.r}-${n++}`,
            authorId: `u${s.r}`,
            author: `U${s.r}`,
            body: 'body' in s ? s.body : '',
            ts: n,
          };
          if (s.kind === 'comment')
            cmd = {
              type: 'AddComment',
              id: `c${s.thread}`,
              pageId: 'main',
              anchor: { shapeId: `s${s.thread}`, dx: 1, dy: 2 },
              createdBy: `u${s.r}`,
              createdAt: n,
              entry,
            };
          if (s.kind === 'reply') {
            if (!getRoots(doc).comments.has(`c${s.thread}`)) continue;
            cmd = { type: 'ReplyComment', commentId: `c${s.thread}`, entry };
            replies++;
          }
          if (s.kind === 'resolve')
            cmd = { type: 'ResolveComment', id: `c${s.thread}`, resolved: s.resolved };
          if (cmd) applyCommand(doc, cmd, SESSION_ORIGIN);
        }
        for (let from = 0; from < N; from++)
          for (let to = 0; to < N; to++) deliver(net, from, to, Number.POSITIVE_INFINITY);
        const [first, ...rest] = net.docs.map(derived);
        for (const d of rest) expect(d).toEqual(first);
        for (const count of Object.values(first?.tallies.byUser ?? {})) {
          expect(count.length).toBeLessThanOrEqual(2);
        }
      }),
      { numRuns: RUNS },
    );
    expect(replies).toBeGreaterThan(0);
  });
});
