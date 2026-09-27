# Relay F3b — Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server clock with the client's role, retro dot voting with a shared server-time countdown, and anchored comment threads with pins, a thread popover and a side panel.

**Architecture:**
- **Core** owns the session data model (`session`, `votes` and `comments` roots), the new commands and their reads (derived tallies and validated threads), the comment tool in the FSM, and the server-message protocol.
- **Server:** the Durable Object says `hello {role, now}` on connect and answers `time?`.
- **Web client:**
  - The connection keeps a clock store (`role` and `offset`).
  - An activity store projects votes and comments.
  - The controller applies session commands with the untracked `SESSION` origin.
  - New components render the header vote control, sticky vote badges, comment pins and popover, the composer, and the panel.

**Tech Stack:** TypeScript, Yjs 13.6, y-partyserver, Zustand 5, React 19 / Next.js 16, Tailwind 4, lucide-react, Vitest 4, fast-check, Playwright, Biome 2.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`. The relevant sections are Yjs Document, Sync Layer, Commands and Undo, Input, Voting, Comments and Server Time.

## Global Constraints

**Cost, packages and workflow**
- $0 and no credit card. No new runtime dependencies.
- `packages/core` stays platform-neutral: lib ES2023, `types: []`, no DOM or Node typings.
- All document mutations go through `applyCommand(doc, cmd, origin)`. UI code never touches Yjs types directly.
- Do NOT edit `README.md` or `README.es.md`.
- Checks:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint` (Biome; `npm run format` fixes formatting)
  - `npm run build -w @relay/web` for web tasks
  - `npm run e2e`, which reuses the dev servers already running on 8787 and 3000. Never start or kill servers.
- Commits end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. Never amend a commit.

**Undo and access**
- Votes and comments use `SESSION_ORIGIN = 'relay:session'`, which the undo manager never tracks. Board edits keep using `LOCAL_ORIGIN`.
- Viewers (role `view`) see votes and comments but get no VOTE button, no clickable vote badges, no comment tool, no composer, no reply box and no Resolve button.
- Keyboard shortcuts are ignored while typing in an input, textarea or contenteditable element.

**Voting values**
- `maxPerUser` is 3. Durations are 1, 3 or 5 minutes.
- A vote is open while `vote.open && serverNow < vote.endsAt`.
- `StartVote` clears all votes in the same transaction.
- Tallies count only votes on existing stickies, and each user's votes are capped by taking their keys in sorted order.

**Comment values**
- Limits applied on read:
  - body: 2000 characters
  - author name: 40 characters
  - thread: 200 entries
- Malformed entries are skipped.

**Server protocol**
- Custom messages (`__YPS:` + JSON):
  - `{type:'hello', role, now}` on every connect
  - `{type:'time', now}` in reply to `{type:'time?'}`
  - The client sends `time?` every 5 minutes while online.
  - Malformed or unknown messages are ignored.
- Clock: `offset = now − Date.now()` at receipt, and `serverNow() = Date.now() + offset`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/schema/types.ts` (modify) | `VoteState`, `CommentAnchor`, `CommentEntry`, `CommentThread` |
| `packages/core/src/schema/defaults.ts` (modify) | `VOTES_PER_USER`, `VOTE_DURATIONS_MIN`, `MAX_COMMENT_BODY`, `MAX_AUTHOR_NAME`, `MAX_THREAD_ENTRIES` |
| `packages/core/src/schema/doc.ts` (modify) | `session`, `votes` and `comments` roots |
| `packages/core/src/schema/session.ts` (create) | `voteKey`, `readVote`, `isVoteOpen`, `voteTallies`, `readComment`, `commentPoint` |
| `packages/core/src/commands/origins.ts` (modify) | `SESSION_ORIGIN` |
| `packages/core/src/commands/types.ts`, `apply.ts` (modify) | The seven session commands |
| `packages/core/src/sync/messages.ts` (create) | `Role`, `ServerMessage`, `TIME_REQUEST`, `parseServerMessage`, `isTimeRequest` |
| `packages/core/src/tools/machine.ts` (modify) | The `comment` tool and the `compose` effect |
| `apps/sync-server/src/room.ts` (modify) | `hello` on connect; answers `time?` |
| `apps/web/src/sync/clock.ts` (create) | Pure `nextClock` reducer |
| `apps/web/src/sync/connection.ts` (modify) | Clock store, `serverNow`, 5-minute time refresh |
| `apps/web/src/store/activityStore.ts` (create) | Projects the vote, vote keys and comment threads |
| `apps/web/src/board/controller.ts`, `session.ts` (modify) | Session commands, composer/thread/panel UI state, wiring |
| `apps/web/src/ui/shortcuts.ts`, `Toolbar.tsx` (modify) | `M`, the comment tool (hidden for viewers) |
| `apps/web/src/render/voting.ts` (create) | `cachedTallies`, `useVoteOpen`, `useServerNow` |
| `apps/web/src/ui/VoteControl.tsx`, `render/VoteBadge.tsx` (create) | Header vote control and sticky badge |
| `apps/web/src/render/CommentLayer.tsx`, `CommentComposer.tsx`, `ui/CommentsPanel.tsx` (create) | Pins and popover, composer, panel |
| `apps/web/src/ui/Header.tsx`, `render/ShapeView.tsx`, `board/Board.tsx` (modify) | Mounting points |
| `e2e/session.spec.ts` (create) | End-to-end voting, comments and read-only link |

---

### Task 1: Core session model and commands

**Files:**
- Modify:
  - `packages/core/src/schema/types.ts`
  - `packages/core/src/schema/defaults.ts`
  - `packages/core/src/schema/doc.ts`
  - `packages/core/src/commands/origins.ts`
  - `packages/core/src/commands/types.ts`
  - `packages/core/src/commands/apply.ts`
  - `packages/core/src/index.ts`
- Create: `packages/core/src/schema/session.ts`
- Test: `packages/core/test/session.test.ts` (create)

**Interfaces:**
- Produces:
  - Types:
    - `VoteState { open: boolean; endsAt: number; maxPerUser: number; startedBy: string }`
    - `CommentAnchor = { shapeId: string; dx: number; dy: number } | { x: number; y: number }`
    - `CommentEntry { id; authorId; author; body; ts }`
    - `CommentThread { id; anchor; resolved; createdBy; createdAt; entries: CommentEntry[] }`
  - Constants:
    - `VOTES_PER_USER = 3`
    - `VOTE_DURATIONS_MIN = [1, 3, 5]`
    - `MAX_COMMENT_BODY = 2000`
    - `MAX_AUTHOR_NAME = 40`
    - `MAX_THREAD_ENTRIES = 200`
    - `SESSION_ORIGIN = 'relay:session'`
  - `Roots` gains `session: Y.Map<unknown>`, `votes: Y.Map<boolean>` and `comments: Y.Map<Y.Map<unknown>>`.
  - Commands:
    - `StartVote { endsAt; maxPerUser; startedBy }`
    - `EndVote`
    - `CastVote { shapeId; userId }`
    - `RetractVote { shapeId; userId }`
    - `AddComment { id; anchor; createdBy; createdAt; entry }`
    - `ReplyComment { commentId; entry }`
    - `ResolveComment { id; resolved }`
  - Functions:
    - `voteKey(shapeId, userId): string`
    - `readVote(session: Y.Map<unknown>): VoteState | null`
    - `isVoteOpen(vote: VoteState | null, serverNow: number): boolean`
    - `voteTallies(keys: Iterable<string>, shapes: Readonly<Record<string, Shape>>, maxPerUser: number): { counts: Record<string, number>; byUser: Record<string, string[]> }`
    - `readComment(id: string, m: Y.Map<unknown>): CommentThread | null`
    - `commentPoint(anchor: CommentAnchor, shapes: Readonly<Record<string, Pick<Shape, 'x' | 'y'>>>): Point | null`

- [ ] **Step 1: Write the failing tests** in `packages/core/test/session.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  commentPoint,
  DEFAULT_STYLE,
  getRoots,
  isVoteOpen,
  MAX_AUTHOR_NAME,
  MAX_COMMENT_BODY,
  MAX_THREAD_ENTRIES,
  readComment,
  readVote,
  SESSION_ORIGIN,
  type Shape,
  voteKey,
  voteTallies,
} from '../src';

function shape(id: string, partial: Partial<Shape> = {}): Shape {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 160,
    h: 120,
    z: 'a0',
    style: DEFAULT_STYLE.sticky,
    text: '',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 0,
    ...partial,
  };
}

const entry = (id: string, body = 'hi') => ({ id, authorId: 'u1', author: 'Brisk Otter', body, ts: 5 });

describe('voting commands', () => {
  it('StartVote opens a vote and clears previous votes in one transaction', () => {
    const doc = new Y.Doc();
    const { session, votes } = getRoots(doc);
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);
    applyCommand(doc, { type: 'StartVote', endsAt: 60_000, maxPerUser: 3, startedBy: 'u2' }, SESSION_ORIGIN);
    expect(transactions).toBe(1);
    expect(readVote(session)).toEqual({ open: true, endsAt: 60_000, maxPerUser: 3, startedBy: 'u2' });
    expect(votes.size).toBe(0);
  });

  it('EndVote closes an open vote and keeps the rest', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'StartVote', endsAt: 60_000, maxPerUser: 3, startedBy: 'u2' }, SESSION_ORIGIN);
    applyCommand(doc, { type: 'EndVote' }, SESSION_ORIGIN);
    expect(readVote(getRoots(doc).session)).toEqual({
      open: false,
      endsAt: 60_000,
      maxPerUser: 3,
      startedBy: 'u2',
    });
  });

  it('CastVote and RetractVote set and delete the flat key', () => {
    const doc = new Y.Doc();
    const { votes } = getRoots(doc);
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    expect(votes.get(voteKey('s1', 'u1'))).toBe(true);
    applyCommand(doc, { type: 'RetractVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    expect(votes.has('s1:u1')).toBe(false);
  });

  it('readVote rejects malformed values and clamps maxPerUser', () => {
    const doc = new Y.Doc();
    const { session } = getRoots(doc);
    expect(readVote(session)).toBeNull();
    session.set('vote', { open: 'yes', endsAt: 1, maxPerUser: 3, startedBy: 'u' });
    expect(readVote(session)).toBeNull();
    session.set('vote', { open: true, endsAt: 1, maxPerUser: 1e9, startedBy: 'u' });
    expect(readVote(session)?.maxPerUser).toBe(99);
  });

  it('isVoteOpen needs open and an unexpired deadline', () => {
    const vote = { open: true, endsAt: 1000, maxPerUser: 3, startedBy: 'u' };
    expect(isVoteOpen(vote, 999)).toBe(true);
    expect(isVoteOpen(vote, 1000)).toBe(false);
    expect(isVoteOpen({ ...vote, open: false }, 0)).toBe(false);
    expect(isVoteOpen(null, 0)).toBe(false);
  });
});

describe('vote tallies', () => {
  const shapes = { s1: shape('s1'), s2: shape('s2'), s3: shape('s3'), r1: shape('r1', { type: 'rect' }) };

  it('counts votes on existing stickies only', () => {
    const t = voteTallies(['s1:u1', 's1:u2', 'r1:u1', 'gone:u1', 'bad'], shapes, 3);
    expect(t.counts).toEqual({ s1: 2 });
    expect(t.byUser).toEqual({ u1: ['s1'], u2: ['s1'] });
  });

  it('caps each user by sorted keys so racing tabs converge', () => {
    const t = voteTallies(['s3:u1', 's1:u1', 's2:u1'], shapes, 2);
    expect(t.byUser).toEqual({ u1: ['s1', 's2'] });
    expect(t.counts).toEqual({ s1: 1, s2: 1 });
  });
});

describe('comments', () => {
  it('AddComment, ReplyComment and ResolveComment build a readable thread', () => {
    const doc = new Y.Doc();
    const { comments } = getRoots(doc);
    applyCommand(
      doc,
      {
        type: 'AddComment',
        id: 'c1',
        anchor: { shapeId: 's1', dx: 10, dy: 20 },
        createdBy: 'u1',
        createdAt: 7,
        entry: entry('e1'),
      },
      SESSION_ORIGIN,
    );
    applyCommand(doc, { type: 'ReplyComment', commentId: 'c1', entry: entry('e2', 'yes') }, SESSION_ORIGIN);
    applyCommand(doc, { type: 'ResolveComment', id: 'c1', resolved: true }, SESSION_ORIGIN);
    const m = comments.get('c1') as Y.Map<unknown>;
    expect(readComment('c1', m)).toEqual({
      id: 'c1',
      anchor: { shapeId: 's1', dx: 10, dy: 20 },
      resolved: true,
      createdBy: 'u1',
      createdAt: 7,
      entries: [entry('e1'), entry('e2', 'yes')],
    });
  });

  it('AddComment never overwrites an existing thread', () => {
    const doc = new Y.Doc();
    const add = (body: string) =>
      applyCommand(
        doc,
        { type: 'AddComment', id: 'c1', anchor: { x: 1, y: 2 }, createdBy: 'u1', createdAt: 0, entry: entry('e', body) },
        SESSION_ORIGIN,
      );
    add('first');
    add('second');
    expect(readComment('c1', getRoots(doc).comments.get('c1') as Y.Map<unknown>)?.entries[0]?.body).toBe(
      'first',
    );
  });

  it('readComment enforces limits and skips malformed entries', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    const thread = new Y.Array<unknown>();
    getRoots(doc).comments.set('c1', m);
    m.set('anchor', { x: 0, y: 0 });
    m.set('thread', thread);
    thread.push([
      { id: 'e1', authorId: 'u', author: 'x'.repeat(100), body: 'b'.repeat(5000), ts: 1 },
      { id: 'e2', authorId: 'u', body: 'missing author', ts: 1 },
      ...Array.from({ length: 300 }, (_, i) => entry(`n${i}`)),
    ]);
    const c = readComment('c1', m);
    expect(c?.entries[0]?.author.length).toBe(MAX_AUTHOR_NAME);
    expect(c?.entries[0]?.body.length).toBe(MAX_COMMENT_BODY);
    expect(c?.entries.length).toBe(MAX_THREAD_ENTRIES);
    expect(c?.entries[1]?.id).toBe('n0');
  });

  it('readComment rejects a thread without a valid anchor or any valid entry', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    getRoots(doc).comments.set('c1', m);
    m.set('anchor', { shapeId: 's1' });
    const thread = new Y.Array<unknown>();
    m.set('thread', thread);
    thread.push([entry('e1')]);
    expect(readComment('c1', m)).toBeNull();
    m.set('anchor', { x: 0, y: 0 });
    thread.delete(0, 1);
    expect(readComment('c1', m)).toBeNull();
  });

  it('commentPoint follows the anchored shape, or is null when it is gone', () => {
    expect(commentPoint({ shapeId: 's1', dx: 10, dy: 20 }, { s1: { x: 100, y: 50 } })).toEqual({
      x: 110,
      y: 70,
    });
    expect(commentPoint({ shapeId: 'gone', dx: 0, dy: 0 }, {})).toBeNull();
    expect(commentPoint({ x: 3, y: 4 }, {})).toEqual({ x: 3, y: 4 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- session`
Expected: FAIL. The imports do not exist.

- [ ] **Step 3: Add the types.** Append to `packages/core/src/schema/types.ts`:

```ts
export interface VoteState {
  open: boolean;
  /** Server epoch ms; the vote is open while `open && serverNow < endsAt`. */
  endsAt: number;
  maxPerUser: number;
  startedBy: string;
}

/** A comment pinned to a shape (offset from its top-left) or to a world point. */
export type CommentAnchor = { shapeId: string; dx: number; dy: number } | { x: number; y: number };

export interface CommentEntry {
  id: string;
  authorId: string;
  author: string;
  body: string;
  ts: number;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  resolved: boolean;
  createdBy: string;
  createdAt: number;
  entries: CommentEntry[];
}
```

- [ ] **Step 4: Add the constants.** Append to `packages/core/src/schema/defaults.ts`:

```ts
/** Retro dot voting: votes each user may cast, and the offered vote durations. */
export const VOTES_PER_USER = 3;
export const VOTE_DURATIONS_MIN = [1, 3, 5] as const;

/** Comment limits, enforced on read. */
export const MAX_COMMENT_BODY = 2000;
export const MAX_AUTHOR_NAME = 40;
export const MAX_THREAD_ENTRIES = 200;
```

- [ ] **Step 5: Add the roots.** In `packages/core/src/schema/doc.ts`:
  - Add these fields to `Roots`:

```ts
  session: Y.Map<unknown>;
  votes: Y.Map<boolean>;
  comments: Y.Map<Y.Map<unknown>>;
```

  - Add these properties to the object that `getRoots` returns:

```ts
    session: doc.getMap<unknown>('session'),
    votes: doc.getMap<boolean>('votes'),
    comments: doc.getMap<Y.Map<unknown>>('comments'),
```

- [ ] **Step 6: Add the origin.** Replace `packages/core/src/commands/origins.ts` with:

```ts
/** Transaction origins tracked by the per-user UndoManager. */
export const LOCAL_ORIGIN = 'relay:local';
export const AI_ORIGIN = 'relay:ai';
/** Votes and comments: never tracked by the UndoManager (Ctrl+Z undoes board edits only). */
export const SESSION_ORIGIN = 'relay:session';
```

- [ ] **Step 7: Add the commands.** In `packages/core/src/commands/types.ts`:
  - Import `CommentAnchor` and `CommentEntry` from `'../schema/types'`.
  - Add to the `Command` union:

```ts
  | { type: 'StartVote'; endsAt: number; maxPerUser: number; startedBy: string }
  | { type: 'EndVote' }
  | { type: 'CastVote'; shapeId: string; userId: string }
  | { type: 'RetractVote'; shapeId: string; userId: string }
  | {
      type: 'AddComment';
      id: string;
      anchor: CommentAnchor;
      createdBy: string;
      createdAt: number;
      entry: CommentEntry;
    }
  | { type: 'ReplyComment'; commentId: string; entry: CommentEntry }
  | { type: 'ResolveComment'; id: string; resolved: boolean };
```

- [ ] **Step 8: Create `packages/core/src/schema/session.ts`**

```ts
import * as Y from 'yjs';
import { MAX_AUTHOR_NAME, MAX_COMMENT_BODY, MAX_THREAD_ENTRIES } from './defaults';
import type {
  CommentAnchor,
  CommentEntry,
  CommentThread,
  Point,
  Shape,
  VoteState,
} from './types';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Key of one user's vote on one sticky in the flat `votes` map (flat: concurrent creation). */
export const voteKey = (shapeId: string, userId: string): string => `${shapeId}:${userId}`;

export function readVote(session: Y.Map<unknown>): VoteState | null {
  const v = session.get('vote');
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.open !== 'boolean' || !finite(o.endsAt) || !finite(o.maxPerUser)) return null;
  if (typeof o.startedBy !== 'string') return null;
  const maxPerUser = Math.max(0, Math.min(99, Math.floor(o.maxPerUser)));
  return { open: o.open, endsAt: o.endsAt, maxPerUser, startedBy: o.startedBy };
}

export const isVoteOpen = (vote: VoteState | null, serverNow: number): boolean =>
  vote !== null && vote.open && serverNow < vote.endsAt;

export interface Tallies {
  counts: Record<string, number>;
  byUser: Record<string, string[]>;
}

/**
 * Derived vote totals. Only votes on existing stickies count, and each user's votes are
 * capped at `maxPerUser` taking their keys in sorted order, so two tabs of one user
 * racing past the cap converge to the same tallies everywhere.
 */
export function voteTallies(
  keys: Iterable<string>,
  shapes: Readonly<Record<string, Shape>>,
  maxPerUser: number,
): Tallies {
  const perUser = new Map<string, string[]>();
  for (const key of keys) {
    const i = key.lastIndexOf(':');
    if (i <= 0 || i === key.length - 1) continue;
    const shapeId = key.slice(0, i);
    const userId = key.slice(i + 1);
    if (!Object.hasOwn(shapes, shapeId) || shapes[shapeId]?.type !== 'sticky') continue;
    const list = perUser.get(userId) ?? [];
    list.push(shapeId);
    perUser.set(userId, list);
  }
  const counts: Record<string, number> = {};
  const byUser: Record<string, string[]> = {};
  for (const [userId, ids] of perUser) {
    const kept = ids.sort().slice(0, maxPerUser);
    byUser[userId] = kept;
    for (const id of kept) counts[id] = (counts[id] ?? 0) + 1;
  }
  return { counts, byUser };
}

function readAnchor(v: unknown): CommentAnchor | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.shapeId === 'string' && finite(o.dx) && finite(o.dy)) {
    return { shapeId: o.shapeId, dx: o.dx, dy: o.dy };
  }
  if (finite(o.x) && finite(o.y)) return { x: o.x, y: o.y };
  return null;
}

function readEntry(v: unknown): CommentEntry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.authorId !== 'string') return null;
  if (typeof o.author !== 'string' || typeof o.body !== 'string' || !finite(o.ts)) return null;
  return {
    id: o.id,
    authorId: o.authorId,
    author: o.author.slice(0, MAX_AUTHOR_NAME),
    body: o.body.slice(0, MAX_COMMENT_BODY),
    ts: o.ts,
  };
}

/** A validated, limit-enforced thread, or null without a valid anchor or any valid entry. */
export function readComment(id: string, m: Y.Map<unknown>): CommentThread | null {
  const anchor = readAnchor(m.get('anchor'));
  const thread = m.get('thread');
  if (!anchor || !(thread instanceof Y.Array)) return null;
  const entries: CommentEntry[] = [];
  for (const raw of thread.toArray()) {
    if (entries.length >= MAX_THREAD_ENTRIES) break;
    const e = readEntry(raw);
    if (e) entries.push(e);
  }
  if (entries.length === 0) return null;
  const createdBy = m.get('createdBy');
  const createdAt = m.get('createdAt');
  return {
    id,
    anchor,
    resolved: m.get('resolved') === true,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: finite(createdAt) ? createdAt : 0,
    entries,
  };
}

/** Where a thread's pin sits in world coordinates; null when its shape is gone. */
export function commentPoint(
  anchor: CommentAnchor,
  shapes: Readonly<Record<string, Pick<Shape, 'x' | 'y'>>>,
): Point | null {
  if ('shapeId' in anchor) {
    const s = Object.hasOwn(shapes, anchor.shapeId) ? shapes[anchor.shapeId] : undefined;
    return s ? { x: s.x + anchor.dx, y: s.y + anchor.dy } : null;
  }
  return { x: anchor.x, y: anchor.y };
}
```

- [ ] **Step 9: Apply the commands.** In `packages/core/src/commands/apply.ts`:
  - Add `import { readVote, voteKey } from '../schema/session';`.
  - Add `CommentEntry` to the type import from `'../schema/types'`.
  - Change the first line of `apply` to `const { shapes, connectors, session, votes, comments } = getRoots(doc);`.
  - Add these cases to the switch:

```ts
    case 'StartVote': {
      session.set('vote', {
        open: true,
        endsAt: cmd.endsAt,
        maxPerUser: cmd.maxPerUser,
        startedBy: cmd.startedBy,
      });
      for (const key of [...votes.keys()]) votes.delete(key);
      return;
    }
    case 'EndVote': {
      const vote = readVote(session);
      if (vote?.open) session.set('vote', { ...vote, open: false });
      return;
    }
    case 'CastVote':
      votes.set(voteKey(cmd.shapeId, cmd.userId), true);
      return;
    case 'RetractVote':
      votes.delete(voteKey(cmd.shapeId, cmd.userId));
      return;
    case 'AddComment': {
      if (comments.has(cmd.id)) return;
      const m = new Y.Map<unknown>();
      m.set('anchor', cmd.anchor);
      m.set('resolved', false);
      m.set('createdBy', cmd.createdBy);
      m.set('createdAt', cmd.createdAt);
      const thread = new Y.Array<CommentEntry>();
      thread.push([cmd.entry]);
      m.set('thread', thread);
      comments.set(cmd.id, m);
      return;
    }
    case 'ReplyComment': {
      const thread = comments.get(cmd.commentId)?.get('thread');
      if (thread instanceof Y.Array) thread.push([cmd.entry]);
      return;
    }
    case 'ResolveComment':
      comments.get(cmd.id)?.set('resolved', cmd.resolved);
      return;
```

- [ ] **Step 10: Export it.** In `packages/core/src/index.ts`, add `export * from './schema/session';` after `export * from './schema/normalize';`.

- [ ] **Step 11: Run the checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src packages/core/test/session.test.ts
git commit -m "feat(core): session roots, voting and comment commands with derived tallies"
```

---

### Task 2: Session convergence and undo isolation

**Files:**
- Test: `packages/core/test/session-convergence.test.ts` (create)
- Test: `packages/core/test/undo.test.ts` (modify)

**Interfaces:**
- Consumes Task 1: the session commands, `SESSION_ORIGIN`, `readVote`, `voteTallies` and `readComment`.

- [ ] **Step 1: Write the property test** in `packages/core/test/session-convergence.test.ts`

```ts
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
  fc.record({ kind: fc.constant('start' as const), r: replica, endsAt: fc.integer({ min: 1, max: 9 }) }),
  fc.record({ kind: fc.constant('end' as const), r: replica }),
  { arbitrary: fc.record({ kind: fc.constant('cast' as const), r: replica, sticky: small, user: small }), weight: 4 },
  fc.record({ kind: fc.constant('retract' as const), r: replica, sticky: small, user: small }),
  { arbitrary: fc.record({ kind: fc.constant('comment' as const), r: replica, thread: small, body: fc.string({ maxLength: 5 }) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('reply' as const), r: replica, thread: small, body: fc.string({ maxLength: 5 }) }), weight: 2 },
  fc.record({ kind: fc.constant('resolve' as const), r: replica, thread: small, resolved: fc.boolean() }),
  fc.record({ kind: fc.constant('deleteSticky' as const), r: replica, sticky: small }),
  fc.record({ kind: fc.constant('deliver' as const), from: replica, to: replica, count: fc.integer({ min: 1, max: 3 }) }),
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
          if (s.kind === 'start') cmd = { type: 'StartVote', endsAt: s.endsAt, maxPerUser: 2, startedBy: `u${s.r}` };
          if (s.kind === 'end') cmd = { type: 'EndVote' };
          if (s.kind === 'cast') cmd = { type: 'CastVote', shapeId: `s${s.sticky}`, userId: `u${s.user}` };
          if (s.kind === 'retract') cmd = { type: 'RetractVote', shapeId: `s${s.sticky}`, userId: `u${s.user}` };
          if (s.kind === 'deleteSticky') {
            applyCommand(doc, { type: 'DeleteShapes', ids: [`s${s.sticky}`] }, LOCAL_ORIGIN);
            continue;
          }
          const entry = { id: `e${s.r}-${n++}`, authorId: `u${s.r}`, author: `U${s.r}`, body: 'body' in s ? s.body : '', ts: n };
          if (s.kind === 'comment')
            cmd = { type: 'AddComment', id: `c${s.thread}`, anchor: { shapeId: `s${s.thread}`, dx: 1, dy: 2 }, createdBy: `u${s.r}`, createdAt: n, entry };
          if (s.kind === 'reply') {
            if (!getRoots(doc).comments.has(`c${s.thread}`)) continue;
            cmd = { type: 'ReplyComment', commentId: `c${s.thread}`, entry };
            replies++;
          }
          if (s.kind === 'resolve') cmd = { type: 'ResolveComment', id: `c${s.thread}`, resolved: s.resolved };
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
```

- [ ] **Step 2: Add undo isolation.** Append to `packages/core/test/undo.test.ts` inside its main `describe`. Add `SESSION_ORIGIN` to its imports if missing.

```ts
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
```

- [ ] **Step 3: Run the checks.** Run `npm test -w @relay/core`, `npm run typecheck` and `npm run lint` (run `npm run format` first if needed). Expected: PASS.
  - If the property test finds a real divergence, report it as BLOCKED with the counterexample. Do not weaken the invariant.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/session-convergence.test.ts packages/core/test/undo.test.ts
git commit -m "test(core): votes and comment threads converge; session edits are never undone"
```

---

### Task 3: Comment tool in the FSM, and the server-message protocol

**Files:**
- Modify: `packages/core/src/tools/machine.ts`
- Create: `packages/core/src/sync/messages.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/tools-structure.test.ts`, `packages/core/test/messages.test.ts` (create)

**Interfaces:**
- Consumes: `CommentAnchor` (Task 1).
- Produces:
  - `ToolId` gains `'comment'`.
  - `Effect` gains `{ type: 'compose'; anchor: CommentAnchor; at: Point }`.
  - `Role = 'edit' | 'view'`
  - `ServerMessage = { type: 'hello'; role: Role; now: number } | { type: 'time'; now: number }`
  - `TIME_REQUEST: string` (`'{"type":"time?"}'`)
  - `parseServerMessage(raw: string): ServerMessage | null`
  - `isTimeRequest(raw: string): boolean`

- [ ] **Step 1: Write the failing tests.**
  - Append to `packages/core/test/tools-structure.test.ts`. It reuses `ctx`, `at` and `idle`; shape `a` spans x 1000..1100, y 0..50.

```ts
describe('comment tool', () => {
  it('anchors a comment to the shape under the pointer, relative to its top-left', () => {
    const r = step(idle('comment', []), { type: 'pointerDown', p: at(1010, 20, { hitId: 'a' }) }, ctx());
    expect(r.state).toEqual(idle('comment', []));
    expect(r.effects).toEqual([
      { type: 'compose', anchor: { shapeId: 'a', dx: 10, dy: 20 }, at: { x: 1010, y: 20 } },
    ]);
  });

  it('anchors to the world point on empty canvas', () => {
    const r = step(idle('comment', []), { type: 'pointerDown', p: at(-40, 900) }, ctx());
    expect(r.effects).toEqual([{ type: 'compose', anchor: { x: -40, y: 900 }, at: { x: -40, y: 900 } }]);
  });
});
```

  - Create `packages/core/test/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isTimeRequest, parseServerMessage, TIME_REQUEST } from '../src';

describe('server messages', () => {
  it('parses hello and time', () => {
    expect(parseServerMessage('{"type":"hello","role":"view","now":5}')).toEqual({
      type: 'hello',
      role: 'view',
      now: 5,
    });
    expect(parseServerMessage('{"type":"time","now":7}')).toEqual({ type: 'time', now: 7 });
  });

  it('ignores malformed or unknown messages', () => {
    for (const raw of [
      'nope',
      '{"type":"hello","role":"admin","now":5}',
      '{"type":"time","now":"7"}',
      '{"type":"time"}',
      '{"type":"other","now":1}',
      'null',
    ]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });

  it('recognises the time request', () => {
    expect(isTimeRequest(TIME_REQUEST)).toBe(true);
    expect(isTimeRequest('{"type":"time"}')).toBe(false);
    expect(isTimeRequest('garbage')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/core -- tools-structure messages`
Expected: FAIL.

- [ ] **Step 3: Implement the protocol.** Create `packages/core/src/sync/messages.ts`:

```ts
/** A connection's capability, as the server reports it in `hello`. */
export type Role = 'edit' | 'view';

/** Custom messages the room sends over y-partyserver's `__YPS:` channel. */
export type ServerMessage = { type: 'hello'; role: Role; now: number } | { type: 'time'; now: number };

/** What the client sends to refresh its clock offset. */
export const TIME_REQUEST = JSON.stringify({ type: 'time?' });

const parse = (raw: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export function parseServerMessage(raw: string): ServerMessage | null {
  const o = parse(raw);
  if (!o || typeof o.now !== 'number' || !Number.isFinite(o.now)) return null;
  if (o.type === 'time') return { type: 'time', now: o.now };
  if (o.type === 'hello' && (o.role === 'edit' || o.role === 'view')) {
    return { type: 'hello', role: o.role, now: o.now };
  }
  return null;
}

export const isTimeRequest = (raw: string): boolean => parse(raw)?.type === 'time?';
```

  Add `export * from './sync/messages';` to `packages/core/src/index.ts`.

- [ ] **Step 4: Implement the comment tool.** In `packages/core/src/tools/machine.ts`:
  1. Add `| 'comment'` to `ToolId`.
  2. Add `type CommentAnchor` to the `../schema/types` import.
  3. Add to `Effect`:

```ts
  /** The comment tool asks the UI to open a composer anchored here. */
  | { type: 'compose'; anchor: CommentAnchor; at: Point }
```

  4. In `pointerDownIdle`, add this case before the `'rect'` group:

```ts
    case 'comment': {
      const s = p.hitId ? ctx.shapes[p.hitId] : undefined;
      const anchor: CommentAnchor = s
        ? { shapeId: s.id, dx: p.world.x - s.x, dy: p.world.y - s.y }
        : { x: p.world.x, y: p.world.y };
      return { state: idle('comment', []), effects: [{ type: 'compose', anchor, at: p.world }] };
    }
```

- [ ] **Step 5: Run the checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.
  - If the web `controller.ts` `run` switch fails typecheck because the new `compose` effect is unhandled, add `case 'compose': break;` there. Task 6 fills it in.

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/web/src/board/controller.ts
git commit -m "feat(core): comment tool with shape/world anchors; server message protocol"
```

---

### Task 4: Server hello and time

**Files:**
- Modify: `apps/sync-server/src/room.ts`
- Test: `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Consumes: `isTimeRequest` and `ServerMessage` from `@relay/core` (Task 3). y-partyserver's `sendCustomMessage(connection, message)` and the `onCustomMessage(connection, message)` override.
- Produces: `__YPS:{"type":"hello","role":…,"now":…}` on every accepted connect, and `__YPS:{"type":"time","now":…}` in reply to `__YPS:{"type":"time?"}`.

- [ ] **Step 1: Write the failing test.** In `apps/sync-server/test/integration.test.ts`:
  - Add this helper next to `waitForOpen`:

```ts
/** Resolves with the next custom (`__YPS:`) JSON message on a raw socket. */
function nextCustom(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a custom message')), timeoutMs);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      const text = data.toString();
      if (!text.startsWith('__YPS:')) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(JSON.parse(text.slice(6)) as Record<string, unknown>);
    };
    ws.on('message', onMessage);
  });
}
```

  - Add this test inside the main `describe`:

```ts
  it('says hello with the role and server time, and answers time requests', async () => {
    const { roomId, editKey, viewKey } = await createRoom();
    const editor = rawConnect(roomId, { key: editKey });
    const hello = nextCustom(editor);
    await waitForOpen(editor);
    const h = await hello;
    expect(h.type).toBe('hello');
    expect(h.role).toBe('edit');
    expect(Math.abs((h.now as number) - Date.now())).toBeLessThan(5000);

    const time = nextCustom(editor);
    editor.send('__YPS:{"type":"time?"}');
    const t = await time;
    expect(t.type).toBe('time');
    expect(typeof t.now).toBe('number');

    const viewer = rawConnect(roomId, { key: viewKey });
    const viewerHello = nextCustom(viewer);
    await waitForOpen(viewer);
    expect((await viewerHello).role).toBe('view');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL, timing out waiting for the custom message.

- [ ] **Step 3: Implement.** In `apps/sync-server/src/room.ts`:
  - Add `import { isTimeRequest, type ServerMessage } from '@relay/core';`. Merge it into the existing `@relay/core` import.
  - Add a module-level helper:

```ts
const encode = (message: ServerMessage): string => JSON.stringify(message);
```

  - In `onConnect`, after `super.onConnect(connection, ctx);`, add:

```ts
    // Tell the client its capability and the server clock (vote timers use server time).
    this.sendCustomMessage(connection, encode({ type: 'hello', role, now: Date.now() }));
```

  - Add the method:

```ts
  onCustomMessage(connection: Connection, message: string): void {
    if (!roleOf(connection)) return;
    if (isTimeRequest(message)) {
      this.sendCustomMessage(connection, encode({ type: 'time', now: Date.now() }));
    }
  }
```

  Custom messages already pass through `onMessage`'s role, size and rate-limit checks before `super.onMessage` dispatches them. Check this in the code and name it in the report.

- [ ] **Step 4: Run the checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/sync-server
git commit -m "feat(sync-server): hello with role and server time; answer time requests"
```

---

### Task 5: Client clock and the activity store

**Files:**
- Create: `apps/web/src/sync/clock.ts`
- Modify: `apps/web/src/sync/connection.ts`
- Create: `apps/web/src/store/activityStore.ts`
- Modify: `apps/web/src/store/docStore.ts` (export `touchedIds`)
- Test: `apps/web/test/clock.test.ts`, `apps/web/test/activityStore.test.ts` (create)

**Interfaces:**
- Consumes: `parseServerMessage`, `TIME_REQUEST`, `Role` (Task 3); `readVote`, `readComment`, `getRoots` (Task 1).
- Produces:
  - `ClockState { role: Role | null; offset: number }`
  - `nextClock(prev: ClockState, msg: ServerMessage, localNow: number): ClockState`
  - `TIME_REFRESH_MS = 300_000`
  - `RoomConnection` gains `clock: StoreApi<ClockState>` and `serverNow(): number`.
  - `ActivityState { vote: VoteState | null; voteKeys: string[]; comments: Record<string, CommentThread>; commentOrder: string[] }`. `commentOrder` is newest first, by `createdAt`, then id.
  - `createActivityStore(doc: Y.Doc): { store: StoreApi<ActivityState>; destroy(): void }`
  - `touchedIds` is exported from docStore.ts.

- [ ] **Step 1: Write the failing tests**
  - `apps/web/test/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextClock } from '../src/sync/clock';

describe('clock', () => {
  it('hello sets the role and the offset', () => {
    expect(nextClock({ role: null, offset: 0 }, { type: 'hello', role: 'edit', now: 10_500 }, 10_000)).toEqual({
      role: 'edit',
      offset: 500,
    });
  });

  it('time refreshes the offset and keeps the role', () => {
    expect(nextClock({ role: 'view', offset: 500 }, { type: 'time', now: 20_000 }, 20_100)).toEqual({
      role: 'view',
      offset: -100,
    });
  });
});
```

  - `apps/web/test/activityStore.test.ts`:

```ts
import { applyCommand, SESSION_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createActivityStore } from '../src/store/activityStore';

const entry = (id: string) => ({ id, authorId: 'u1', author: 'A', body: id, ts: 1 });

describe('activity store', () => {
  it('projects the vote and the sorted vote keys', () => {
    const doc = new Y.Doc();
    const { store } = createActivityStore(doc);
    applyCommand(doc, { type: 'StartVote', endsAt: 99, maxPerUser: 3, startedBy: 'u1' }, SESSION_ORIGIN);
    applyCommand(doc, { type: 'CastVote', shapeId: 's2', userId: 'u1' }, SESSION_ORIGIN);
    applyCommand(doc, { type: 'CastVote', shapeId: 's1', userId: 'u1' }, SESSION_ORIGIN);
    expect(store.getState().vote).toEqual({ open: true, endsAt: 99, maxPerUser: 3, startedBy: 'u1' });
    expect(store.getState().voteKeys).toEqual(['s1:u1', 's2:u1']);
  });

  it('projects threads newest first and keeps untouched threads identical', () => {
    const doc = new Y.Doc();
    const { store } = createActivityStore(doc);
    const add = (id: string, createdAt: number) =>
      applyCommand(
        doc,
        { type: 'AddComment', id, anchor: { x: 0, y: 0 }, createdBy: 'u1', createdAt, entry: entry(`${id}-e`) },
        SESSION_ORIGIN,
      );
    add('c1', 1);
    add('c2', 2);
    expect(store.getState().commentOrder).toEqual(['c2', 'c1']);
    const c1 = store.getState().comments.c1;
    applyCommand(doc, { type: 'ReplyComment', commentId: 'c2', entry: entry('r') }, SESSION_ORIGIN);
    expect(store.getState().comments.c2?.entries.length).toBe(2);
    expect(store.getState().comments.c1).toBe(c1);
    applyCommand(doc, { type: 'ResolveComment', id: 'c1', resolved: true }, SESSION_ORIGIN);
    expect(store.getState().comments.c1?.resolved).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- clock activityStore`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Create `apps/web/src/sync/clock.ts`**

```ts
import type { Role, ServerMessage } from '@relay/core';

export interface ClockState {
  /** Capability from the server's hello; null until the first hello arrives. */
  role: Role | null;
  /** serverNow = Date.now() + offset. Error is at most the one-way latency. */
  offset: number;
}

/** How often the client asks for the server time while online. */
export const TIME_REFRESH_MS = 300_000;

export function nextClock(prev: ClockState, msg: ServerMessage, localNow: number): ClockState {
  const offset = msg.now - localNow;
  return msg.type === 'hello' ? { role: msg.role, offset } : { role: prev.role, offset };
}
```

- [ ] **Step 4: Wire the connection.** In `apps/web/src/sync/connection.ts`:
  - Add `import { parseServerMessage, TIME_REQUEST } from '@relay/core';` and `import { type ClockState, nextClock, TIME_REFRESH_MS } from './clock';`.
  - Add these members to `RoomConnection`:

```ts
  clock: StoreApi<ClockState>;
  /** Current server time in epoch ms (local time until the first hello). */
  serverNow(): number;
```

  - In `connectRoom`, after the status handlers, add:

```ts
  const clock = createStore<ClockState>(() => ({ role: null, offset: 0 }));
  provider.on('custom-message', (raw: string) => {
    const msg = parseServerMessage(raw);
    if (msg) clock.setState(nextClock(clock.getState(), msg, Date.now()));
  });
  const refresh = setInterval(() => {
    if (status.getState().status === 'online') provider.sendMessage(TIME_REQUEST);
  }, TIME_REFRESH_MS);
```

  - Return `clock` and `serverNow: () => Date.now() + clock.getState().offset`.
  - In `destroy()`, call `clearInterval(refresh);` first.
  - If the provider's typed events reject `'custom-message'`, type the handler to its declared signature (see node_modules/y-partyserver/dist/provider/index.d.ts). Never cast to `any`.

- [ ] **Step 5: Create the activity store.**
  - In `apps/web/src/store/docStore.ts`, change `function touchedIds` to `export function touchedIds`.
  - Create `apps/web/src/store/activityStore.ts`:

```ts
import { type CommentThread, getRoots, readComment, readVote, type VoteState } from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { touchedIds } from './docStore';

export interface ActivityState {
  vote: VoteState | null;
  /** Keys of the flat `votes` map, sorted. */
  voteKeys: string[];
  comments: Record<string, CommentThread>;
  /** Thread ids, newest first (createdAt, then id). */
  commentOrder: string[];
}

const order = (comments: Record<string, CommentThread>) =>
  Object.values(comments)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .map((c) => c.id);

/** Projects votes and comment threads, rebuilding only the threads a transaction touched. */
export function createActivityStore(doc: Y.Doc): { store: StoreApi<ActivityState>; destroy(): void } {
  const { session, votes, comments } = getRoots(doc);
  const threads: Record<string, CommentThread> = {};
  const rebuild = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = comments.get(id);
      const thread = m ? readComment(id, m) : null;
      if (thread) threads[id] = thread;
      else delete threads[id];
    }
  };
  rebuild(comments.keys());
  const store = createStore<ActivityState>(() => ({
    vote: readVote(session),
    voteKeys: [...votes.keys()].sort(),
    comments: { ...threads },
    commentOrder: order(threads),
  }));

  const onSession = () => store.setState({ vote: readVote(session) });
  const onVotes = () => store.setState({ voteKeys: [...votes.keys()].sort() });
  const onComments = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuild(touchedIds(events, comments));
    store.setState({ comments: { ...threads }, commentOrder: order(threads) });
  };
  session.observe(onSession);
  votes.observe(onVotes);
  comments.observeDeep(onComments);
  return {
    store,
    destroy() {
      session.unobserve(onSession);
      votes.unobserve(onVotes);
      comments.unobserveDeep(onComments);
    },
  };
}
```

- [ ] **Step 6: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/sync apps/web/src/store apps/web/test/clock.test.ts apps/web/test/activityStore.test.ts
git commit -m "feat(web): server clock with role, and a projected activity store for votes and comments"
```

---

### Task 6: Controller session actions, UI state and wiring

**Files:**
- Modify: `apps/web/src/board/controller.ts`
- Modify: `apps/web/src/board/session.ts`
- Modify: `apps/web/src/ui/shortcuts.ts`
- Test: `apps/web/test/controller.test.ts`, `apps/web/test/shortcuts.test.ts`

**Interfaces:**
- Consumes:
  - `SESSION_ORIGIN`, `VOTES_PER_USER`, `isVoteOpen`, `voteKey`, `voteTallies`, `CommentAnchor`, `Point` (core)
  - `ActivityState` (Task 5)
  - the `compose` effect (Task 3)
- Produces:
  - `BoardUiState` gains:
    - `composer: { anchor: CommentAnchor; at: Point } | null`
    - `openThread: string | null`
    - `commentsPanel: boolean`
  - `createBoardController` opts gain `activity: StoreApi<ActivityState>` (required) and `serverNow?: () => number` (default `Date.now`).
  - `BoardController` gains:
    - `startVote(minutes: number)`
    - `endVote()`
    - `toggleVote(shapeId: string)`
    - `addComment(body: string)`
    - `cancelComposer()`
    - `replyComment(threadId: string, body: string)`
    - `resolveComment(threadId: string, resolved: boolean)`
    - `openThread(id: string | null)`
    - `toggleCommentsPanel()`
  - `BoardSession` gains `activity: StoreApi<ActivityState>`.
  - Shortcut `m` selects `comment`.

- [ ] **Step 1: Write the failing tests.** In `apps/web/test/controller.test.ts`:
  1. Import `createActivityStore` from `'../src/store/activityStore'`.
  2. In `setup`, create `const activity = createActivityStore(doc);` and pass `activity: activity.store`. Also add `serverNow: () => 1_000_000` and return `activity` in the setup result. Change `setup`'s options type to `{ cameraStorage?: CameraStorage; serverNow?: () => number } = {}` and spread the options after the defaults.
  3. Add a `sticky` helper next to `addRect`:

```ts
function addSticky(doc: Y.Doc, id: string, x = 0) {
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id,
      type: 'sticky',
      x,
      y: 0,
      w: 160,
      h: 120,
      style: DEFAULT_STYLE.sticky,
      text: '',
      createdBy: 'u1',
      authorName: 'Brisk Otter',
      createdAt: 0,
    },
  });
}
```

  4. Add:

```ts
describe('voting', () => {
  it('starts a vote on server time, toggles votes, caps at three and ends it', () => {
    const { doc, controller, activity } = setup();
    for (const id of ['a', 'b', 'c', 'd']) addSticky(doc, id);
    controller.startVote(3);
    expect(activity.store.getState().vote).toEqual({
      open: true,
      endsAt: 1_000_000 + 180_000,
      maxPerUser: 3,
      startedBy: 'u1',
    });
    for (const id of ['a', 'b', 'c', 'd']) controller.toggleVote(id);
    expect(activity.store.getState().voteKeys).toEqual(['a:u1', 'b:u1', 'c:u1']);
    controller.toggleVote('a');
    expect(activity.store.getState().voteKeys).toEqual(['b:u1', 'c:u1']);
    controller.endVote();
    expect(activity.store.getState().vote?.open).toBe(false);
    controller.toggleVote('d');
    expect(activity.store.getState().voteKeys).toEqual(['b:u1', 'c:u1']);
  });

  it('refuses votes on non-stickies and outside an open vote, and never enters undo', () => {
    const { doc, controller, activity } = setup();
    addSticky(doc, 'a');
    addRect(doc, 'r', 500, 0);
    controller.toggleVote('a');
    expect(activity.store.getState().voteKeys).toEqual([]);
    controller.startVote(1);
    controller.toggleVote('r');
    controller.toggleVote('a');
    expect(activity.store.getState().voteKeys).toEqual(['a:u1']);
    controller.undo();
    expect(activity.store.getState().voteKeys).toEqual(['a:u1']);
  });
});

describe('comments', () => {
  it('the comment tool opens a composer; posting creates a thread and opens it', () => {
    const { controller, activity } = setup();
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(40, 50) });
    expect(controller.ui.getState().composer).toEqual({ anchor: { x: 40, y: 50 }, at: { x: 40, y: 50 } });
    controller.addComment('  Looks good  ');
    const [id] = activity.store.getState().commentOrder;
    expect(activity.store.getState().comments[id as string]?.entries[0]).toMatchObject({
      authorId: 'u1',
      author: 'Brisk Otter',
      body: 'Looks good',
    });
    expect(controller.ui.getState().composer).toBeNull();
    expect(controller.ui.getState().openThread).toBe(id);
  });

  it('an empty body cancels; replies and resolve work; canvas clicks close popovers', () => {
    const { controller, activity } = setup();
    controller.dispatch({ type: 'setTool', tool: 'comment' });
    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.addComment('   ');
    expect(activity.store.getState().commentOrder).toEqual([]);
    expect(controller.ui.getState().composer).toBeNull();

    controller.dispatch({ type: 'pointerDown', p: at(0, 0) });
    controller.addComment('first');
    const [id] = activity.store.getState().commentOrder as [string];
    controller.replyComment(id, 'second');
    controller.replyComment(id, '  ');
    expect(activity.store.getState().comments[id]?.entries.map((e) => e.body)).toEqual(['first', 'second']);
    controller.resolveComment(id, true);
    expect(activity.store.getState().comments[id]?.resolved).toBe(true);

    controller.dispatch({ type: 'setTool', tool: 'select' });
    controller.dispatch({ type: 'pointerDown', p: at(900, 900) });
    controller.dispatch({ type: 'pointerUp', p: at(900, 900) });
    expect(controller.ui.getState().openThread).toBeNull();
  });

  it('toggles the comments panel', () => {
    const { controller } = setup();
    controller.toggleCommentsPanel();
    expect(controller.ui.getState().commentsPanel).toBe(true);
    controller.toggleCommentsPanel();
    expect(controller.ui.getState().commentsPanel).toBe(false);
  });
});
```

  5. In `apps/web/test/shortcuts.test.ts`, add:

```ts
  it('M selects the comment tool', () => {
    expect(keyDownAction(k('m'), false)).toEqual({
      type: 'dispatch',
      event: { type: 'setTool', tool: 'comment' },
      preventDefault: false,
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- controller shortcuts`
Expected: FAIL.

- [ ] **Step 3: Implement the controller.** In `apps/web/src/board/controller.ts`:
  1. Imports: add these to the `@relay/core` import: `type CommentAnchor`, `isVoteOpen`, `SESSION_ORIGIN`, `voteKey`, `voteTallies`, `VOTES_PER_USER`. Also add `import type { ActivityState } from '../store/activityStore';`.
  2. `BoardUiState` gains:

```ts
  /** Open comment composer (comment tool click). */
  composer: { anchor: CommentAnchor; at: Point } | null;
  /** Thread whose popover is open. */
  openThread: string | null;
  commentsPanel: boolean;
```

  3. `BoardController` gains:

```ts
  startVote(minutes: number): void;
  endVote(): void;
  /** Casts or retracts the local user's vote on a sticky while a vote is open (cap enforced). */
  toggleVote(shapeId: string): void;
  /** Posts the composer's comment (trimmed; empty cancels). */
  addComment(body: string): void;
  cancelComposer(): void;
  replyComment(threadId: string, body: string): void;
  resolveComment(threadId: string, resolved: boolean): void;
  openThread(id: string | null): void;
  toggleCommentsPanel(): void;
```

  4. The options gain `activity: StoreApi<ActivityState>;` and `serverNow?: () => number;`. In the body add `const serverNow = opts.serverNow ?? Date.now;`, and extend the initial ui state with `composer: null, openThread: null, commentsPanel: false`.
  5. Add `const commitSession = (command: Command) => applyCommand(opts.doc, command, SESSION_ORIGIN);`.
  6. In `run`, add:

```ts
        case 'compose':
          ui.setState({ composer: { anchor: effect.anchor, at: effect.at } });
          break;
```

  7. In `dispatch`, after the existing `pointerDown` fit-cancel line, add:

```ts
      // A canvas press closes any open thread popover or composer (the comment tool reopens one).
      if (event.type === 'pointerDown') ui.setState({ openThread: null, composer: null });
```

  8. Add to the returned object:

```ts
    startVote(minutes) {
      commitSession({
        type: 'StartVote',
        endsAt: serverNow() + minutes * 60_000,
        maxPerUser: VOTES_PER_USER,
        startedBy: opts.user.id,
      });
    },
    endVote() {
      commitSession({ type: 'EndVote' });
    },
    toggleVote(shapeId) {
      const { vote, voteKeys } = opts.activity.getState();
      if (!vote || !isVoteOpen(vote, serverNow())) return;
      const shapes = opts.docStore.getState().shapes;
      if (shapes[shapeId]?.type !== 'sticky') return;
      if (voteKeys.includes(voteKey(shapeId, opts.user.id))) {
        commitSession({ type: 'RetractVote', shapeId, userId: opts.user.id });
        return;
      }
      const mine = voteTallies(voteKeys, shapes, vote.maxPerUser).byUser[opts.user.id]?.length ?? 0;
      if (mine >= vote.maxPerUser) return;
      commitSession({ type: 'CastVote', shapeId, userId: opts.user.id });
    },
    addComment(body) {
      const composer = ui.getState().composer;
      const text = body.trim();
      ui.setState({ composer: null });
      if (!composer || !text) return;
      const id = newId();
      commitSession({
        type: 'AddComment',
        id,
        anchor: composer.anchor,
        createdBy: opts.user.id,
        createdAt: now(),
        entry: { id: newId(), authorId: opts.user.id, author: opts.user.name, body: text, ts: now() },
      });
      ui.setState({ openThread: id });
    },
    cancelComposer() {
      ui.setState({ composer: null });
    },
    replyComment(threadId, body) {
      const text = body.trim();
      if (!text) return;
      commitSession({
        type: 'ReplyComment',
        commentId: threadId,
        entry: { id: newId(), authorId: opts.user.id, author: opts.user.name, body: text, ts: now() },
      });
    },
    resolveComment(threadId, resolved) {
      commitSession({ type: 'ResolveComment', id: threadId, resolved });
    },
    openThread(id) {
      ui.setState({ openThread: id });
    },
    toggleCommentsPanel() {
      ui.setState({ commentsPanel: !ui.getState().commentsPanel });
    },
```

  Remove the placeholder `case 'compose': break;` from Task 3 if it exists.

- [ ] **Step 4: Wire the session.** In `apps/web/src/board/session.ts`:
  - Import `createActivityStore` and `type ActivityState` from `'../store/activityStore'`.
  - `BoardSession` gains `activity: StoreApi<ActivityState>;`.
  - Before creating the controller, add `const activity = createActivityStore(conn.doc);`.
  - Pass `activity: activity.store` and `serverNow: conn.serverNow` to the controller.
  - Return `activity: activity.store`.
  - In `destroy()`, call `activity.destroy();` just before `docStore.destroy();`.

- [ ] **Step 5: Add the shortcut.** In `apps/web/src/ui/shortcuts.ts`, add `m: 'comment',` to `TOOL_KEYS`.

- [ ] **Step 6: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "feat(web): controller voting and comment actions on the SESSION origin"
```

---

### Task 7: Voting UI

**Files:**
- Create: `apps/web/src/render/voting.ts`
- Create: `apps/web/src/ui/VoteControl.tsx`
- Create: `apps/web/src/render/VoteBadge.tsx`
- Modify: `apps/web/src/ui/Header.tsx`
- Modify: `apps/web/src/render/ShapeView.tsx`

**Interfaces:**
- Consumes:
  - `isVoteOpen`, `voteTallies`, `VOTE_DURATIONS_MIN` and `PALETTE` (core)
  - `session.activity`, `session.conn.clock` and `session.conn.serverNow`
  - `controller.startVote`, `controller.endVote` and `controller.toggleVote`
- Produces test ids:
  - `vote-start`
  - `vote-1m`, `vote-3m`, `vote-5m`
  - `vote-status`: text `VOTE OPEN · m:ss · N left` or `VOTE ENDED`
  - `vote-end`
  - `vote-badge`: one per sticky, text `● n`, with `data-vote-id` and `data-mine="true|false"`

- [ ] **Step 1: Create `apps/web/src/render/voting.ts`**

```ts
import { isVoteOpen, type Shape, type Tallies, voteTallies } from '@relay/core';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

let last: { keys: string[]; shapes: Record<string, Shape>; max: number; result: Tallies } | null =
  null;

/**
 * Tallies for the current stores. The stores replace `voteKeys`/`shapes` only on change,
 * so one cached result serves every badge rendered for the same state.
 */
export function cachedTallies(keys: string[], shapes: Record<string, Shape>, max: number): Tallies {
  if (last && last.keys === keys && last.shapes === shapes && last.max === max) return last.result;
  const result = voteTallies(keys, shapes, max);
  last = { keys, shapes, max, result };
  return result;
}

/** True while the vote is open; re-renders exactly when the deadline passes (server time). */
export function useVoteOpen(session: BoardSession): boolean {
  const vote = useStore(session.activity, (a) => a.vote);
  const [, expire] = useState(0);
  const open = isVoteOpen(vote, session.conn.serverNow());
  useEffect(() => {
    if (!open || !vote) return;
    const t = setTimeout(() => expire((n) => n + 1), vote.endsAt - session.conn.serverNow() + 50);
    return () => clearTimeout(t);
  }, [open, vote, session]);
  return open;
}

/** Server time, re-read every 250 ms while `active` (for the header countdown). */
export function useServerNow(session: BoardSession, active: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
  return session.conn.serverNow();
}
```

  Also export `Tallies` from `@relay/core`. It is already exported, because `schema/session.ts` exports the interface; confirm this.

- [ ] **Step 2: Create `apps/web/src/ui/VoteControl.tsx`**

```tsx
import { isVoteOpen, VOTE_DURATIONS_MIN } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { cachedTallies, useServerNow } from '../render/voting';

const pill = 'border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase';

export function VoteControl({ session }: { session: BoardSession }) {
  const { controller } = session;
  const vote = useStore(session.activity, (a) => a.vote);
  const keys = useStore(session.activity, (a) => a.voteKeys);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const role = useStore(session.conn.clock, (c) => c.role);
  const [picking, setPicking] = useState(false);
  const now = useServerNow(session, vote?.open ?? false);
  const canEdit = role === 'edit';

  if (vote && isVoteOpen(vote, now)) {
    const mine = cachedTallies(keys, shapes, vote.maxPerUser).byUser[session.user.id]?.length ?? 0;
    const left = Math.max(0, vote.endsAt - now);
    const mm = Math.floor(left / 60_000);
    const ss = String(Math.floor(left / 1000) % 60).padStart(2, '0');
    return (
      <div className="flex items-center gap-1.5">
        <span data-testid="vote-status" className={`${pill} bg-sun`}>
          {`VOTE OPEN · ${mm}:${ss} · ${Math.max(0, vote.maxPerUser - mine)} left`}
        </span>
        {canEdit && (
          <button
            type="button"
            data-testid="vote-end"
            className={`${pill} bg-white hover:bg-paper`}
            onClick={() => controller.endVote()}
          >
            End
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1.5">
      {vote && (
        <span data-testid="vote-status" className={`${pill} bg-paper`}>
          VOTE ENDED
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          data-testid="vote-start"
          aria-expanded={picking}
          className={`${pill} bg-white hover:bg-sun`}
          onClick={() => setPicking((p) => !p)}
        >
          Vote
        </button>
      )}
      {picking && canEdit && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 flex gap-1 border-2 border-ink bg-white p-1 shadow-hard"
        >
          {VOTE_DURATIONS_MIN.map((min) => (
            <button
              key={min}
              type="button"
              role="menuitem"
              data-testid={`vote-${min}m`}
              className={`${pill} hover:bg-sun`}
              onClick={() => {
                controller.startVote(min);
                setPicking(false);
              }}
            >
              {`${min} min`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/render/VoteBadge.tsx`**

```tsx
import { PALETTE, type Shape } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { cachedTallies, useVoteOpen } from './voting';

/** `● n` on a sticky: its own hit target, so voting never selects or drags the sticky. */
export function VoteBadge({ s, session }: { s: Shape; session: BoardSession }) {
  const vote = useStore(session.activity, (a) => a.vote);
  const keys = useStore(session.activity, (a) => a.voteKeys);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const role = useStore(session.conn.clock, (c) => c.role);
  const open = useVoteOpen(session);
  if (!vote) return null;
  const t = cachedTallies(keys, shapes, vote.maxPerUser);
  const count = t.counts[s.id] ?? 0;
  if (!open && count === 0) return null;
  const mine = t.byUser[session.user.id]?.includes(s.id) ?? false;
  const clickable = open && role === 'edit';
  return (
    <g
      data-testid="vote-badge"
      data-vote-id={s.id}
      data-mine={mine}
      transform={`translate(${s.x + s.w - 44} ${s.y + s.h - 28})`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onPointerDown={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        e.preventDefault();
        session.controller.toggleVote(s.id);
      }}
    >
      <rect width={36} height={20} fill={mine ? PALETTE.cobalt : PALETTE.white} stroke={PALETTE.ink} strokeWidth={2} />
      <text
        x={18}
        y={14}
        textAnchor="middle"
        className="font-mono"
        fontSize={11}
        fontWeight={700}
        fill={mine ? PALETTE.white : PALETTE.ink}
      >
        {`● ${count}`}
      </text>
    </g>
  );
}
```

- [ ] **Step 4: Mount them.**
  - In `apps/web/src/render/ShapeView.tsx`, import `VoteBadge` and render `<VoteBadge s={s} session={session} />` as the last child of the `'sticky'` case fragment, after its `</foreignObject>`.
  - In `apps/web/src/ui/Header.tsx`, import `VoteControl` and render `<VoteControl session={session} />` as the first child of the right-hand `<div className="flex items-center gap-2">`.

- [ ] **Step 5: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green. The controller verifies the behaviour in the browser, and Task 9 adds the e2e.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): header vote control with server-time countdown and sticky vote badges"
```

---

### Task 8: Comments UI

**Files:**
- Create:
  - `apps/web/src/render/CommentLayer.tsx`
  - `apps/web/src/render/CommentComposer.tsx`
  - `apps/web/src/ui/CommentsPanel.tsx`
- Modify:
  - `apps/web/src/ui/Toolbar.tsx`
  - `apps/web/src/ui/Header.tsx`
  - `apps/web/src/board/Board.tsx`

**Interfaces:**
- Consumes:
  - `commentPoint`, `worldToScreen`, `CommentThread` (core)
  - `session.activity`, `session.conn.clock`, `controller.ui` (`composer`, `openThread`, `commentsPanel`, `overlay`, `camera`)
  - `session.doc`
  - the Task 6 controller actions
- Produces test ids:
  - `tool-comment`, hidden unless role is `edit`
  - `comment-composer`, a textarea
  - `comment-pin`, with `data-comment-id` and text = entry count
  - `comment-thread`, the popover
  - `comment-entry`
  - `comment-reply`, a textarea
  - `comment-resolve`, text `Resolve` or `Reopen`
  - `comments-toggle`, text `Comments · N`
  - `comments-panel`
  - `comments-tab-open` and `comments-tab-resolved`
  - `comment-item`

- [ ] **Step 1: Add the comment tool to the toolbar.** In `apps/web/src/ui/Toolbar.tsx`:
  - Add `MessageCircle` to the lucide import.
  - Append `{ id: 'comment', label: 'Comment', key: 'M', Icon: MessageCircle }` to `TOOLS`.
  - Inside `Toolbar`, add `const role = useStore(session.conn.clock, (c) => c.role);`.
  - Map over `TOOLS.filter((t) => t.id !== 'comment' || role === 'edit')`.

- [ ] **Step 2: Create `apps/web/src/render/CommentComposer.tsx`**

```tsx
import { worldToScreen } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function CommentComposer({ session }: { session: BoardSession }) {
  const { controller } = session;
  const composer = useStore(controller.ui, (s) => s.composer);
  const camera = useStore(controller.ui, (s) => s.camera);
  const role = useStore(session.conn.clock, (c) => c.role);
  if (!composer || role !== 'edit') return null;
  const p = worldToScreen(camera, composer.at);
  return (
    <div
      className="absolute left-0 top-0 z-20 w-64 border-2 border-ink bg-white p-2 shadow-hard"
      style={{ transform: `translate(${p.x + 12}px, ${p.y - 8}px)` }}
    >
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the composer exists to be typed into right away
        autoFocus
        data-testid="comment-composer"
        aria-label="New comment"
        rows={3}
        placeholder="Add a comment… (Enter to post)"
        className="w-full resize-none bg-transparent font-mono text-xs outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            controller.addComment(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            controller.cancelComposer();
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/render/CommentLayer.tsx`**

```tsx
import { type CommentThread, commentPoint, worldToScreen } from '@relay/core';
import { MessageCircle } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

function Thread({ session, thread }: { session: BoardSession; thread: CommentThread }) {
  const { controller } = session;
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  return (
    <div
      data-testid="comment-thread"
      className="absolute top-8 left-0 z-20 w-72 border-2 border-ink bg-white shadow-hard"
    >
      <ul className="max-h-64 overflow-y-auto">
        {thread.entries.map((e) => (
          <li key={e.id} data-testid="comment-entry" className="border-b border-ink/15 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-ink/60">{`${e.author} · ${ago(e.ts)}`}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{e.body}</p>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex items-end gap-2 p-2">
          <textarea
            data-testid="comment-reply"
            aria-label="Reply"
            rows={2}
            placeholder="Reply… (Enter to send)"
            className="flex-1 resize-none border-2 border-ink/30 px-2 py-1 font-mono text-xs outline-none focus:border-ink"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                controller.replyComment(thread.id, e.currentTarget.value);
                e.currentTarget.value = '';
              } else if (e.key === 'Escape') {
                controller.openThread(null);
              }
            }}
          />
          <button
            type="button"
            data-testid="comment-resolve"
            className="border-2 border-ink px-2 py-1 font-mono text-[11px] font-bold uppercase hover:bg-sun"
            onClick={() => {
              controller.resolveComment(thread.id, !thread.resolved);
              controller.openThread(null);
            }}
          >
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Speech-bubble pins in screen space for open threads; they follow shapes during local drags. */
export function CommentLayer({ session }: { session: BoardSession }) {
  const { controller } = session;
  const comments = useStore(session.activity, (a) => a.comments);
  const order = useStore(session.activity, (a) => a.commentOrder);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const overlay = useStore(controller.ui, (s) => s.overlay);
  const camera = useStore(controller.ui, (s) => s.camera);
  const openId = useStore(controller.ui, (s) => s.openThread);
  const live = overlay ? { ...shapes, ...overlay } : shapes;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {order.map((id) => {
        const thread = comments[id];
        if (!thread) return null;
        const open = openId === id;
        if (thread.resolved && !open) return null;
        const point = commentPoint(thread.anchor, live);
        if (!point) return null;
        const p = worldToScreen(camera, point);
        return (
          <div
            key={id}
            className="pointer-events-auto absolute left-0 top-0"
            style={{ transform: `translate(${p.x}px, ${p.y - 28}px)` }}
          >
            <button
              type="button"
              data-testid="comment-pin"
              data-comment-id={id}
              aria-label={`Comment thread (${thread.entries.length})`}
              aria-expanded={open}
              className={`flex h-7 items-center gap-1 border-2 border-ink px-1.5 font-mono text-[11px] font-bold shadow-hard ${open ? 'bg-sun' : 'bg-white'}`}
              onClick={() => controller.openThread(open ? null : id)}
            >
              <MessageCircle size={12} />
              {thread.entries.length}
            </button>
            {open && <Thread session={session} thread={thread} />}
          </div>
        );
      })}
    </div>
  );
}
```

  The overlay values are `Rect`s merged over `Shape`s, so `commentPoint` only needs `x` and `y`. If typecheck rejects the spread, build `live` as `Record<string, { x: number; y: number }>`.

- [ ] **Step 4: Create `apps/web/src/ui/CommentsPanel.tsx`**

```tsx
import { commentPoint } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function CommentsPanel({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.commentsPanel);
  const comments = useStore(session.activity, (a) => a.comments);
  const order = useStore(session.activity, (a) => a.commentOrder);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  if (!open) return null;
  const threads = order
    .map((id) => comments[id])
    .filter((t) => t !== undefined && t.resolved === (tab === 'resolved'));
  const tabClass = (t: 'open' | 'resolved') =>
    `flex-1 py-1.5 font-mono text-[11px] font-bold uppercase ${tab === t ? 'bg-sun' : 'bg-white hover:bg-paper'}`;

  return (
    <aside
      data-testid="comments-panel"
      aria-label="Comments"
      className="absolute top-3 right-3 bottom-44 z-10 flex w-72 flex-col border-[3px] border-ink bg-white shadow-hard"
    >
      <div className="flex border-b-2 border-ink">
        <button type="button" data-testid="comments-tab-open" className={tabClass('open')} onClick={() => setTab('open')}>
          Open
        </button>
        <button
          type="button"
          data-testid="comments-tab-resolved"
          className={`${tabClass('resolved')} border-l-2 border-ink`}
          onClick={() => setTab('resolved')}
        >
          Resolved
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {threads.length === 0 && <li className="p-3 font-mono text-xs text-ink/60">Nothing here yet.</li>}
        {threads.map((t) => {
          if (!t) return null;
          const point = commentPoint(t.anchor, shapes);
          const first = t.entries[0];
          return (
            <li key={t.id} className="border-b border-ink/15">
              <button
                type="button"
                data-testid="comment-item"
                className="w-full px-3 py-2 text-left hover:bg-paper"
                onClick={() => {
                  if (point) controller.centerOn(point);
                  controller.openThread(t.id);
                }}
              >
                <p className="font-mono text-[10px] uppercase text-ink/60">
                  {`${first?.author ?? ''} · ${t.entries.length} ${t.entries.length === 1 ? 'message' : 'messages'}`}
                  {point ? '' : ' · (shape deleted)'}
                </p>
                <p className="line-clamp-2 text-sm">{first?.body}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 5: Add the header toggle.** In `apps/web/src/ui/Header.tsx`:
  - Add `const openThreads = useStore(session.activity, (a) => Object.values(a.comments).filter((c) => !c.resolved).length);` and `const panelOpen = useStore(session.controller.ui, (s) => s.commentsPanel);`.
  - Render this right after `<VoteControl … />`:

```tsx
        <button
          type="button"
          data-testid="comments-toggle"
          aria-pressed={panelOpen}
          className={`border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${panelOpen ? 'bg-sun' : 'bg-white hover:bg-paper'}`}
          onClick={() => session.controller.toggleCommentsPanel()}
        >
          {`Comments · ${openThreads}`}
        </button>
```

- [ ] **Step 6: Mount the layers.** In `apps/web/src/board/Board.tsx`, import the three components and render them in this order:
  - `<CommentLayer session={session} />` right after `<RemoteCursors session={session} />`
  - `<CommentComposer session={session} />` after `<ColumnTitleEditor … />`
  - `<CommentsPanel session={session} />` after `<Minimap … />`

- [ ] **Step 7: Run the checks.** Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build -w @relay/web`. Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): comment tool, pins with thread popover, composer and comments panel"
```

---

### Task 9: End-to-end session coverage

**Files:**
- Create: `e2e/session.spec.ts`

**Interfaces:**
- Consumes: the Task 7 and Task 8 test ids, and `POST /api/rooms` (`editKey`, `viewKey`).

- [ ] **Step 1: Write `e2e/session.spec.ts`**

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function sticky(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press('s');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test('two users vote with a shared countdown, capped at three votes, and results survive the end', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await sticky(page, 300, 300, 'One');
  await sticky(page, 520, 300, 'Two');

  await page.getByTestId('vote-start').click();
  await page.getByTestId('vote-3m').click();
  await expect(page.getByTestId('vote-status')).toContainText('VOTE OPEN · 2:5');
  await expect(pb.getByTestId('vote-status')).toContainText('3 left');

  const badges = pb.getByTestId('vote-badge');
  await expect(badges).toHaveCount(2);
  await badges.nth(0).click();
  await badges.nth(1).click();
  await expect(pb.getByTestId('vote-status')).toContainText('1 left');
  await expect(page.getByTestId('vote-badge').nth(0)).toContainText('● 1');
  await badges.nth(0).click();
  await expect(page.getByTestId('vote-badge').nth(0)).toContainText('● 0');
  await expect(pb.getByTestId('vote-badge').nth(0)).toHaveAttribute('data-mine', 'false');

  // Voting does not select or drag the sticky.
  await expect(pb.getByTestId('selection-outline')).toHaveCount(0);

  await page.getByTestId('vote-end').click();
  await expect(pb.getByTestId('vote-status')).toHaveText('VOTE ENDED');
  await expect(pb.getByTestId('vote-badge')).toHaveCount(1);
  await expect(pb.getByTestId('vote-badge')).toContainText('● 1');
  await other.close();
});

test('a comment thread is created, answered, resolved and reopened across users', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey } = await newRoom(request);
  const path = `/r/${roomId}#k=${editKey}`;
  await openBoard(page, path);
  const other = await browser.newContext();
  const pb = await other.newPage();
  await openBoard(pb, path);

  await sticky(page, 400, 300, 'Ship it');
  await page.keyboard.press('m');
  await page.mouse.click(420, 280);
  await page.getByTestId('comment-composer').fill('Needs a test');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('comment-thread')).toContainText('Needs a test');
  // Close A's popover (an open thread stays visible even once resolved): select tool, click empty canvas.
  await page.keyboard.press('v');
  await page.mouse.click(900, 600);
  await expect(page.getByTestId('comment-thread')).toHaveCount(0);

  await expect(pb.getByTestId('comment-pin')).toHaveCount(1);
  await pb.getByTestId('comment-pin').click();
  await pb.getByTestId('comment-reply').fill('On it');
  await pb.keyboard.press('Enter');
  await expect(page.getByTestId('comment-pin')).toContainText('2');
  await expect(page.getByTestId('comments-toggle')).toHaveText('Comments · 1');

  await pb.getByTestId('comment-resolve').click();
  await expect(page.getByTestId('comment-pin')).toHaveCount(0);
  await expect(page.getByTestId('comments-toggle')).toHaveText('Comments · 0');

  await page.getByTestId('comments-toggle').click();
  await page.getByTestId('comments-tab-resolved').click();
  await expect(page.getByTestId('comment-item')).toContainText('Needs a test');
  await page.getByTestId('comment-item').click();
  await expect(page.getByTestId('comment-resolve')).toHaveText('Reopen');
  await page.getByTestId('comment-resolve').click();
  await expect(pb.getByTestId('comment-pin')).toHaveCount(1);
  await other.close();
});

test('a read-only link sees votes and comments but cannot vote or comment', async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await sticky(page, 400, 300, 'Hello');
  await page.keyboard.press('m');
  await page.mouse.click(420, 280);
  await page.getByTestId('comment-composer').fill('Visible to viewers');
  await page.keyboard.press('Enter');
  await page.getByTestId('vote-start').click();
  await page.getByTestId('vote-1m').click();

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  await expect(viewer.getByTestId('vote-status')).toContainText('VOTE OPEN');
  await expect(viewer.getByTestId('vote-start')).toHaveCount(0);
  await expect(viewer.getByTestId('tool-comment')).toHaveCount(0);
  await viewer.getByTestId('vote-badge').click();
  await expect(page.getByTestId('vote-badge')).toContainText('● 0');
  await viewer.getByTestId('comment-pin').click();
  await expect(viewer.getByTestId('comment-thread')).toContainText('Visible to viewers');
  await expect(viewer.getByTestId('comment-reply')).toHaveCount(0);
  await viewerCtx.close();
});
```

- [ ] **Step 2: Run the e2e suite.** Run `npm run e2e`. Expected: all pass (13 existing + 3 new).
  - On a failure, read the trace and fix the root cause.
  - No sleeps and no weakened assertions.
  - If layout makes a coordinate land on the wrong element, adjust the coordinate and say so in the report.
  - The `2:5` prefix assumes the status is read within 10 s of the 3-minute start.

- [ ] **Step 3: Run the full checks.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/session.spec.ts
git commit -m "test(e2e): voting with a shared countdown, comment threads, read-only links"
```
