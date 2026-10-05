# Relay F5a — Protocol Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sync server survives hostile and oversized input, a full board stays usable by deleting, and every refused connection or change is visible in the UI instead of failing silently. Presence survives the room hibernating, and a board that cannot be edited is read-only for real, in the user's own copy too.

**Architecture:** `Room.onMessage` inspects each frame before `y-partyserver` handles it. The rules are pure functions (`awareness.ts`, `deletion.ts`) tested in Node without a socket; `room.ts` only wires them. The client learns the room's state through three custom messages (`hello.full`, `room`, `rejected`), reduces them into the `clock` store, and reads one selector, `capability`, everywhere it used to compare `role`. Each connection carries the last presence of the ids it owns, so the room rebuilds its awareness map when it wakes from hibernation. On the board a second selector, `boardAccess` (`edit`, `delete-only`, `read-only`), decides what the controller applies and what the tool machine starts.

**Tech Stack:** TypeScript 5.9, Yjs 13.6, y-partyserver 2.2 on Cloudflare Workers Durable Objects (wrangler 4.139), lib0, y-protocols, Next.js 16 + React 19 + zustand, Vitest 4 + fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md` — section **Protocol Hardening (F5a)**, plus **Awareness (ephemeral)**, **Sync Layer**, **Limits** and **Testing Strategy**.

**Branch:** `feat/f5a-hardening` (already created; the spec commit is on it).

## Global Constraints

- Limits, exact: document full above `1024 * 1024` bytes, editable again at or below `900 * 1024`; message `256 * 1024` bytes (close 1009); awareness frame `8 * 1024` bytes (dropped, not closed); at most 2 awareness ids per connection (third closes 4429); 25 connections per room (close 4503); 60 messages/s, burst 120 (close 4429); `POST /api/rooms` 10 per 60 s per IP (`429`, `Retry-After: 60`).
- Close codes: 1009 too large, 4400 malformed frame, 4401 unauthorized, 4409 superseded, 4429 rate limited or too many awareness ids, 4503 too many people.
- Presence bounds: `selection` at most 100 ids; ids in `selection`, `editing`, `page`, `calEvent` at most 64 characters.
- Presence kept on a connection: `3000` characters per state (a longer one is kept without its selection). Request URL: at most `2048` characters; a longer one is refused with `414`.
- Connections are told apart by socket (`a !== b`), never by `connection.id`: the provider keeps its `_pk`, and so its connection id, across reconnects.
- A close the server starts on a socket that never sent anything takes about ten seconds to complete in workerd (about 50 ms once the socket has sent any message). A test that waits for such a close makes the socket speak first (`ping`) or waits 20 s.
- UI copy, verbatim: "This board is full — delete something to keep editing"; "Some changes couldn't be saved"; "Reload board"; "This board has too many people right now"; "Try again"; "Too many new boards. Try again in a minute."
- `parsePresence` in `@relay/core` is the only presence validator, on the server and on the client.
- Pure server modules that Node tests import must not use Workers types and must be listed in `apps/sync-server/test/tsconfig.json` → `include`.
- Server integration tests run against a real `wrangler dev` started by `apps/sync-server/test/helpers/worker.ts`. They are slow (about 1–2 minutes); run the named file, not the whole suite, while iterating.
- `apps/web/AGENTS.md`: this Next.js has breaking changes. F5a touches no Next API; if a step would, read `node_modules/next/dist/docs/` first.
- Before every commit: `npm run format`, then `npm run lint` and `npm run typecheck` must pass.
- Commit messages follow the repo's style (`feat(sync-server): …`, `feat(web): …`, `feat(core): …`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Out of scope: the demo seed and nightly reset (F5b), offline polish (F5c), deploy (F5d). A peer squatting the awareness id of a user who has already left is not addressed. A role not known yet (before the server's hello, or offline) keeps editing the board: what an offline viewer may do is F5c.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/presence/state.ts` (modify) | Presence bounds in `parsePresence` |
| `packages/core/src/sync/messages.ts` (modify) | `hello.full`, `room`, `rejected` |
| `packages/core/src/commands/full.ts` (create) | `allowedWhenFull(command)`; `BoardAccess`, `allowedFor(access, command)` |
| `packages/core/src/tools/machine.ts` (modify) | `ToolContext.access`: the machine for a user who cannot edit |
| `apps/sync-server/src/awareness.ts` (create) | Awareness frame codec and the ownership/validation filter (pure); `compactState` |
| `apps/sync-server/src/deletion.ts` (create) | Reading a sync update out of a frame; `isPureDeletion` (pure) |
| `apps/sync-server/src/auth.ts` (modify) | `sessionId` |
| `apps/sync-server/src/limits.ts` (modify) | `resumeDocBytes`, `maxStoredStateChars`, `maxUrlChars` |
| `apps/sync-server/src/room.ts` (modify) | Wires the guard: awareness, sessions, full board, messages; presence kept across hibernation |
| `apps/sync-server/src/index.ts`, `env.ts`, `wrangler.jsonc` (modify) | Room creation rate limit; request URL cap |
| `apps/web/src/sync/ownAwareness.ts` (create) | The provider sends only this client's awareness |
| `apps/web/src/sync/clock.ts` (modify) | `full`, `unsaved`, `capability`, `mayEdit`, `mayDelete`, `boardAccess` |
| `apps/web/src/sync/closes.ts` (create) | What to do for each close code (pure) |
| `apps/web/src/sync/connection.ts` (modify) | Wires closes, session id, retry, discard-and-reload |
| `apps/web/src/board/controller.ts` (modify) | Applies only what the board's access allows; undo off; `accessChanged` |
| `apps/web/src/ui/Toolbar.tsx`, `apps/web/src/render/SelectionLayer.tsx` (modify) | The tools that create and the resize handles show with edit access only |
| `apps/web/src/ui/statusNotice.ts` (create), `StatusBanner.tsx` (modify), `FullNotice.tsx` (create) | Notices |
| `e2e/hardening.spec.ts`, `e2e/helpers/filler.ts` (create) | Two browsers on a board that fills and resumes |
| `e2e/readonly.spec.ts` (create) | A viewer who cannot change the board, in their own copy either |

---

### Task 1: Presence bounds

**Files:**
- Modify: `packages/core/src/presence/state.ts`
- Modify: `apps/web/src/sync/presence.ts`
- Test: `packages/core/test/presence.test.ts` (append), `apps/web/test/presencePublisher.test.ts` (create)

**Interfaces:**
- Produces: `MAX_PRESENCE_SELECTION = 100` and `MAX_PRESENCE_ID = 64`, exported from `@relay/core`. `parsePresence(raw: unknown): PresenceState | null` keeps its signature.

- [ ] **Step 1: Write the failing core test**

In `packages/core/test/presence.test.ts`, add `MAX_PRESENCE_SELECTION` to the import from `'../src'` and append:

```ts
describe('presence bounds', () => {
  const base = {
    user: alice,
    cursor: null,
    selection: [],
    editing: null,
    viewport: null,
    page: null,
  };

  it('keeps at most 100 selected ids and drops ids that are empty, too long or not strings', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `s${i}`);
    expect(parsePresence({ ...base, selection: ids })?.selection).toEqual(
      ids.slice(0, MAX_PRESENCE_SELECTION),
    );
    expect(
      parsePresence({ ...base, selection: ['ok', '', 'x'.repeat(65), 7] })?.selection,
    ).toEqual(['ok']);
  });

  it('drops an editing id that is empty or longer than 64 characters', () => {
    expect(parsePresence({ ...base, editing: 'x'.repeat(64) })?.editing).toBe('x'.repeat(64));
    expect(parsePresence({ ...base, editing: 'x'.repeat(65) })?.editing).toBeNull();
    expect(parsePresence({ ...base, editing: '' })?.editing).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -w @relay/core -- presence`
Expected: FAIL — `MAX_PRESENCE_SELECTION` is not exported, and the selection keeps all 150 ids.

- [ ] **Step 3: Implement the bounds**

In `packages/core/src/presence/state.ts`, add above `parsePresence`:

```ts
/** Peers' selections are untrusted: at most this many ids are kept. */
export const MAX_PRESENCE_SELECTION = 100;
/** Ids in a presence state (selection, editing, page, calendar event) are at most this long. */
export const MAX_PRESENCE_ID = 64;

const isPresenceId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_PRESENCE_ID;
```

Inside `parsePresence`, replace the `selection`, `editing` and `page` lines of `state` and the `calEvent` check below it with:

```ts
    selection: Array.isArray(o.selection)
      ? o.selection.filter(isPresenceId).slice(0, MAX_PRESENCE_SELECTION)
      : [],
    editing: isPresenceId(o.editing) ? o.editing : null,
```

```ts
    page: isPresenceId(o.page) ? o.page : null,
```

```ts
  if (isPresenceId(o.calEvent)) state.calEvent = o.calEvent;
```

- [ ] **Step 4: Run the core tests**

Run: `npm test -w @relay/core -- presence`
Expected: PASS.

- [ ] **Step 5: Write the failing publisher test**

Create `apps/web/test/presencePublisher.test.ts`:

```ts
import { MAX_PRESENCE_SELECTION } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createPresencePublisher } from '../src/sync/presence';

const user = { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' };

describe('presence publisher', () => {
  it('publishes at most 100 selected ids (a select-all must fit the 8 KB frame)', () => {
    const awareness = new Awareness(new Y.Doc());
    const publisher = createPresencePublisher(awareness, user);
    const ids = Array.from({ length: 250 }, (_, i) => `shape-${i}`);
    publisher.setSelection(ids);
    const state = awareness.getLocalState() as { selection: string[] };
    expect(state.selection).toEqual(ids.slice(0, MAX_PRESENCE_SELECTION));
    publisher.destroy();
    awareness.destroy();
  });
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `npm test -w @relay/web -- presencePublisher`
Expected: FAIL — 250 ids published.

- [ ] **Step 7: Cap what the client publishes**

In `apps/web/src/sync/presence.ts`, add `MAX_PRESENCE_SELECTION` to the value imports from `'@relay/core'` and change `setSelection`:

```ts
    // Shape ids are UUIDs: more than about 200 of them would pass the server's 8 KB frame cap.
    setSelection: (ids) =>
      awareness.setLocalStateField('selection', ids.slice(0, MAX_PRESENCE_SELECTION)),
```

- [ ] **Step 8: Run, lint, commit**

Run: `npm test -w @relay/web -- presencePublisher && npm run format && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add packages/core apps/web
git commit -m "feat(core): bound presence selections and ids; the client publishes at most 100 selected ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Clients send only their own awareness

The stock provider listens to every awareness `change`, including peers' changes, and sends each one back to the server. With N people moving, every client sends about `20 × (N − 1)` extra messages per second and trips the 60 messages/s limit at around four active people. This task proves it and stops it at the client. Task 4 stops the server relaying echoes from older clients.

**Files:**
- Create: `apps/web/src/sync/ownAwareness.ts`
- Modify: `apps/web/src/sync/connection.ts`
- Modify: `apps/web/package.json` (adds `lib0`)
- Test: `apps/web/test/ownAwareness.test.ts` (create)

**Interfaces:**
- Produces: `ownAwarenessFrame(awareness: Awareness, change: { added: number[]; updated: number[]; removed: number[] }): Uint8Array | null` and `sendOnlyOwnAwareness(provider: YProvider): void`.

- [ ] **Step 1: Add lib0 to the web app**

Run: `npm install lib0@^0.2.117 -w @relay/web`
Expected: `apps/web/package.json` lists `lib0`; `npm ls lib0` shows a single version.

- [ ] **Step 2: Write the tests**

Create `apps/web/test/ownAwareness.test.ts`:

```ts
import * as decoding from 'lib0/decoding';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YProvider from 'y-partyserver/provider';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ownAwarenessFrame, sendOnlyOwnAwareness } from '../src/sync/ownAwareness';

const providers: YProvider[] = [];
afterEach(() => {
  for (const p of providers.splice(0)) p.destroy();
});

/** A provider that never dials out, with a fake open socket recording what it would send. */
function offlineProvider() {
  const provider = new YProvider('localhost:1', 'room', new Y.Doc(), {
    party: 'room',
    connect: false,
    disableBc: true,
  });
  providers.push(provider);
  const send = vi.fn();
  const internals = provider as unknown as { ws: unknown; wsconnected: boolean };
  internals.ws = { OPEN: 1, readyState: 1, send, close() {} };
  internals.wsconnected = true;
  return { provider, send };
}

/** An awareness update from another client, as the server relays it. */
function peerUpdate(): Uint8Array {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState({ user: { name: 'Peer' } });
  const update = encodeAwarenessUpdate(peer, [peer.clientID]);
  peer.destroy();
  return update;
}

describe('awareness echo', () => {
  it("the stock provider sends a peer's change back (why this module exists)", () => {
    const { provider, send } = offlineProvider();
    applyAwarenessUpdate(provider.awareness, peerUpdate(), 'server');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a peer's change once the handler is replaced", () => {
    const { provider, send } = offlineProvider();
    sendOnlyOwnAwareness(provider);
    applyAwarenessUpdate(provider.awareness, peerUpdate(), 'server');
    expect(send).not.toHaveBeenCalled();
  });

  it("still sends this client's changes, carrying only its own id", () => {
    const { provider, send } = offlineProvider();
    sendOnlyOwnAwareness(provider);
    applyAwarenessUpdate(provider.awareness, peerUpdate(), 'server');
    provider.awareness.setLocalState({ user: { name: 'Me' } });
    expect(send).toHaveBeenCalledTimes(1);
    const outer = decoding.createDecoder(send.mock.calls[0]?.[0] as Uint8Array);
    expect(decoding.readVarUint(outer)).toBe(1); // messageAwareness
    const inner = decoding.createDecoder(decoding.readVarUint8Array(outer));
    expect(decoding.readVarUint(inner)).toBe(1); // one entry
    expect(decoding.readVarUint(inner)).toBe(provider.awareness.clientID);
  });

  it('builds no frame for a change that leaves this client out', () => {
    const awareness = new Awareness(new Y.Doc());
    expect(ownAwarenessFrame(awareness, { added: [7], updated: [], removed: [] })).toBeNull();
    awareness.destroy();
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npm test -w @relay/web -- ownAwareness`
Expected: FAIL — cannot resolve `../src/sync/ownAwareness`. (If it resolves after Step 4, the first test must pass on its own: it documents the stock behaviour. If that first test ever fails after a `y-partyserver` upgrade, the library stopped echoing and this module can be deleted.)

- [ ] **Step 4: Implement**

Create `apps/web/src/sync/ownAwareness.ts`:

```ts
import * as encoding from 'lib0/encoding';
import type YProvider from 'y-partyserver/provider';
import { type Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

const MESSAGE_AWARENESS = 1;

export interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/** The awareness frame for a change, or null when the change does not involve this client. */
export function ownAwarenessFrame(awareness: Awareness, change: AwarenessChange): Uint8Array | null {
  const own = awareness.clientID;
  const mine =
    change.added.includes(own) || change.updated.includes(own) || change.removed.includes(own);
  if (!mine) return null;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [own]));
  return encoding.toUint8Array(encoder);
}

/** The provider's fields this module reaches into; they are not in its public types. */
interface ProviderInternals {
  _awarenessUpdateHandler: (change: AwarenessChange, origin: unknown) => void;
  ws: { OPEN: number; readyState: number; send(data: Uint8Array): void } | null;
  wsconnected: boolean;
}

/**
 * The stock provider re-sends every awareness change it sees, peers' included: with N people
 * moving, each client sends about 20 × (N − 1) extra messages a second and hits the server's
 * rate limit. This replaces its handler with one that sends only this client's changes. The
 * provider's destroy() removes whatever `_awarenessUpdateHandler` holds, so it removes this one.
 */
export function sendOnlyOwnAwareness(provider: YProvider): void {
  const internals = provider as unknown as ProviderInternals;
  provider.awareness.off('change', internals._awarenessUpdateHandler);
  internals._awarenessUpdateHandler = (change) => {
    const frame = ownAwarenessFrame(provider.awareness, change);
    const ws = internals.ws;
    if (frame && internals.wsconnected && ws && ws.readyState === ws.OPEN) ws.send(frame);
  };
  provider.awareness.on('change', internals._awarenessUpdateHandler);
}
```

In `apps/web/src/sync/connection.ts`, import it and call it right after the provider is created:

```ts
import { sendOnlyOwnAwareness } from './ownAwareness';
```

```ts
  sendOnlyOwnAwareness(provider);
```

- [ ] **Step 5: Run, lint, commit**

Run: `npm test -w @relay/web -- ownAwareness && npm run format && npm run lint && npm run typecheck`
Expected: PASS (4 tests).

```bash
git add apps/web package-lock.json
git commit -m "fix(web): send only this client's awareness; the provider echoed every peer's change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Awareness frame codec and filter (server, pure)

**Files:**
- Create: `apps/sync-server/src/awareness.ts`
- Modify: `apps/sync-server/package.json` (adds `lib0`, `y-protocols`), `apps/sync-server/test/tsconfig.json`
- Test: `apps/sync-server/test/awareness.test.ts` (create)

**Interfaces:**
- Consumes: `parsePresence` from `@relay/core` (Task 1 bounds).
- Produces:
  - `interface AwarenessEntry { clientId: number; clock: number; state: string }` (`state` is JSON text; `'null'` removes the state)
  - `readAwarenessMessage(message: Uint8Array): AwarenessEntry[] | null`
  - `encodeAwarenessUpdate(entries: AwarenessEntry[]): Uint8Array` (what `applyAwarenessUpdate` takes)
  - `wrapAwareness(update: Uint8Array): Uint8Array` (the wire frame, type byte 1)
  - `filterAwareness(entries, ctx: { owned: readonly number[]; ownedByOthers: ReadonlySet<number>; maxIds: number }): { accepted: AwarenessEntry[]; owned: number[]; tooMany: boolean }`

- [ ] **Step 1: Declare the dependencies**

Run: `npm install lib0@^0.2.117 y-protocols@^1.0.7 -w @relay/sync-server`

In `apps/sync-server/test/tsconfig.json`, extend `include`:

```json
  "include": [
    "./**/*.ts",
    "../src/auth.ts",
    "../src/limits.ts",
    "../src/awareness.ts",
    "../src/deletion.ts"
  ]
```

(`deletion.ts` is created in Task 8; TypeScript ignores an include that matches no file.)

- [ ] **Step 2: Write the failing tests**

Create `apps/sync-server/test/awareness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Awareness, encodeAwarenessUpdate as yEncode } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  type AwarenessEntry,
  encodeAwarenessUpdate,
  filterAwareness,
  readAwarenessMessage,
  wrapAwareness,
} from '../src/awareness';

const presence = (name: string, extra: Record<string, unknown> = {}) => ({
  user: { id: `u-${name}`, name, color: '#E85A1B' },
  cursor: null,
  selection: [],
  editing: null,
  viewport: null,
  page: null,
  ...extra,
});
const entry = (clientId: number, clock: number, state: unknown): AwarenessEntry => ({
  clientId,
  clock,
  state: JSON.stringify(state),
});
const ctx = (owned: number[] = [], others: number[] = []) => ({
  owned,
  ownedByOthers: new Set(others),
  maxIds: 2,
});

describe('awareness codec', () => {
  it('round-trips entries', () => {
    const entries = [entry(1, 3, presence('Ann')), entry(2, 9, null)];
    expect(readAwarenessMessage(wrapAwareness(encodeAwarenessUpdate(entries)))).toEqual(entries);
  });

  it('reads what y-protocols writes', () => {
    const a = new Awareness(new Y.Doc());
    a.setLocalState(presence('Ann'));
    const entries = readAwarenessMessage(wrapAwareness(yEncode(a, [a.clientID])));
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.clientId).toBe(a.clientID);
    expect(JSON.parse(entries?.[0]?.state ?? 'null').user.name).toBe('Ann');
    a.destroy();
  });

  it('rejects a frame that is truncated, has trailing bytes or is not awareness', () => {
    const good = wrapAwareness(encodeAwarenessUpdate([entry(1, 1, presence('Ann'))]));
    expect(readAwarenessMessage(good.slice(0, good.length - 3))).toBeNull();
    expect(readAwarenessMessage(Uint8Array.of(...good, 0))).toBeNull();
    expect(readAwarenessMessage(Uint8Array.of(0, 0))).toBeNull();
    expect(readAwarenessMessage(new Uint8Array())).toBeNull();
  });
});

describe('awareness filter', () => {
  it('claims an unowned id and relays the state reduced to known fields', () => {
    const v = filterAwareness([entry(7, 1, presence('Ann', { junk: 'x' }))], ctx());
    expect(v.tooMany).toBe(false);
    expect(v.owned).toEqual([7]);
    expect(v.accepted).toHaveLength(1);
    const state = JSON.parse(v.accepted[0]?.state ?? 'null');
    expect(state.user.name).toBe('Ann');
    expect('junk' in state).toBe(false);
  });

  it('drops an entry for an id another connection owns', () => {
    const v = filterAwareness([entry(7, 5, presence('Mallory')), entry(7, 6, null)], ctx([], [7]));
    expect(v.accepted).toEqual([]);
    expect(v.owned).toEqual([]);
  });

  it('drops a state that is not valid presence, without claiming the id', () => {
    const v = filterAwareness(
      [entry(7, 1, { name: 'INTRUDER' }), { clientId: 8, clock: 1, state: '{not json' }],
      ctx(),
    );
    expect(v.accepted).toEqual([]);
    expect(v.owned).toEqual([]);
  });

  it('accepts a removal only for an owned id, and releases it', () => {
    expect(filterAwareness([entry(7, 2, null)], ctx()).accepted).toEqual([]);
    const v = filterAwareness([entry(7, 2, null)], ctx([7]));
    expect(v.accepted).toEqual([{ clientId: 7, clock: 2, state: 'null' }]);
    expect(v.owned).toEqual([]);
  });

  it('an update to an owned id is not a new claim', () => {
    const v = filterAwareness([entry(7, 2, presence('Ann')), entry(8, 1, presence('Ann'))], ctx([7]));
    expect(v.tooMany).toBe(false);
    expect(v.owned).toEqual([7, 8]);
    expect(v.accepted).toHaveLength(2);
  });

  it('reports a third id and accepts nothing from that frame', () => {
    const v = filterAwareness([entry(9, 1, presence('Ann'))], ctx([7, 8]));
    expect(v.tooMany).toBe(true);
    expect(v.accepted).toEqual([]);
    expect(v.owned).toEqual([7, 8]);
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- awareness`
Expected: FAIL — cannot resolve `../src/awareness`.

- [ ] **Step 4: Implement**

Create `apps/sync-server/src/awareness.ts`:

```ts
import { type PresenceState, parsePresence } from '@relay/core';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** Yjs awareness protocol message type byte. */
const MESSAGE_AWARENESS = 1;

/** One client's state in an awareness update. `state` is JSON text; `'null'` removes the state. */
export interface AwarenessEntry {
  clientId: number;
  clock: number;
  state: string;
}

function readEntries(update: Uint8Array): AwarenessEntry[] | null {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessEntry[] = [];
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state = decoding.readVarString(decoder);
    entries.push({ clientId, clock, state });
  }
  return decoding.hasContent(decoder) ? null : entries;
}

/**
 * The entries of a wire awareness frame (type byte, then the update), or null when the frame is
 * not awareness, is truncated or carries bytes past its end.
 */
export function readAwarenessMessage(message: Uint8Array): AwarenessEntry[] | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== MESSAGE_AWARENESS) return null;
    const update = decoding.readVarUint8Array(decoder);
    if (decoding.hasContent(decoder)) return null;
    return readEntries(update);
  } catch {
    return null;
  }
}

/** An awareness update in the form `applyAwarenessUpdate` takes. */
export function encodeAwarenessUpdate(entries: readonly AwarenessEntry[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const e of entries) {
    encoding.writeVarUint(encoder, e.clientId);
    encoding.writeVarUint(encoder, e.clock);
    encoding.writeVarString(encoder, e.state);
  }
  return encoding.toUint8Array(encoder);
}

/** The wire frame for an awareness update. */
export function wrapAwareness(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** null: a removal. undefined: not JSON, or not valid presence. */
function sanitize(json: string): PresenceState | null | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (raw === null) return null;
  return parsePresence(raw) ?? undefined;
}

export interface AwarenessVerdict {
  /** Entries to apply and relay, with each state re-encoded from the validated value. */
  accepted: AwarenessEntry[];
  /** The ids the sender owns after this frame. */
  owned: number[];
  /** The sender tried to hold more ids than allowed; nothing from the frame is accepted. */
  tooMany: boolean;
}

/**
 * Decides what a connection may say in an awareness frame. An id belongs to the connection that
 * first claimed it, so entries for ids other connections own are dropped (older clients echo
 * their peers' states; that is not an error). States must pass `parsePresence`.
 */
export function filterAwareness(
  entries: readonly AwarenessEntry[],
  ctx: { owned: readonly number[]; ownedByOthers: ReadonlySet<number>; maxIds: number },
): AwarenessVerdict {
  const owned = [...ctx.owned];
  const accepted: AwarenessEntry[] = [];
  for (const e of entries) {
    if (ctx.ownedByOthers.has(e.clientId)) continue;
    const state = sanitize(e.state);
    if (state === undefined) continue;
    const at = owned.indexOf(e.clientId);
    if (state === null) {
      if (at === -1) continue;
      owned.splice(at, 1);
      accepted.push({ clientId: e.clientId, clock: e.clock, state: 'null' });
      continue;
    }
    if (at === -1) {
      if (owned.length >= ctx.maxIds) return { accepted: [], owned: [...ctx.owned], tooMany: true };
      owned.push(e.clientId);
    }
    accepted.push({ clientId: e.clientId, clock: e.clock, state: JSON.stringify(state) });
  }
  return { accepted, owned, tooMany: false };
}
```

- [ ] **Step 5: Run, lint, commit**

Run: `npm test -w @relay/sync-server -- awareness && npm run format && npm run lint && npm run typecheck`
Expected: PASS (9 tests).

```bash
git add apps/sync-server package-lock.json
git commit -m "feat(sync-server): awareness frame codec and an ownership and validation filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The room validates and relays awareness

**Files:**
- Modify: `apps/sync-server/src/room.ts`
- Test: `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Consumes: Task 3's `readAwarenessMessage`, `filterAwareness`, `encodeAwarenessUpdate`, `wrapAwareness`.
- Produces (inside `room.ts`, used by Tasks 5 and 8): `stateOf(connection)`, `patchState(connection, patch)`, `ownedIds(connection): number[]`.

- [ ] **Step 1: Add test helpers and the failing tests**

In `apps/sync-server/test/integration.test.ts`, import the codec:

```ts
import { encodeAwarenessUpdate as encodeEntries, wrapAwareness } from '../src/awareness';
```

Add below `encodeUpdateMessage`:

```ts
/** A valid presence state, as the web client publishes it. */
const presence = (name: string, extra: Record<string, unknown> = {}) => ({
  user: { id: `u-${name}`, name, color: '#E85A1B' },
  cursor: null,
  selection: [],
  editing: null,
  viewport: null,
  page: null,
  ...extra,
});

/** A wire awareness frame with chosen client ids and clocks. */
function awarenessFrame(
  entries: { clientId: number; clock: number; state: unknown }[],
): Uint8Array {
  return wrapAwareness(
    encodeEntries(
      entries.map((e) => ({ clientId: e.clientId, clock: e.clock, state: JSON.stringify(e.state) })),
    ),
  );
}

/** Counts the awareness frames (type byte 1) a raw socket receives from now on. */
function countAwarenessFrames(ws: WebSocket): () => number {
  let n = 0;
  ws.on('message', (data, isBinary) => {
    if (isBinary && (data as Buffer)[0] === 1) n++;
  });
  return () => n;
}

const nameOf = (p: YProvider, clientId: number): string | undefined =>
  (p.awareness.getStates().get(clientId) as { user?: { name?: string } } | undefined)?.user?.name;
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
```

Replace the two existing tests `closes a connection sending an oversized awareness frame with code 1009` and `closes a connection controlling more than 2 awareness client ids with code 4429` with:

```ts
  it('relays a valid presence state reduced to the fields the validator knows', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    const ws = rawConnect(roomId, { key: editKey });
    await waitForOpen(ws);
    ws.send(awarenessFrame([{ clientId: 1001, clock: 1, state: presence('Ann', { junk: 'x' }) }]));
    await waitFor(() => nameOf(watcher.provider, 1001) === 'Ann');
    expect('junk' in (watcher.provider.awareness.getStates().get(1001) as object)).toBe(false);
  });

  it('drops a state that is not valid presence', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    const ws = rawConnect(roomId, { key: editKey });
    await waitForOpen(ws);
    ws.send(awarenessFrame([{ clientId: 1002, clock: 1, state: { name: 'INTRUDER' } }]));
    await settle();
    expect(watcher.provider.awareness.getStates().has(1002)).toBe(false);
  });

  it("does not let a connection overwrite or remove another connection's state", async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    const ann = rawConnect(roomId, { key: editKey });
    const mallory = rawConnect(roomId, { key: editKey });
    await Promise.all([waitForOpen(ann), waitForOpen(mallory)]);
    ann.send(awarenessFrame([{ clientId: 2001, clock: 1, state: presence('Ann') }]));
    await waitFor(() => nameOf(watcher.provider, 2001) === 'Ann');
    mallory.send(awarenessFrame([{ clientId: 2001, clock: 5, state: presence('Mallory') }]));
    mallory.send(awarenessFrame([{ clientId: 2001, clock: 6, state: null }]));
    await settle();
    expect(nameOf(watcher.provider, 2001)).toBe('Ann');
  });

  it("does not relay a peer's state echoed back by another connection", async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = rawConnect(roomId, { key: editKey });
    const mover = rawConnect(roomId, { key: editKey });
    const echoer = rawConnect(roomId, { key: editKey });
    await Promise.all([waitForOpen(watcher), waitForOpen(mover), waitForOpen(echoer)]);
    const seen = countAwarenessFrames(watcher);
    const frame = awarenessFrame([{ clientId: 3001, clock: 1, state: presence('Ann') }]);
    mover.send(frame);
    await settle(300);
    echoer.send(frame);
    await settle();
    expect(seen()).toBe(1);
  });

  it('drops an oversized awareness frame and keeps the connection open', async () => {
    const { roomId, editKey } = await createRoom();
    const ws = rawConnect(roomId, { key: editKey });
    const hello = nextCustom(ws);
    await waitForOpen(ws);
    await hello;
    ws.send(awarenessFrame([{ clientId: 5001, clock: 1, state: presence('x'.repeat(20_000)) }]));
    const time = nextCustom(ws);
    ws.send('__YPS:{"type":"time?"}');
    expect((await time).type).toBe('time');
  });

  it('closes a connection whose awareness frame does not decode, with code 4400', async () => {
    const { roomId, editKey } = await createRoom();
    const ws = rawConnect(roomId, { key: editKey });
    await waitForOpen(ws);
    const closed = waitForClose(ws);
    ws.send(Uint8Array.of(1, 5, 255, 255)); // awareness, claims 5 bytes, carries 2
    expect((await closed).code).toBe(4400);
  });

  it('closes a connection claiming more than 2 awareness client ids with code 4429', async () => {
    const { roomId, editKey } = await createRoom();
    const ws = rawConnect(roomId, { key: editKey });
    await waitForOpen(ws);
    const closed = waitForClose(ws);
    ws.send(awarenessFrame([{ clientId: 6001, clock: 1, state: presence('first') }]));
    ws.send(awarenessFrame([{ clientId: 6002, clock: 1, state: presence('second') }]));
    ws.send(awarenessFrame([{ clientId: 6003, clock: 1, state: presence('third') }]));
    expect((await closed).code).toBe(4429);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL in the new tests: the state arrives with `junk`, `INTRUDER`'s id is present, the watcher sees `Mallory`, the echo count is 2, the oversized frame closes the socket, and the malformed frame does not close with 4400.

- [ ] **Step 3: Wire the filter into the room**

In `apps/sync-server/src/room.ts`:

Add the imports:

```ts
import { applyAwarenessUpdate } from 'y-protocols/awareness';
import {
  encodeAwarenessUpdate,
  filterAwareness,
  readAwarenessMessage,
  wrapAwareness,
} from './awareness';
```

Replace `roleOf`, `toBytes` and `awarenessIdCount` with:

```ts
/**
 * What the room keeps on a connection. It survives hibernation. `__ypsAwarenessIds` is
 * y-partyserver's own key: on close it removes the awareness states of the ids listed there, so
 * the room records ownership in the same place.
 */
interface ConnState {
  role?: Role;
  sid?: string;
  rejected?: boolean;
  __ypsAwarenessIds?: unknown;
}

const stateOf = (connection: Connection): ConnState =>
  (connection.state as ConnState | null) ?? {};

const patchState = (connection: Connection, patch: ConnState): void => {
  connection.setState((prev: unknown) => ({ ...((prev as object | null) ?? {}), ...patch }));
};

const roleOf = (connection: Connection): Role | undefined => stateOf(connection).role;

/** The awareness client ids this connection owns. */
function ownedIds(connection: Connection): number[] {
  const ids = stateOf(connection).__ypsAwarenessIds;
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
}

function toBytes(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  return message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}
```

In `onConnect`, replace the `connection.setState(...)` line with:

```ts
    patchState(connection, { role });
```

In `onMessage`, delete the block that closes with `'awareness frame too large'`, and delete the trailing block that closes with `'too many awareness identities'`. Right after the rate-limit block (the one that closes with `'rate limited'`), add:

```ts
    if (typeof message !== 'string' && isAwarenessMessage(message)) {
      this.#onAwareness(connection, toBytes(message));
      return;
    }
```

Add the method to the class:

```ts
  /**
   * Awareness is handled here, not by y-partyserver, which would apply and relay any frame
   * as-is: a connection could then rewrite a peer's state, and every echo of a peer's state
   * would be relayed to the whole room again.
   */
  #onAwareness(connection: Connection, bytes: Uint8Array): void {
    if (bytes.byteLength > LIMITS.maxAwarenessBytes) return;
    const entries = readAwarenessMessage(bytes);
    if (!entries) {
      connection.close(4400, 'bad frame');
      return;
    }
    const ownedByOthers = new Set<number>();
    for (const other of this.getConnections()) {
      if (other.id !== connection.id) for (const id of ownedIds(other)) ownedByOthers.add(id);
    }
    const verdict = filterAwareness(entries, {
      owned: ownedIds(connection),
      ownedByOthers,
      maxIds: LIMITS.maxAwarenessIds,
    });
    if (verdict.tooMany) {
      connection.close(4429, 'too many awareness identities');
      return;
    }
    if (verdict.accepted.length === 0) return;
    const update = encodeAwarenessUpdate(verdict.accepted);
    applyAwarenessUpdate(this.document.awareness, update, connection);
    patchState(connection, { __ypsAwarenessIds: verdict.owned });
    const frame = wrapAwareness(update);
    for (const peer of this.getConnections()) {
      try {
        peer.send(frame);
      } catch {
        // A peer that is closing: its own close handler cleans up.
      }
    }
  }
```

- [ ] **Step 4: Run the integration tests**

Run: `npm test -w @relay/sync-server -- integration`
Expected: PASS, including the earlier `never lets an unauthorized socket leak an awareness update to a real editor`.

- [ ] **Step 5: Lint and commit**

Run: `npm run format && npm run lint && npm run typecheck`

```bash
git add apps/sync-server
git commit -m "feat(sync-server): awareness ids belong to their connection; states are validated and echoes are not relayed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sessions — a reconnecting tab retires its own stale socket

**Files:**
- Modify: `apps/sync-server/src/auth.ts`, `apps/sync-server/src/room.ts`
- Modify: `apps/web/src/sync/key.ts`, `apps/web/src/sync/connection.ts`
- Test: `apps/sync-server/test/auth.test.ts`, `apps/sync-server/test/integration.test.ts`, `apps/web/test/key.test.ts`

**Interfaces:**
- Consumes: Task 4's `stateOf`, `patchState`, `ownedIds`.
- Produces: `sessionId(raw: string | null): string | null` (server, `auth.ts`); `newSessionId(): string` (web, `sync/key.ts`); the WebSocket query parameter `sid`; in the integration test, `rawConnect`'s `sid` and `pk` options and `ping(ws)`.

The app's provider (`YProvider`) keeps one `_pk` for its whole life, and partyserver uses `_pk` as the connection id. A reconnecting tab therefore arrives with the same connection id as the socket it left behind. So the room tells connections apart by socket (`c !== connection`), never by id, and the takeover test below opens both sockets with the same `_pk`, as the app does. (With `c.id !== connection.id` the stale socket is filtered out together with the new one, nothing is retired, and a test whose sockets have random ids still passes.)

- [ ] **Step 1: Write the failing unit tests**

Append to the `describe('auth', …)` block in `apps/sync-server/test/auth.test.ts` (add `sessionId` to the import from `'../src/auth'`):

```ts
  it('accepts a session id of 16 to 64 url-safe characters and nothing else', () => {
    expect(sessionId('a'.repeat(16))).toBe('a'.repeat(16));
    expect(sessionId('Ab0_-'.repeat(8))).toBe('Ab0_-'.repeat(8));
    expect(sessionId('a'.repeat(15))).toBeNull();
    expect(sessionId('a'.repeat(65))).toBeNull();
    expect(sessionId(`${'a'.repeat(15)}!`)).toBeNull();
    expect(sessionId(null)).toBeNull();
  });
```

Append to `apps/web/test/key.test.ts` (add `newSessionId` to the import from `'../src/sync/key'`):

```ts
describe('newSessionId', () => {
  it('is 32 hex characters and different each time', () => {
    const a = newSessionId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newSessionId()).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- auth` and `npm test -w @relay/web -- key`
Expected: FAIL — `sessionId` and `newSessionId` are not exported.

- [ ] **Step 3: Implement both helpers**

Append to `apps/sync-server/src/auth.ts`:

```ts
const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** The `sid` query parameter when it is well formed, else null (the connection has no session). */
export function sessionId(raw: string | null): string | null {
  return raw !== null && SESSION_ID.test(raw) ? raw : null;
}
```

Append to `apps/web/src/sync/key.ts`:

```ts
/**
 * A random 128-bit id for one tab's connection, kept in memory. The server closes an older
 * socket that carries the same id, so a reconnect after a network cut never leaves this user's
 * presence owned by a dead socket.
 */
export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Write the failing integration tests**

In `apps/sync-server/test/integration.test.ts`, give `rawConnect` a `sid` and a `pk` option. Replace the head of the function, down to the line that sets `key`:

```ts
function rawConnect(
  room: string,
  opts: { key?: string; sid?: string; pk?: string; headers?: Record<string, string> } = {},
): WebSocket {
  // The app's provider keeps one `_pk` for its whole life: a reconnect arrives with the same one.
  const params = new URLSearchParams({ _pk: opts.pk ?? Math.random().toString(36).slice(2) });
  if (opts.key !== undefined) params.set('key', opts.key);
  if (opts.sid !== undefined) params.set('sid', opts.sid);
```

Add below `nextCustom`:

```ts
/**
 * Asks the server time and waits for the answer. The server's close of a socket that never
 * sent anything takes about ten seconds to complete (55 ms once it has spoken), so a test that
 * waits for the close code of a socket the server retires makes it speak first.
 */
async function ping(ws: WebSocket): Promise<void> {
  ws.send('__YPS:{"type":"time?"}');
  for (;;) if ((await nextCustom(ws)).type === 'time') return;
}
```

Add:

```ts
  it('a reconnecting tab retires its old socket and keeps its presence', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    // What the app's provider sends: the same `_pk` and the same `sid` on every reconnect.
    const tab = { key: editKey, sid: 'tab-session-0001', pk: 'tab-conn-01' };
    const first = rawConnect(roomId, tab);
    await waitForOpen(first);
    first.send(awarenessFrame([{ clientId: 4001, clock: 1, state: presence('Ann') }]));
    await waitFor(() => nameOf(watcher.provider, 4001) === 'Ann');

    const firstClosed = waitForClose(first);
    const second = rawConnect(roomId, tab);
    await waitForOpen(second);
    expect((await firstClosed).code).toBe(4409);
    await settle();
    // The old socket's close did not remove the state the new socket inherited.
    expect(nameOf(watcher.provider, 4001)).toBe('Ann');
    second.send(awarenessFrame([{ clientId: 4001, clock: 2, state: presence('Ann B') }]));
    await waitFor(() => nameOf(watcher.provider, 4001) === 'Ann B');

    // Another session cannot take the id.
    const stranger = rawConnect(roomId, { key: editKey, sid: 'tab-session-0002' });
    await waitForOpen(stranger);
    stranger.send(awarenessFrame([{ clientId: 4001, clock: 9, state: presence('Mallory') }]));
    await settle();
    expect(nameOf(watcher.provider, 4001)).toBe('Ann B');
  });

  it('the session id alone retires the old socket, whatever the connection ids', async () => {
    const { roomId, editKey } = await createRoom();
    const first = rawConnect(roomId, { key: editKey, sid: 'tab-session-0003' });
    await waitForOpen(first);
    await ping(first);
    const firstClosed = waitForClose(first);
    const second = rawConnect(roomId, { key: editKey, sid: 'tab-session-0003' });
    await waitForOpen(second);
    expect((await firstClosed).code).toBe(4409);
  });

  it('a full room refuses a new session with 4503 but lets an existing session reconnect', {
    timeout: 60_000,
  }, async () => {
    const { roomId, editKey } = await createRoom();
    const sockets: WebSocket[] = [];
    for (let i = 0; i < LIMITS.maxConnections; i++) {
      const ws = rawConnect(roomId, { key: editKey, sid: `full-room-session-${i}` });
      const hello = nextCustom(ws);
      await waitForOpen(ws);
      await hello;
      sockets.push(ws);
    }
    // The refused socket never spoke, so its close takes about ten seconds to complete.
    const extra = rawConnect(roomId, { key: editKey, sid: 'full-room-session-new' });
    expect((await waitForClose(extra, 20_000)).code).toBe(4503);

    const old = sockets[0] as WebSocket;
    await ping(old);
    const oldClosed = waitForClose(old);
    const back = rawConnect(roomId, { key: editKey, sid: 'full-room-session-0' });
    const hello = nextCustom(back);
    await waitForOpen(back);
    expect((await hello).type).toBe('hello');
    expect((await oldClosed).code).toBe(4409);
  });
```

- [ ] **Step 5: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL — the first socket is never closed with 4409, and the reconnecting session is refused with 4503. (The full-room test takes about 25 s once it passes: the refused socket's close needs ten.)

- [ ] **Step 6: Implement sessions in the room**

In `apps/sync-server/src/room.ts`, add `sessionId` to the import from `'./auth'` and replace `onConnect`:

```ts
  onConnect(connection: Connection, ctx: ConnectionContext): void {
    const header = ctx.request.headers.get(ROLE_HEADER);
    const role: Role | null = header === 'edit' || header === 'view' ? header : null;
    if (!role) {
      connection.close(4401, 'unauthorized');
      return;
    }
    const sid = sessionId(new URL(ctx.request.url).searchParams.get('sid'));
    // By socket, not by id: the provider keeps its connection id across reconnects, so the
    // socket a reconnecting tab left behind has the same id as the new one.
    const others = [...this.getConnections()].filter((c) => c !== connection);
    // One tab has one socket, so an older connection with this session id is dead. It is
    // retired before counting, or a reconnecting user would be locked out by their own ghost.
    const stale = sid ? others.filter((c) => stateOf(c).sid === sid) : [];
    if (others.length - stale.length >= LIMITS.maxConnections) {
      connection.close(4503, 'room full');
      return;
    }
    const inherited: number[] = [];
    for (const old of stale) {
      inherited.push(...ownedIds(old));
      // Emptied first: closing the stale socket must not remove the states the new one keeps.
      patchState(old, { __ypsAwarenessIds: [] });
      old.close(4409, 'superseded');
    }
    patchState(connection, {
      role,
      ...(sid ? { sid } : {}),
      __ypsAwarenessIds: [...new Set(inherited)].slice(0, LIMITS.maxAwarenessIds),
    });
    super.onConnect(connection, ctx);
    // Tell the client its capability and the server clock (vote timers use server time).
    void this.#sendHello(connection, role);
  }
```

In `#onAwareness`, tell the sender from the others by socket too. Replace:

```ts
      if (other.id !== connection.id) for (const id of ownedIds(other)) ownedByOthers.add(id);
```

with:

```ts
      // By socket, not by id: a reconnecting tab keeps its connection id.
      if (other !== connection) for (const id of ownedIds(other)) ownedByOthers.add(id);
```

- [ ] **Step 7: Send the session id from the client**

In `apps/web/src/sync/connection.ts`, import `newSessionId` from `'./key'` and change the provider's `params`:

```ts
  const sid = newSessionId();
  const provider = new YProvider(opts.host, opts.roomId, doc, {
    party: 'room',
    params: opts.key ? { key: opts.key, sid } : { sid },
  });
```

- [ ] **Step 8: Run everything touched, lint, commit**

Run: `npm test -w @relay/sync-server && npm test -w @relay/web -- key && npm run format && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add apps/sync-server apps/web
git commit -m "feat: a reconnecting tab retires its stale socket and keeps its presence (session id)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server messages and the clock

**Files:**
- Modify: `packages/core/src/sync/messages.ts`
- Modify: `apps/sync-server/src/room.ts` (hello carries `full`)
- Modify: `apps/web/src/sync/clock.ts`, `apps/web/src/sync/connection.ts`
- Test: `packages/core/test/messages.test.ts`, `apps/web/test/clock.test.ts`, `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Produces (core):

```ts
export type ServerMessage =
  | { type: 'hello'; role: Role; now: number; full: boolean; viewKey?: string }
  | { type: 'time'; now: number }
  | { type: 'room'; full: boolean; now: number }
  | { type: 'rejected'; now: number };
```

- Produces (web, `sync/clock.ts`): `ClockState` with `full: boolean` and `unsaved: boolean`; `INITIAL_CLOCK: ClockState`; `type Capability = 'edit' | 'delete-only' | 'view'`; `capability(c)`, `mayEdit(c)`, `mayDelete(c)`, each taking `Pick<ClockState, 'role' | 'full'>`.

- [ ] **Step 1: Update and extend the core tests**

In `packages/core/test/messages.test.ts`, every expected `hello` object gains `full: false` (five `toEqual` objects: in `parses hello and time`, both in `keeps a bounded viewKey on hello`, in `keeps a 64-character viewKey on hello`, and in `drops a non-string viewKey from hello`). Then append:

```ts
  it('reads full on hello, and only a true value counts', () => {
    expect(parseServerMessage('{"type":"hello","role":"edit","now":1,"full":true}')).toEqual({
      type: 'hello',
      role: 'edit',
      now: 1,
      full: true,
    });
    expect(parseServerMessage('{"type":"hello","role":"edit","now":1,"full":"yes"}')).toEqual({
      type: 'hello',
      role: 'edit',
      now: 1,
      full: false,
    });
  });

  it('parses room and rejected', () => {
    expect(parseServerMessage('{"type":"room","full":true,"now":3}')).toEqual({
      type: 'room',
      full: true,
      now: 3,
    });
    expect(parseServerMessage('{"type":"room","now":3}')).toBeNull();
    expect(parseServerMessage('{"type":"room","full":1,"now":3}')).toBeNull();
    expect(parseServerMessage('{"type":"rejected","now":4}')).toEqual({ type: 'rejected', now: 4 });
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/core -- messages`
Expected: FAIL — hello has no `full`; `room` and `rejected` parse to null.

- [ ] **Step 3: Implement the messages**

In `packages/core/src/sync/messages.ts`, replace the `ServerMessage` type and `parseServerMessage`:

```ts
/** Custom messages the room sends over y-partyserver's `__YPS:` channel. */
export type ServerMessage =
  | { type: 'hello'; role: Role; now: number; full: boolean; viewKey?: string }
  | { type: 'time'; now: number }
  /** The board went over its size cap (`full`) or came back under it. */
  | { type: 'room'; full: boolean; now: number }
  /** The server refused this connection's change because the board was full. */
  | { type: 'rejected'; now: number };
```

```ts
export function parseServerMessage(raw: string): ServerMessage | null {
  const o = parse(raw);
  if (!o || typeof o.now !== 'number' || !Number.isFinite(o.now)) return null;
  if (o.type === 'time') return { type: 'time', now: o.now };
  if (o.type === 'rejected') return { type: 'rejected', now: o.now };
  if (o.type === 'room' && typeof o.full === 'boolean') {
    return { type: 'room', full: o.full, now: o.now };
  }
  if (o.type === 'hello' && (o.role === 'edit' || o.role === 'view')) {
    return {
      type: 'hello',
      role: o.role,
      now: o.now,
      full: o.full === true,
      ...(typeof o.viewKey === 'string' && o.viewKey.length <= 64 ? { viewKey: o.viewKey } : {}),
    };
  }
  return null;
}
```

- [ ] **Step 4: The server's hello carries `full`**

In `apps/sync-server/src/room.ts`, in `#sendHello`:

```ts
    this.sendCustomMessage(
      connection,
      encode({
        type: 'hello',
        role,
        now: Date.now(),
        full: this.#frozen,
        ...(viewKey ? { viewKey } : {}),
      }),
    );
```

In `apps/sync-server/test/integration.test.ts`, in `says hello with the role and server time, and answers time requests`, add after `expect(h.role).toBe('edit');`:

```ts
    expect(h.full).toBe(false);
```

- [ ] **Step 5: Rewrite the clock tests**

Replace `apps/web/test/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { capability, INITIAL_CLOCK, mayDelete, mayEdit, nextClock } from '../src/sync/clock';

describe('clock', () => {
  it('hello sets the role, the offset and whether the board is full', () => {
    expect(
      nextClock(INITIAL_CLOCK, { type: 'hello', role: 'edit', now: 10_500, full: true }, 10_000),
    ).toEqual({ role: 'edit', offset: 500, viewKey: null, full: true, unsaved: false });
  });

  it('time refreshes the offset and keeps everything else', () => {
    const prev = { ...INITIAL_CLOCK, role: 'view' as const, offset: 500, full: true };
    expect(nextClock(prev, { type: 'time', now: 20_000 }, 20_100)).toEqual({
      ...prev,
      offset: -100,
    });
  });

  it('keeps the view key from hello and across time refreshes', () => {
    const a = nextClock(
      INITIAL_CLOCK,
      { type: 'hello', role: 'edit', now: 5, full: false, viewKey: 'vk' },
      5,
    );
    expect(a.viewKey).toBe('vk');
    expect(nextClock(a, { type: 'time', now: 9 }, 9).viewKey).toBe('vk');
  });

  it('room switches full on and off', () => {
    const editor = { ...INITIAL_CLOCK, role: 'edit' as const };
    const full = nextClock(editor, { type: 'room', full: true, now: 1 }, 1);
    expect(full.full).toBe(true);
    expect(nextClock(full, { type: 'room', full: false, now: 2 }, 2).full).toBe(false);
  });

  it('rejected marks unsaved changes, and a later hello does not clear the mark', () => {
    const editor = { ...INITIAL_CLOCK, role: 'edit' as const };
    const unsaved = nextClock(editor, { type: 'rejected', now: 1 }, 1);
    expect(unsaved.unsaved).toBe(true);
    expect(
      nextClock(unsaved, { type: 'hello', role: 'edit', now: 2, full: false }, 2).unsaved,
    ).toBe(true);
  });
});

describe('capability', () => {
  it('an editor edits, deletes only on a full board, and anyone else views', () => {
    expect(capability({ role: 'edit', full: false })).toBe('edit');
    expect(capability({ role: 'edit', full: true })).toBe('delete-only');
    expect(capability({ role: 'view', full: false })).toBe('view');
    expect(capability({ role: 'view', full: true })).toBe('view');
    expect(capability({ role: null, full: false })).toBe('view');
  });

  it('mayEdit and mayDelete follow it', () => {
    expect(mayEdit({ role: 'edit', full: false })).toBe(true);
    expect(mayEdit({ role: 'edit', full: true })).toBe(false);
    expect(mayDelete({ role: 'edit', full: true })).toBe(true);
    expect(mayDelete({ role: 'view', full: false })).toBe(false);
  });
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `npm test -w @relay/web -- clock`
Expected: FAIL — `INITIAL_CLOCK`, `capability`, `mayEdit`, `mayDelete` are not exported.

- [ ] **Step 7: Implement the clock**

Replace `apps/web/src/sync/clock.ts`:

```ts
import type { Role, ServerMessage } from '@relay/core';

export interface ClockState {
  /** Capability from the server's hello; null until the first hello arrives. */
  role: Role | null;
  /** serverNow = Date.now() + offset. Error is at most the one-way latency. */
  offset: number;
  /** Read-only link key (editors only, from hello). */
  viewKey: string | null;
  /** The board is over its size cap: the server only accepts deletions. */
  full: boolean;
  /** The server refused one of this client's changes; the local copy has drifted from the board. */
  unsaved: boolean;
}

export const INITIAL_CLOCK: ClockState = {
  role: null,
  offset: 0,
  viewKey: null,
  full: false,
  unsaved: false,
};

/** How often the client asks for the server time while online. */
export const TIME_REFRESH_MS = 300_000;

export function nextClock(prev: ClockState, msg: ServerMessage, localNow: number): ClockState {
  const offset = msg.now - localNow;
  switch (msg.type) {
    case 'hello':
      return { ...prev, role: msg.role, offset, viewKey: msg.viewKey ?? null, full: msg.full };
    case 'room':
      return { ...prev, offset, full: msg.full };
    case 'rejected':
      // Only a reload clears it: the local document still holds the refused change.
      return { ...prev, offset, unsaved: true };
    case 'time':
      return { ...prev, offset };
  }
}

/** What this user may do: edit, only delete (an editor on a full board), or view. */
export type Capability = 'edit' | 'delete-only' | 'view';

type Capable = Pick<ClockState, 'role' | 'full'>;

export function capability(c: Capable): Capability {
  if (c.role !== 'edit') return 'view';
  return c.full ? 'delete-only' : 'edit';
}

export const mayEdit = (c: Capable): boolean => capability(c) === 'edit';
/** Deleting stays available on a full board. */
export const mayDelete = (c: Capable): boolean => c.role === 'edit';
```

In `apps/web/src/sync/connection.ts`, import `INITIAL_CLOCK` and use it:

```ts
  const clock = createStore<ClockState>(() => INITIAL_CLOCK);
```

- [ ] **Step 8: Run everything touched, lint, commit**

Run: `npm test -w @relay/core -- messages && npm test -w @relay/web -- clock && npm test -w @relay/sync-server -- integration && npm run format && npm run lint && npm run typecheck`
Expected: PASS. If `typecheck` reports another place that builds a `ClockState` or a `hello` literal by hand, give it `full: false` (and `unsaved: false` for a `ClockState`).

```bash
git add packages/core apps/web apps/sync-server
git commit -m "feat: hello says whether the board is full; room and rejected messages; a capability selector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `allowedWhenFull`

**Files:**
- Create: `packages/core/src/commands/full.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/full.test.ts` (create)

**Interfaces:**
- Produces: `allowedWhenFull(command: Command): boolean`, exported from `@relay/core`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/full.test.ts`:

```ts
declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allowedWhenFull,
  applyCommand,
  type Command,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  SESSION_ORIGIN,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 150);
const SHAPES = ['s0', 's1', 's2', 's3', 's4'];
const ROWS = ['r0', 'r1', 'r2'];
const COLS = ['c0', 'c1'];
const EVENTS = ['e0', 'e1'];

/** A board with shapes, connectors, a sheet with formatted cells and a calendar with events. */
function fixture(): Y.Doc {
  const doc = new Y.Doc();
  const run = (c: Command, origin = LOCAL_ORIGIN) => applyCommand(doc, c, origin);
  for (const id of SHAPES) {
    run({
      type: 'CreateShape',
      shape: {
        id,
        type: 'sticky',
        x: 0,
        y: 0,
        w: 180,
        h: 140,
        style: DEFAULT_STYLE.sticky,
        text: `note ${id}`,
        createdBy: 'u',
        authorName: 'U',
        createdAt: 0,
      },
    });
  }
  run({
    type: 'Connect',
    connector: {
      id: 'k0',
      from: { shapeId: 's0', anchor: 'auto' },
      to: { shapeId: 's1', anchor: 'auto' },
      routing: 'elbow',
      head: 'arrow',
      createdBy: 'u',
    },
  });
  run({
    type: 'Connect',
    connector: {
      id: 'k1',
      from: { x: 0, y: 0 },
      to: { shapeId: 's2', anchor: 'auto' },
      routing: 'straight',
      head: 'none',
      createdBy: 'u',
    },
  });
  run(
    {
      type: 'CreatePage',
      page: { id: 'sheet', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
      sheet: {
        rows: ['a0', 'a1', 'a2'].map((order, i) => ({ id: ROWS[i] as string, order })),
        cols: ['a0', 'a1'].map((order, i) => ({ id: COLS[i] as string, order })),
      },
    },
    SESSION_ORIGIN,
  );
  run({
    type: 'SetCells',
    pageId: 'sheet',
    cells: ROWS.flatMap((row) =>
      COLS.map((col) => ({ row, col, src: `${row}${col}`, fmt: { bold: true as const } })),
    ),
  });
  run(
    {
      type: 'CreatePage',
      page: { id: 'cal', type: 'calendar', title: 'C', order: 'a2', createdBy: 'u', createdAt: 0 },
    },
    SESSION_ORIGIN,
  );
  for (const id of EVENTS) {
    run({
      type: 'CreateEvent',
      pageId: 'cal',
      id,
      fields: {
        title: `event ${id}`,
        color: '#E85A1B',
        when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
        createdBy: 'u',
        createdAt: 0,
      },
    });
  }
  return doc;
}

/** The Yjs updates a command produces. */
function updatesOf(doc: Y.Doc, command: Command): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  doc.on('update', onUpdate);
  applyCommand(doc, command, LOCAL_ORIGIN);
  doc.off('update', onUpdate);
  return updates;
}

const some = <T>(items: readonly T[]) => fc.subarray([...items], { minLength: 1 });
const allowedArb: fc.Arbitrary<Command> = fc.oneof(
  some([...SHAPES, 'k0', 'k1']).map((ids): Command => ({ type: 'DeleteShapes', ids })),
  some(ROWS).map((ids): Command => ({ type: 'DeleteRows', pageId: 'sheet', ids })),
  some(COLS).map((ids): Command => ({ type: 'DeleteCols', pageId: 'sheet', ids })),
  fc
    .constantFrom(...EVENTS)
    .map((id): Command => ({ type: 'DeleteEvent', pageId: 'cal', id })),
  some(ROWS.flatMap((row) => COLS.map((col) => ({ row, col, src: '' })))).map(
    (cells): Command => ({ type: 'SetCells', pageId: 'sheet', cells }),
  ),
);

describe('allowedWhenFull', () => {
  it('the fixture really holds what the commands delete', () => {
    const roots = getRoots(fixture());
    expect(roots.shapes.size).toBe(SHAPES.length);
    expect(roots.connectors.size).toBe(2);
    expect(roots.sheets.has('sheet')).toBe(true);
    const events = roots.calendars.get('cal')?.get('events') as Y.Map<unknown> | undefined;
    expect(events?.size).toBe(EVENTS.length);
  });

  it('allows the deleting commands and a SetCells that only clears', () => {
    expect(allowedWhenFull({ type: 'DeleteShapes', ids: ['s0'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteRows', pageId: 'p', ids: ['r'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteCols', pageId: 'p', ids: ['c'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteEvent', pageId: 'p', id: 'e' })).toBe(true);
    expect(
      allowedWhenFull({ type: 'SetCells', pageId: 'p', cells: [{ row: 'r', col: 'c', src: '' }] }),
    ).toBe(true);
  });

  it('refuses everything that writes, including DeletePage and a clear that keeps a format', () => {
    expect(allowedWhenFull({ type: 'DeletePage', id: 'p' })).toBe(false);
    expect(allowedWhenFull({ type: 'MoveShapes', moves: [] })).toBe(false);
    expect(allowedWhenFull({ type: 'EndVote' })).toBe(false);
    expect(
      allowedWhenFull({ type: 'SetCells', pageId: 'p', cells: [{ row: 'r', col: 'c', src: 'x' }] }),
    ).toBe(false);
    expect(
      allowedWhenFull({
        type: 'SetCells',
        pageId: 'p',
        cells: [{ row: 'r', col: 'c', src: '', fmt: { bold: true } }],
      }),
    ).toBe(false);
  });

  it('an allowed command deletes something and adds no struct (a full server accepts it)', () => {
    const doc = fixture();
    const updates = updatesOf(doc, { type: 'DeleteShapes', ids: ['s0'] });
    expect(updates.length).toBeGreaterThan(0);
    expect(getRoots(doc).shapes.has('s0')).toBe(false);
    for (const u of updates) expect(Y.decodeUpdate(u).structs).toHaveLength(0);
  });

  it('every allowed command produces updates with no structs, over random sequences', () => {
    fc.assert(
      fc.property(fc.array(allowedArb, { minLength: 1, maxLength: 8 }), (commands) => {
        const doc = fixture();
        for (const command of commands) {
          expect(allowedWhenFull(command)).toBe(true);
          for (const u of updatesOf(doc, command)) {
            expect(Y.decodeUpdate(u).structs).toHaveLength(0);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/core -- full`
Expected: FAIL — `allowedWhenFull` is not exported. (If the fixture test fails instead once Step 3 is in, a fixture command was refused by `applyCommand`: fix the fixture's field values against `packages/core/src/commands/apply.ts` before going on, because a property over an empty document proves nothing.)

- [ ] **Step 3: Implement**

Create `packages/core/src/commands/full.ts`:

```ts
import type { Command } from './types';

/**
 * Whether a command only deletes. On a board over its size cap the server accepts an update
 * only when it adds no structs, so these are the commands that still reach the other users.
 * `DeletePage` is not one: it writes a tombstone. A `SetCells` qualifies when it clears every
 * cell it names; keeping a format would write the cell again.
 */
export function allowedWhenFull(command: Command): boolean {
  switch (command.type) {
    case 'DeleteShapes':
    case 'DeleteRows':
    case 'DeleteCols':
    case 'DeleteEvent':
      return true;
    case 'SetCells':
      return command.cells.every((c) => !c.src && !c.fmt);
    default:
      return false;
  }
}
```

In `packages/core/src/index.ts`, add after `export * from './commands/apply';`:

```ts
export * from './commands/full';
```

- [ ] **Step 4: Run, lint, commit**

Run: `npm test -w @relay/core -- full && npm run format && npm run lint && npm run typecheck`
Expected: PASS (5 tests).

```bash
git add packages/core
git commit -m "feat(core): allowedWhenFull names the commands that only delete, with a property test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A full board on the server — finer estimate, deletions accepted, resume

**Files:**
- Create: `apps/sync-server/src/deletion.ts`
- Modify: `apps/sync-server/src/limits.ts`, `apps/sync-server/src/room.ts`
- Test: `apps/sync-server/test/deletion.test.ts` (create), `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Consumes: Task 6's `ServerMessage` (`room`, `rejected`, `hello.full`); Task 4's `stateOf`, `patchState`.
- Produces: `readSyncUpdate(message: Uint8Array): Uint8Array | null`; `isPureDeletion(update: Uint8Array, doc: Y.Doc): boolean`; `LIMITS.resumeDocBytes`.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/sync-server/test/deletion.test.ts`:

```ts
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import { writeSyncStep1, writeSyncStep2, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';
import { isPureDeletion, readSyncUpdate } from '../src/deletion';

/** Captures the next update `fn` produces on `doc`. */
function updateOf(doc: Y.Doc, fn: () => void): Uint8Array {
  let update: Uint8Array | undefined;
  const on = (u: Uint8Array) => {
    update = u;
  };
  doc.on('update', on);
  fn();
  doc.off('update', on);
  if (!update) throw new Error('no update produced');
  return update;
}

function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync
  write(encoder);
  return encoding.toUint8Array(encoder);
}

describe('readSyncUpdate', () => {
  it('returns the update of an Update or SyncStep2 frame', () => {
    const doc = new Y.Doc();
    const update = updateOf(doc, () => doc.getMap('m').set('a', 1));
    expect(readSyncUpdate(syncFrame((e) => writeUpdate(e, update)))).toEqual(update);
    const step2 = readSyncUpdate(syncFrame((e) => writeSyncStep2(e, doc)));
    expect(step2).toEqual(Y.encodeStateAsUpdate(doc));
  });

  it('returns null for SyncStep1, awareness, truncated frames and trailing bytes', () => {
    const doc = new Y.Doc();
    expect(readSyncUpdate(syncFrame((e) => writeSyncStep1(e, doc)))).toBeNull();
    expect(readSyncUpdate(Uint8Array.of(1, 0))).toBeNull();
    expect(readSyncUpdate(Uint8Array.of(0, 2, 9, 1))).toBeNull();
    const good = syncFrame((e) => writeUpdate(e, Y.encodeStateAsUpdate(doc)));
    expect(readSyncUpdate(Uint8Array.of(...good, 0))).toBeNull();
    expect(readSyncUpdate(new Uint8Array())).toBeNull();
  });
});

describe('isPureDeletion', () => {
  /** A server document and a client that has everything the server has. */
  function pair() {
    const server = new Y.Doc();
    const client = new Y.Doc();
    client.getMap('m').set('a', 'x'.repeat(100));
    client.getMap('m').set('b', 'y');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    return { server, client };
  }

  it('accepts an update that only deletes what the document has', () => {
    const { server, client } = pair();
    const update = updateOf(client, () => client.getMap('m').delete('a'));
    expect(isPureDeletion(update, server)).toBe(true);
  });

  it('accepts an update with nothing in it', () => {
    const { server, client } = pair();
    expect(isPureDeletion(Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)), server)).toBe(
      true,
    );
  });

  it('refuses an update that adds a struct', () => {
    const { server, client } = pair();
    const update = updateOf(client, () => client.getMap('m').set('c', 1));
    expect(isPureDeletion(update, server)).toBe(false);
  });

  it('refuses a deletion of content the document does not have', () => {
    const { server, client } = pair();
    client.getMap('m').set('unsent', 1); // never reaches the server
    const update = updateOf(client, () => client.getMap('m').delete('unsent'));
    expect(isPureDeletion(update, server)).toBe(false);
  });

  it('refuses bytes that are not an update', () => {
    expect(isPureDeletion(Uint8Array.of(9, 9, 9, 9), new Y.Doc())).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- deletion`
Expected: FAIL — cannot resolve `../src/deletion`.

- [ ] **Step 3: Implement the pure module and the limit**

Create `apps/sync-server/src/deletion.ts`:

```ts
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

/** Yjs sync protocol message type byte. */
const MESSAGE_SYNC = 0;
/** Sync sub-types that carry a document update. */
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

/** The Yjs update inside a SyncStep2 or Update frame, or null for any other frame. */
export function readSyncUpdate(message: Uint8Array): Uint8Array | null {
  try {
    const decoder = decoding.createDecoder(message);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return null;
    const sub = decoding.readVarUint(decoder);
    if (sub !== SYNC_STEP2 && sub !== SYNC_UPDATE) return null;
    const update = decoding.readVarUint8Array(decoder);
    return decoding.hasContent(decoder) ? null : update;
  } catch {
    return null;
  }
}

/**
 * Whether `update` only deletes content `doc` already has: it adds no structs, and every range
 * of its delete set lies inside the document's state. A delete set that pointed past it would
 * be stored as pending and grow the document, so it is refused.
 */
export function isPureDeletion(update: Uint8Array, doc: Y.Doc): boolean {
  try {
    const { structs, ds } = Y.decodeUpdate(update);
    if (structs.length > 0) return false;
    const known = Y.decodeStateVector(Y.encodeStateVector(doc));
    for (const [client, ranges] of ds.clients) {
      const end = known.get(client) ?? 0;
      for (const range of ranges) if (range.clock + range.len > end) return false;
    }
    return true;
  } catch {
    return false;
  }
}
```

In `apps/sync-server/src/limits.ts`, add after `maxDocBytes`:

```ts
  /** A full board is editable again once a save measures this or less; the gap stops it flapping. */
  resumeDocBytes: 900 * 1024,
```

- [ ] **Step 4: Run the unit tests**

Run: `npm test -w @relay/sync-server -- deletion`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing integration test**

In `apps/sync-server/test/integration.test.ts`, add:

```ts
/** Collects the custom (`__YPS:`) messages a raw socket receives. */
function collectCustom(ws: WebSocket): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const text = data.toString();
    if (text.startsWith('__YPS:')) seen.push(JSON.parse(text.slice(6)) as Record<string, unknown>);
  });
  return seen;
}
```

```ts
  it('a full board says so, accepts deletions, refuses the rest and resumes when it shrinks', { timeout: 60_000 }, async () => {
    const { roomId, editKey } = await createRoom();
    const filler = connect(roomId, editKey);
    const clean = connect(roomId, editKey);
    const watcher = rawConnect(roomId, { key: editKey });
    const messages = collectCustom(watcher);
    await Promise.all([synced(filler.provider), synced(clean.provider), waitForOpen(watcher)]);
    addSticky(filler.doc, 'growing');
    addSticky(filler.doc, 'small');
    await waitFor(() => getRoots(clean.doc).shapes.has('small'));

    // Six sub-256 KB updates that together pass the 1 MB cap.
    for (let i = 0; i < 6; i++) {
      applyCommand(filler.doc, {
        type: 'SetText',
        id: 'growing',
        index: 0,
        deleteCount: 0,
        insert: 'x'.repeat(200_000),
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    await waitFor(() => messages.some((m) => m.type === 'room' && m.full === true));

    // A connection that arrives now learns it from hello.
    const late = rawConnect(roomId, { key: editKey });
    const lateHello = nextCustom(late);
    await waitForOpen(late);
    expect((await lateHello).full).toBe(true);

    // Anything that adds content is refused, and its sender is told once.
    const writer = connect(roomId, editKey);
    const told: string[] = [];
    writer.provider.on('custom-message', (raw: string) => told.push(raw));
    await synced(writer.provider);
    addSticky(writer.doc, 'after-cap');
    await waitFor(() => told.some((raw) => raw.includes('"rejected"')));
    expect(getRoots(clean.doc).shapes.has('after-cap')).toBe(false);

    // A deletion from a client that holds only what the server has is accepted.
    applyCommand(clean.doc, { type: 'DeleteShapes', ids: ['small'] });
    await waitFor(() => !getRoots(filler.doc).shapes.has('small'));

    // Deleting the big shape brings the board under 900 KB at the next save.
    applyCommand(clean.doc, { type: 'DeleteShapes', ids: ['growing'] });
    await waitFor(() => messages.some((m) => m.type === 'room' && m.full === false), 20_000);
    addSticky(clean.doc, 'resumed');
    await waitFor(() => getRoots(filler.doc).shapes.has('resumed'));
  });
```

- [ ] **Step 6: Run it and see it fail**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL — no `room` message ever arrives.

- [ ] **Step 7: Rewrite the room**

Replace `apps/sync-server/src/room.ts` with the file below. It carries Tasks 4 (with its review fix), 5 and 6 as they stand and replaces the size logic: `#frozen` becomes `#full`, the estimate follows the document's own updates, and a full board accepts pure deletions.

This task changes only the size logic: `#full`, `#estimatedBytes`, `#onDocUpdate`, `#setFull`, `onLoad`, `onSave`, `isReadOnly`, the `full` in `#sendHello`, `onMessage` and `#onUpdateWhileFull`. If the file in the repository differs from the listing anywhere else (`onConnect`, `#onAwareness`, the helpers above the class), the repository's version of that part stays: it is what Tasks 4 to 6 and their reviews left.

```ts
import { initMeta, isTimeRequest, type ServerMessage } from '@relay/core';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import { applyAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DEMO_ROOM, deriveKey, ROLE_HEADER, type Role, sessionId } from './auth';
import {
  encodeAwarenessUpdate,
  filterAwareness,
  readAwarenessMessage,
  wrapAwareness,
} from './awareness';
import { isPureDeletion, readSyncUpdate } from './deletion';
import type { Env } from './env';
import { LIMITS, messageBytes, TokenBucket } from './limits';

/**
 * What the room keeps on a connection. It survives hibernation. `__ypsAwarenessIds` is
 * y-partyserver's own key: on close it removes the awareness states of the ids listed there, so
 * the room records ownership in the same place.
 */
interface ConnState {
  role?: Role;
  sid?: string;
  rejected?: boolean;
  __ypsAwarenessIds?: unknown;
}

const stateOf = (connection: Connection): ConnState =>
  (connection.state as ConnState | null) ?? {};

const patchState = (connection: Connection, patch: ConnState): void => {
  connection.setState((prev: unknown) => ({ ...((prev as object | null) ?? {}), ...patch }));
};

const roleOf = (connection: Connection): Role | undefined => stateOf(connection).role;

/** The awareness client ids this connection owns. */
function ownedIds(connection: Connection): number[] {
  const ids = stateOf(connection).__ypsAwarenessIds;
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
}

/** Yjs awareness protocol message type byte. */
const MESSAGE_AWARENESS = 1;

function toBytes(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  return message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
}

/** True for a binary awareness-protocol frame. */
function isAwarenessMessage(message: ArrayBuffer | ArrayBufferView): boolean {
  return toBytes(message)[0] === MESSAGE_AWARENESS;
}

const encode = (message: ServerMessage): string => JSON.stringify(message);

/** One Durable Object per room: Yjs sync, capability roles, limits, SQLite persistence. */
export class Room extends YServer {
  static options = { hibernate: true };
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10_000, timeout: 5000 };

  /** YServer types `env` as the empty `Cloudflare.Env`; narrow it to this worker's bindings. */
  declare protected env: Env;

  /**
   * The document is over LIMITS.maxDocBytes: only deletions are accepted until a save measures
   * LIMITS.resumeDocBytes or less. In memory only, so a room that reloads between the two sizes
   * starts editable.
   */
  #full = false;
  /**
   * Running estimate of the document's encoded size: the last exact size plus the bytes of every
   * update the document has emitted since. Yjs emits only what was new, so a client re-sending
   * what the room already has adds nothing.
   */
  #estimatedBytes = 0;
  readonly #buckets = new Map<string, TokenBucket>();

  async onLoad(): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), data BLOB NOT NULL, updated_at INTEGER NOT NULL)',
    );
    const row = sql
      .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot WHERE id = 1')
      .toArray()[0];
    if (row) {
      const update = new Uint8Array(row.data);
      this.#full = update.byteLength > LIMITS.maxDocBytes;
      this.#estimatedBytes = update.byteLength;
      Y.applyUpdate(this.document, update);
    }
    this.document.on('update', this.#onDocUpdate);
    initMeta(
      this.document,
      this.name === DEMO_ROOM
        ? { title: 'Sprint 14 Retro', breadcrumb: ['Q3 Planning'] }
        : { title: 'Untitled board', breadcrumb: [] },
    );
  }

  /** Counts what the document really gained, and measures exactly when the estimate crosses the cap. */
  readonly #onDocUpdate = (update: Uint8Array): void => {
    this.#estimatedBytes += update.byteLength;
    if (this.#full || this.#estimatedBytes <= LIMITS.maxDocBytes) return;
    const real = Y.encodeStateAsUpdate(this.document).byteLength;
    this.#estimatedBytes = real;
    if (real > LIMITS.maxDocBytes) this.#setFull(true);
  };

  #setFull(full: boolean): void {
    if (this.#full === full) return;
    this.#full = full;
    this.broadcastCustomMessage(encode({ type: 'room', full, now: Date.now() }));
  }

  async onSave(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.document);
    this.#estimatedBytes = update.byteLength;
    if (update.byteLength > LIMITS.maxDocBytes) this.#setFull(true);
    else if (update.byteLength <= LIMITS.resumeDocBytes) this.#setFull(false);
    if (update.byteLength > LIMITS.maxRowBytes) {
      // Writing this would exceed Cloudflare's per-row BLOB limit and throw;
      // skip the write rather than lose the room to an uncaught save error.
      console.error(
        `Room ${this.name}: snapshot too large to persist (${update.byteLength} bytes)`,
      );
      return;
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO snapshot (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      new Uint8Array(update).buffer,
      Date.now(),
    );
  }

  isReadOnly(connection: Connection): boolean {
    return this.#full || roleOf(connection) !== 'edit';
  }

  onConnect(connection: Connection, ctx: ConnectionContext): void {
    const header = ctx.request.headers.get(ROLE_HEADER);
    const role: Role | null = header === 'edit' || header === 'view' ? header : null;
    if (!role) {
      connection.close(4401, 'unauthorized');
      return;
    }
    const sid = sessionId(new URL(ctx.request.url).searchParams.get('sid'));
    // By socket, not by id: the provider keeps its connection id across reconnects, so the
    // socket a reconnecting tab left behind has the same id as the new one.
    const others = [...this.getConnections()].filter((c) => c !== connection);
    // One tab has one socket, so an older connection with this session id is dead. It is
    // retired before counting, or a reconnecting user would be locked out by their own ghost.
    const stale = sid ? others.filter((c) => stateOf(c).sid === sid) : [];
    if (others.length - stale.length >= LIMITS.maxConnections) {
      connection.close(4503, 'room full');
      return;
    }
    const inherited: number[] = [];
    for (const old of stale) {
      inherited.push(...ownedIds(old));
      // Emptied first: closing the stale socket must not remove the states the new one keeps.
      patchState(old, { __ypsAwarenessIds: [] });
      old.close(4409, 'superseded');
    }
    patchState(connection, {
      role,
      ...(sid ? { sid } : {}),
      __ypsAwarenessIds: [...new Set(inherited)].slice(0, LIMITS.maxAwarenessIds),
    });
    super.onConnect(connection, ctx);
    // Tell the client its capability and the server clock (vote timers use server time).
    void this.#sendHello(connection, role);
  }

  /** Capability, server clock, whether the board is full and — for editors only — the view key. */
  async #sendHello(connection: Connection, role: Role): Promise<void> {
    let viewKey: string | undefined;
    // Every key edits the demo room, so a "view" link there would open an editable board.
    if (role === 'edit' && this.name !== DEMO_ROOM) {
      try {
        viewKey = await deriveKey(this.env.ROOM_SECRET, this.name, 'view');
      } catch {
        viewKey = undefined; // no secret configured: editors simply cannot share a view link
      }
    }
    this.sendCustomMessage(
      connection,
      encode({
        type: 'hello',
        role,
        now: Date.now(),
        full: this.#full,
        ...(viewKey ? { viewKey } : {}),
      }),
    );
  }

  onMessage(connection: Connection, message: WSMessage): void {
    // A socket whose role was rejected in onConnect (close() is not
    // instantaneous — the client can keep sending until the close handshake
    // completes) must never reach the Yjs protocol handler.
    if (!roleOf(connection)) return;
    if (messageBytes(message) > LIMITS.maxMessageBytes) {
      connection.close(1009, 'message too large');
      return;
    }
    let bucket = this.#buckets.get(connection.id);
    if (!bucket) {
      bucket = new TokenBucket(LIMITS.ratePerSecond, LIMITS.burst);
      this.#buckets.set(connection.id, bucket);
    }
    if (!bucket.take()) {
      // Closing (not dropping) keeps clients consistent: the reconnect re-runs a full sync.
      connection.close(4429, 'rate limited');
      return;
    }
    if (typeof message !== 'string') {
      if (isAwarenessMessage(message)) {
        this.#onAwareness(connection, toBytes(message));
        return;
      }
      if (this.#full && roleOf(connection) === 'edit') {
        const update = readSyncUpdate(toBytes(message));
        if (update) {
          this.#onUpdateWhileFull(connection, update);
          return;
        }
      }
    }
    super.onMessage(connection, message);
  }

  /**
   * A full board still takes deletions, so people can make room. y-partyserver would drop the
   * update (the room is read-only), so a pure deletion is applied here; its own update handler
   * then relays it to everyone.
   */
  #onUpdateWhileFull(connection: Connection, update: Uint8Array): void {
    if (isPureDeletion(update, this.document)) {
      Y.applyUpdate(this.document, update, connection);
      return;
    }
    if (stateOf(connection).rejected) return;
    patchState(connection, { rejected: true });
    this.sendCustomMessage(connection, encode({ type: 'rejected', now: Date.now() }));
  }

  /**
   * Awareness is handled here, not by y-partyserver, which would apply and relay any frame
   * as-is: a connection could then rewrite a peer's state, and every echo of a peer's state
   * would be relayed to the whole room again.
   */
  #onAwareness(connection: Connection, bytes: Uint8Array): void {
    if (bytes.byteLength > LIMITS.maxAwarenessBytes) return;
    const entries = readAwarenessMessage(bytes);
    if (!entries) {
      connection.close(4400, 'bad frame');
      return;
    }
    const ownedByOthers = new Set<number>();
    for (const other of this.getConnections()) {
      // By socket, not by id: a reconnecting tab keeps its connection id.
      if (other !== connection) for (const id of ownedIds(other)) ownedByOthers.add(id);
    }
    const verdict = filterAwareness(entries, {
      owned: ownedIds(connection),
      ownedByOthers,
      maxIds: LIMITS.maxAwarenessIds,
    });
    if (verdict.tooMany) {
      connection.close(4429, 'too many awareness identities');
      return;
    }
    if (verdict.accepted.length === 0) return;
    const update = encodeAwarenessUpdate(verdict.accepted);
    const { awareness } = this.document;
    applyAwarenessUpdate(awareness, update, connection);
    // An id stays owned while its state is there: a removal the protocol ignored frees nothing.
    const states = awareness.getStates();
    patchState(connection, { __ypsAwarenessIds: verdict.owned.filter((id) => states.has(id)) });
    const frame = wrapAwareness(update);
    for (const peer of this.getConnections()) {
      try {
        peer.send(frame);
      } catch {
        // A peer that is closing: its own close handler cleans up.
      }
    }
  }

  onCustomMessage(connection: Connection, message: string): void {
    if (!roleOf(connection)) return;
    if (isTimeRequest(message)) {
      this.sendCustomMessage(connection, encode({ type: 'time', now: Date.now() }));
    }
  }

  onClose(connection: Connection, code: number, reason: string, wasClean: boolean): void {
    this.#buckets.delete(connection.id);
    super.onClose(connection, code, reason, wasClean);
  }

  onError(connection: Connection, error: unknown): void | Promise<void> {
    this.#buckets.delete(connection.id);
    return super.onError(connection, error);
  }
}
```

- [ ] **Step 8: Run all the server tests**

Run: `npm test -w @relay/sync-server`
Expected: PASS, including the two older size tests (`freezes the room once an editor pushes it past the document size cap` and `does not stay frozen forever from re-sent no-op sync messages…`): a resend emits no document update, so the estimate does not move.

- [ ] **Step 9: Lint and commit**

Run: `npm run format && npm run lint && npm run typecheck`

```bash
git add apps/sync-server
git commit -m "feat(sync-server): a full board accepts deletions and resumes under 900 KB; the size estimate counts only what Yjs applied

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Close policy and connection wiring (web)

**Files:**
- Create: `apps/web/src/sync/closes.ts`
- Modify: `apps/web/src/sync/connection.ts`, `apps/web/src/ui/Header.tsx`
- Test: `apps/web/test/closes.test.ts` (create)

**Interfaces:**
- Consumes: Task 6's `INITIAL_CLOCK`; Task 5's `newSessionId`; Task 2's `sendOnlyOwnAwareness`.
- Produces:
  - `type StoppedStatus = 'unauthorized' | 'crowded' | 'throttled' | 'too-large'`
  - `closeAction(code: number | undefined, throttledAt: readonly number[], now: number): { action: CloseAction; throttledAt: number[] }` where `CloseAction = { kind: 'reconnect' } | { kind: 'stop'; status: StoppedStatus } | { kind: 'wait'; ms: number }`
  - `ConnStatus = 'connecting' | 'online' | 'offline' | StoppedStatus`
  - `RoomConnection.retry(): void` and `RoomConnection.discardAndReload(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/closes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { closeAction, THROTTLE_WAIT_MS } from '../src/sync/closes';

describe('closeAction', () => {
  it('stops for a bad key, a full room and a message too large to sync', () => {
    expect(closeAction(4401, [], 0).action).toEqual({ kind: 'stop', status: 'unauthorized' });
    expect(closeAction(4503, [], 0).action).toEqual({ kind: 'stop', status: 'crowded' });
    expect(closeAction(1009, [], 0).action).toEqual({ kind: 'stop', status: 'too-large' });
  });

  it('lets the provider reconnect for any other close', () => {
    for (const code of [1000, 1006, 4400, 4409, undefined]) {
      expect(closeAction(code, [], 0).action).toEqual({ kind: 'reconnect' });
    }
  });

  it('waits after a rate-limit close and stops at the third within a minute', () => {
    const first = closeAction(4429, [], 1000);
    expect(first.action).toEqual({ kind: 'wait', ms: THROTTLE_WAIT_MS });
    const second = closeAction(4429, first.throttledAt, 20_000);
    expect(second.action).toEqual({ kind: 'wait', ms: THROTTLE_WAIT_MS });
    const third = closeAction(4429, second.throttledAt, 40_000);
    expect(third.action).toEqual({ kind: 'stop', status: 'throttled' });
  });

  it('forgets rate-limit closes older than a minute', () => {
    const first = closeAction(4429, [], 0);
    const second = closeAction(4429, first.throttledAt, 30_000);
    const later = closeAction(4429, second.throttledAt, 70_000);
    expect(later.action).toEqual({ kind: 'wait', ms: THROTTLE_WAIT_MS });
    expect(later.throttledAt).toEqual([30_000, 70_000]);
  });

  it('leaves the rate-limit history alone for other closes', () => {
    expect(closeAction(1006, [5], 10).throttledAt).toEqual([5]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/web -- closes`
Expected: FAIL — cannot resolve `../src/sync/closes`.

- [ ] **Step 3: Implement the policy**

Create `apps/web/src/sync/closes.ts`:

```ts
/** Statuses in which the provider is disconnected and does not retry by itself. */
export type StoppedStatus = 'unauthorized' | 'crowded' | 'throttled' | 'too-large';

export type CloseAction =
  | { kind: 'reconnect' }
  | { kind: 'stop'; status: StoppedStatus }
  | { kind: 'wait'; ms: number };

/** How long to wait before reconnecting after the server closed for too many messages. */
export const THROTTLE_WAIT_MS = 5000;
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_STOP_AFTER = 3;

/**
 * What to do when the server closes the socket. The provider reconnects by itself, which is
 * wrong when the reconnect would fail the same way: a change too large to sync would be sent
 * again, and a full room would be dialled every few seconds.
 */
export function closeAction(
  code: number | undefined,
  throttledAt: readonly number[],
  now: number,
): { action: CloseAction; throttledAt: number[] } {
  const same = [...throttledAt];
  switch (code) {
    case 4401:
      return { action: { kind: 'stop', status: 'unauthorized' }, throttledAt: same };
    case 4503:
      return { action: { kind: 'stop', status: 'crowded' }, throttledAt: same };
    case 1009:
      return { action: { kind: 'stop', status: 'too-large' }, throttledAt: same };
    case 4429: {
      const recent = [...throttledAt.filter((t) => now - t < THROTTLE_WINDOW_MS), now];
      return recent.length >= THROTTLE_STOP_AFTER
        ? { action: { kind: 'stop', status: 'throttled' }, throttledAt: recent }
        : { action: { kind: 'wait', ms: THROTTLE_WAIT_MS }, throttledAt: recent };
    }
    default:
      return { action: { kind: 'reconnect' }, throttledAt: same };
  }
}
```

- [ ] **Step 4: Run the policy tests**

Run: `npm test -w @relay/web -- closes`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the connection**

Replace `apps/web/src/sync/connection.ts`:

```ts
import { parseServerMessage, TIME_REQUEST } from '@relay/core';
import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { type ClockState, INITIAL_CLOCK, nextClock, TIME_REFRESH_MS } from './clock';
import { closeAction, type StoppedStatus } from './closes';
import { newSessionId } from './key';
import { sendOnlyOwnAwareness } from './ownAwareness';

export type ConnStatus = 'connecting' | 'online' | 'offline' | StoppedStatus;

const STOPPED: ReadonlySet<ConnStatus> = new Set<ConnStatus>([
  'unauthorized',
  'crowded',
  'throttled',
  'too-large',
]);

export interface RoomConnection {
  doc: Y.Doc;
  provider: YProvider;
  status: StoreApi<{ status: ConnStatus }>;
  clock: StoreApi<ClockState>;
  /** Current server time in epoch ms (local time until the first hello). */
  serverNow(): number;
  /** Connects again after a stop (too many people, too many messages). */
  retry(): void;
  /**
   * Deletes this room's local copy and reloads the page. The only way out when the server
   * refused a change: the local document holds it and would send it again.
   */
  discardAndReload(): Promise<void>;
  destroy(): void;
}

export function connectRoom(opts: {
  roomId: string;
  key: string | null;
  host: string;
}): RoomConnection {
  const doc = new Y.Doc();
  const local = new IndexeddbPersistence(`relay:${opts.roomId}`, doc);
  const sid = newSessionId();
  const provider = new YProvider(opts.host, opts.roomId, doc, {
    party: 'room',
    params: opts.key ? { key: opts.key, sid } : { sid },
  });
  sendOnlyOwnAwareness(provider);
  const status = createStore<{ status: ConnStatus }>(() => ({ status: 'connecting' }));

  provider.on('status', ({ status: s }: { status: string }) => {
    if (STOPPED.has(status.getState().status)) return;
    status.setState({
      status: s === 'connected' ? 'online' : s === 'connecting' ? 'connecting' : 'offline',
    });
  });

  let throttledAt: number[] = [];
  let waiting: ReturnType<typeof setTimeout> | undefined;
  provider.on('connection-close', (event: CloseEvent | null) => {
    const next = closeAction(event?.code, throttledAt, Date.now());
    throttledAt = next.throttledAt;
    const { action } = next;
    if (action.kind === 'reconnect') return;
    provider.disconnect();
    if (action.kind === 'stop') {
      status.setState({ status: action.status });
      return;
    }
    status.setState({ status: 'offline' });
    clearTimeout(waiting);
    waiting = setTimeout(() => provider.connect(), action.ms);
  });

  const clock = createStore<ClockState>(() => INITIAL_CLOCK);
  provider.on('custom-message', (raw: string) => {
    const msg = parseServerMessage(raw);
    if (msg) clock.setState(nextClock(clock.getState(), msg, Date.now()));
  });
  const refresh = setInterval(() => {
    if (status.getState().status === 'online') provider.sendMessage(TIME_REQUEST);
  }, TIME_REFRESH_MS);

  return {
    doc,
    provider,
    status,
    clock,
    serverNow: () => Date.now() + clock.getState().offset,
    retry() {
      clearTimeout(waiting);
      throttledAt = [];
      status.setState({ status: 'connecting' });
      provider.connect();
    },
    async discardAndReload() {
      clearTimeout(waiting);
      provider.disconnect();
      await local.clearData();
      window.location.reload();
    },
    destroy() {
      clearInterval(refresh);
      clearTimeout(waiting);
      provider.destroy();
      void local.destroy();
      doc.destroy();
    },
  };
}
```

- [ ] **Step 6: Label the new statuses in the header**

In `apps/web/src/ui/Header.tsx`, extend `STATUS_LABEL`:

```ts
const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline',
  unauthorized: 'No access',
  crowded: 'Board busy',
  throttled: 'Paused',
  'too-large': 'Not saved',
};
```

- [ ] **Step 7: Run, lint, commit**

Run: `npm test -w @relay/web && npm run format && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): stop reconnecting when the retry would fail the same way; retry and discard-and-reload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The controller applies only what the board's access allows

The server refuses two kinds of change: every change from a viewer, and every change but a pure deletion on a full board. A refused change that was already applied locally stays in the user's own copy, and in IndexedDB, and never reaches anyone else. So the controller does not apply it at all. One notion says what is allowed, `BoardAccess`: `edit`, `delete-only` (an editor on a full board) or `read-only` (a viewer).

`BoardAccess` is not `capability` (Task 6). `capability` treats a role that is not known yet as `view`, which is right for what must wait for the server (voting, commenting, sharing). The board itself keeps working before the server's hello and offline, so for `boardAccess` an unknown role still edits, as it does today.

**Files:**
- Modify: `packages/core/src/commands/full.ts`, `apps/web/src/sync/clock.ts`, `apps/web/src/board/controller.ts`, `apps/web/src/board/session.ts`
- Test: `packages/core/test/full.test.ts`, `apps/web/test/clock.test.ts`, `apps/web/test/controller.test.ts`

**Interfaces:**
- Consumes: `allowedWhenFull` (Task 7); `ClockState` and the `Capable` type inside `clock.ts` (Task 6).
- Produces (core, `commands/full.ts`): `type BoardAccess = 'edit' | 'delete-only' | 'read-only'`; `allowedFor(access: BoardAccess, command: Command): boolean`.
- Produces (web): `boardAccess(c: Pick<ClockState, 'role' | 'full'>): BoardAccess` in `sync/clock.ts`; the `createBoardController` option `access?: () => BoardAccess` (default: always `'edit'`).

- [ ] **Step 1: Write the failing core test**

In `packages/core/test/full.test.ts`, add `allowedFor` to the import from `'../src'` and append:

```ts
describe('allowedFor', () => {
  const move = { type: 'MoveShapes' as const, moves: [] };
  const remove = { type: 'DeleteShapes' as const, ids: ['a'] };

  it('edit applies everything, delete-only what only deletes, read-only nothing', () => {
    expect(allowedFor('edit', move)).toBe(true);
    expect(allowedFor('edit', remove)).toBe(true);
    expect(allowedFor('delete-only', move)).toBe(false);
    expect(allowedFor('delete-only', remove)).toBe(true);
    expect(allowedFor('read-only', move)).toBe(false);
    expect(allowedFor('read-only', remove)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -w @relay/core -- full`
Expected: FAIL — `allowedFor` is not exported.

- [ ] **Step 3: Implement it in core**

Append to `packages/core/src/commands/full.ts`:

```ts
/** What the board lets a user change: everything, deletions only, or nothing. */
export type BoardAccess = 'edit' | 'delete-only' | 'read-only';

/** Whether a user with `access` may apply `command`. */
export function allowedFor(access: BoardAccess, command: Command): boolean {
  return access === 'edit' || (access === 'delete-only' && allowedWhenFull(command));
}
```

Run: `npm test -w @relay/core -- full`
Expected: PASS.

- [ ] **Step 4: Write the failing web tests**

In `apps/web/test/clock.test.ts`, add `boardAccess` to the import from `'../src/sync/clock'` and append:

```ts
describe('boardAccess', () => {
  it('a viewer is read-only, an editor on a full board only deletes, and an unknown role edits', () => {
    expect(boardAccess({ role: 'view', full: false })).toBe('read-only');
    expect(boardAccess({ role: 'view', full: true })).toBe('read-only');
    expect(boardAccess({ role: 'edit', full: false })).toBe('edit');
    expect(boardAccess({ role: 'edit', full: true })).toBe('delete-only');
    expect(boardAccess({ role: null, full: false })).toBe('edit');
  });
});
```

In `apps/web/test/controller.test.ts`, add `type BoardAccess` to the import from `'@relay/core'`, and widen `setup`'s parameter type to accept the option (it already spreads `...opts` into `createBoardController`):

```ts
function setup(
  opts: {
    cameraStorage?: CameraStorage;
    serverNow?: () => number;
    access?: () => BoardAccess;
  } = {},
) {
```

Append a describe block:

```ts
describe('board controller by access', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const sticky = (id: string) => ({
    type: 'CreateShape' as const,
    shape: {
      id,
      type: 'sticky' as const,
      x: 0,
      y: 0,
      w: 180,
      h: 140,
      style: DEFAULT_STYLE.sticky,
      text: 'note',
      createdBy: 'u1',
      authorName: 'Test',
      createdAt: 0,
    },
  });

  it('on a full board applies deletions and drops everything else', () => {
    let access: BoardAccess = 'edit';
    const { doc, controller } = setup({ access: () => access });
    controller.commit(sticky('a'), sticky('b'));
    expect(getRoots(doc).shapes.size).toBe(2);

    access = 'delete-only';
    controller.commit(sticky('c'));
    controller.commit({ type: 'MoveShapes', moves: [{ id: 'a', x: 50, y: 50 }] });
    controller.commitSession({ type: 'EndVote' });
    expect(getRoots(doc).shapes.has('c')).toBe(false);
    expect(getRoots(doc).shapes.get('a')?.get('x')).toBe(0);

    controller.commit({ type: 'DeleteShapes', ids: ['a'] });
    expect(getRoots(doc).shapes.has('a')).toBe(false);
  });

  it('for a viewer applies nothing, a deletion included', () => {
    let access: BoardAccess = 'edit';
    const { doc, controller } = setup({ access: () => access });
    controller.commit(sticky('a'));

    access = 'read-only';
    controller.commit(sticky('b'));
    controller.commit({ type: 'DeleteShapes', ids: ['a'] });
    controller.renameBoard('Mine now');
    expect(getRoots(doc).shapes.has('b')).toBe(false);
    expect(getRoots(doc).shapes.has('a')).toBe(true);
    expect(getRoots(doc).meta.get('title')).toBeUndefined();
  });

  it('does not undo or redo unless the board takes edits: an undo would write content back', () => {
    let access: BoardAccess = 'edit';
    const { doc, controller } = setup({ access: () => access });
    controller.commit(sticky('a'));
    for (const blocked of ['delete-only', 'read-only'] as const) {
      access = blocked;
      controller.undo();
      expect(getRoots(doc).shapes.has('a')).toBe(true);
    }
    access = 'edit';
    controller.undo();
    expect(getRoots(doc).shapes.has('a')).toBe(false);
  });
});
```

- [ ] **Step 5: Run them and see them fail**

Run: `npm test -w @relay/web -- clock controller.test`
Expected: FAIL — `boardAccess` is not exported; with `delete-only` sticky `c` is created; with `read-only` sticky `b` is created and `a` deleted; the undo removes `a` while the board takes no edits.

- [ ] **Step 6: Implement the selector**

In `apps/web/src/sync/clock.ts`, add `BoardAccess` to the type import from `'@relay/core'`:

```ts
import type { BoardAccess, Role, ServerMessage } from '@relay/core';
```

and append:

```ts
/**
 * What the board lets this user change in their own copy. It differs from `capability` in one
 * case: a role not known yet (before the server's hello, or offline) still edits, so an editor
 * who opens a board offline keeps working. Only a role the server named `view` is read-only.
 */
export function boardAccess(c: Capable): BoardAccess {
  if (c.role === 'view') return 'read-only';
  return c.role === 'edit' && c.full ? 'delete-only' : 'edit';
}
```

- [ ] **Step 7: Implement the guard**

In `apps/web/src/board/controller.ts`:

Add `allowedFor` and `type BoardAccess` to the imports from `'@relay/core'`.

Add the option to `createBoardController`'s `opts` type, after `notify`:

```ts
  /** What the board lets this user change right now (default: edit). */
  access?: () => BoardAccess;
```

Replace the three commit functions (`commit`, `commitSession`, `commitPage`) and the `throttledCommit` line between them with:

```ts
  const access = opts.access ?? ((): BoardAccess => 'edit');
  /**
   * A command the server would refuse is not applied at all: it would stay in this user's own
   * copy and never reach the others. For a viewer that is every command; on a full board,
   * every command that is not a pure deletion.
   */
  const apply = (command: Command, origin: string) => {
    if (allowedFor(access(), command)) applyCommand(opts.doc, command, origin);
  };
  const commit = (command: Command) => apply(command, LOCAL_ORIGIN);
  const throttledCommit = throttle(commit, 50);
  const commitSession = (command: Command) => apply(command, SESSION_ORIGIN);
  // Page commands touch untracked roots, except DeletePage, which also deletes the page's
  // shapes: on SESSION_ORIGIN a page delete never becomes an undo step that resurrects
  // shapes on a tombstoned page.
  const commitPage = (command: Command) => apply(command, SESSION_ORIGIN);
```

At the top of `travel`, add:

```ts
    // Undoing a deletion (or redoing a creation) writes content, which only an editor on a
    // board that takes edits may do.
    if (access() !== 'edit') return;
```

In `apps/web/src/board/session.ts`, import `boardAccess` from `'../sync/clock'` and pass the option to `createBoardController`, after `notify: toast,`:

```ts
    access: () => boardAccess(conn.clock.getState()),
```

- [ ] **Step 8: Run, lint, commit**

Run: `npm test -w @relay/core && npm test -w @relay/web && npm run format && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add packages/core apps/web
git commit -m "feat: the controller applies only what the board's access allows — nothing for a viewer, deletions on a full board; undo is off without edit access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The UI reads the capability; delete actions stay on a full board

A full board looks like a viewer's board with the delete actions kept. First every `role === 'edit'` read becomes `mayEdit`, which hides creating and editing when the board is full. Then the delete paths are opened to `mayDelete`. The canvas itself is Task 15's: the tools that create, dragging, resize handles and text editing were never gated for viewers, so `mayEdit` alone does not hide them.

**Files:**
- Modify (read `mayEdit`): `apps/web/src/board/Board.tsx`, `render/Canvas.tsx`, `render/CommentComposer.tsx`, `render/CommentLayer.tsx`, `render/EmptyHint.tsx`, `render/VoteBadge.tsx`, `sheet/SheetPage.tsx`, `sheet/useSheetClipboard.ts`, `sheet/useSheetKeys.ts`, `ui/BoardTitle.tsx`, `ui/CanvasMenu.tsx`, `ui/PageTabs.tsx`, `ui/PropertiesBar.tsx`, `ui/Toolbar.tsx`, `ui/UndoRedo.tsx`, `ui/useClipboard.ts`, `ui/VoteControl.tsx`, `calendar/CalendarHeader.tsx`, `calendar/CalendarPage.tsx`, `calendar/EventEditor.tsx`, `calendar/MonthView.tsx`, `calendar/WeekView.tsx`, `calendar/useCalendarKeys.ts` (all under `apps/web/src/`)
- Modify (delete paths): `ui/shortcuts.ts`, `ui/useShortcuts.ts`, `ui/canvasMenuItems.ts`, `ui/CanvasMenu.tsx`, `sheet/sheetController.ts`, `sheet/cellMenu.ts`, `sheet/SheetGrid.tsx`, `sheet/SheetHeaders.tsx`, `sheet/SheetPage.tsx`, `sheet/useSheetKeys.ts`, `calendar/calendarController.ts`, `calendar/CalendarPage.tsx`, `calendar/EventEditor.tsx`, `calendar/useCalendarKeys.ts`
- Test: `apps/web/test/shortcuts.test.ts`, `apps/web/test/canvasMenu.test.ts`, `apps/web/test/cellMenu.test.ts`, `apps/web/test/deleteOnly.test.ts` (create)

**Interfaces:**
- Consumes: `mayEdit`, `mayDelete`, `capability`, `Capability` from `apps/web/src/sync/clock.ts`. They are named `may…` because most components already hold a local boolean called `canEdit`, which an import of the same name would shadow.
- Produces: `gateByCapability(action, cap: Capability)` (replaces `gateByRole`); `CanvasMenuContext.canDelete: boolean`; `cellMenu(canEdit, actions, canDelete?)`; sheet and calendar controller option `canDelete?: () => boolean`.

- [ ] **Step 1: Replace every role comparison with `mayEdit`**

Import `mayEdit` from the clock module (`'../sync/clock'` from `board/`, `render/`, `sheet/`, `ui/`, `calendar/`) in each file below and apply the matching rewrite:

| Pattern in the file | Replace with |
|---|---|
| `useStore(session.conn.clock, (c) => c.role === 'edit')` | `useStore(session.conn.clock, mayEdit)` |
| `session.conn.clock.getState().role === 'edit'` | `mayEdit(session.conn.clock.getState())` |
| `conn.clock.getState().role === 'edit'` (`ui/useClipboard.ts`) | `mayEdit(conn.clock.getState())` |
| `const role = useStore(session.conn.clock, (c) => c.role);` followed by `role === 'edit'` / `role !== 'edit'` (`render/CommentComposer.tsx`, `render/VoteBadge.tsx`, `ui/Toolbar.tsx`, `ui/VoteControl.tsx`) | `const editable = useStore(session.conn.clock, mayEdit);` and `editable` / `!editable`. If the file uses `role` for anything else, keep that line and add `editable` beside it |

Leave `ui/ShareDialog.tsx` and `ui/shareLinks.ts` alone: sharing links depends on the role, not on the board being full.

Verify: `grep -rn "role === 'edit'\|role !== 'edit'" apps/web/src` lists only `ui/ShareDialog.tsx`, `ui/shareLinks.ts` and `ui/shortcuts.ts` (the last one is rewritten in Step 3).

Run: `npm run typecheck && npm test -w @relay/web`
Expected: PASS — nothing is full yet in any test, so behaviour is unchanged.

- [ ] **Step 2: Write the failing tests for the delete paths**

In `apps/web/test/shortcuts.test.ts`, rename every `gateByRole` to `gateByCapability` (import included) and replace each `null` passed as the second argument with `'view'`. Where a test iterates roles with `null` in the list, use `'view'` once. Then append inside the top-level describe:

```ts
  it('on a full board only the delete shortcut changes the document', () => {
    const del = keyDownAction(key('Delete'), false);
    expect(gateByCapability(del, 'delete-only')).toEqual(del);
    expect(gateByCapability({ type: 'undo' }, 'delete-only')).toBeNull();
    expect(gateByCapability({ type: 'duplicate' }, 'delete-only')).toBeNull();
    expect(gateByCapability({ type: 'selectAll' }, 'delete-only')).toEqual({ type: 'selectAll' });
    expect(gateByCapability(del, 'view')).toBeNull();
  });
```

(`key` here stands for the file's own helper that builds a `KeyInput`; use whatever that helper is called in the file. `keyDownAction(e, leavesKeyAlone)` takes the input and a boolean.)

In `apps/web/test/canvasMenu.test.ts`, every context object passed to `canvasMenu` gains `canDelete: <same value as canEdit>`. Append:

```ts
it('on a full board a selection offers Copy, Delete and Zoom to fit', () => {
  const remove = vi.fn();
  const items = canvasMenu(
    {
      canEdit: false,
      canDelete: true,
      selection: ['a'],
      shapes: { a: shape('a') },
      connectors: {},
      world: { x: 0, y: 0 },
      hitId: 'a',
      voteOpen: false,
      voted: false,
    },
    { remove } as unknown as CanvasMenuActions,
  );
  const ids = items.flatMap((i) => ('testId' in i && i.testId ? [i.testId] : []));
  expect(ids).toEqual(['menu-copy', 'menu-delete', 'menu-fit']);
});

it('a viewer still gets only Copy and Zoom to fit', () => {
  const items = canvasMenu(
    {
      canEdit: false,
      canDelete: false,
      selection: ['a'],
      shapes: { a: shape('a') },
      connectors: {},
      world: { x: 0, y: 0 },
      hitId: 'a',
      voteOpen: false,
      voted: false,
    },
    {} as CanvasMenuActions,
  );
  const ids = items.flatMap((i) => ('testId' in i && i.testId ? [i.testId] : []));
  expect(ids).toEqual(['menu-copy', 'menu-fit']);
});
```

In `apps/web/test/cellMenu.test.ts`, append:

```ts
describe('cellMenu on a full board', () => {
  const actions = { cut() {}, copy() {}, paste() {}, clear() {} };

  it('offers Copy and Clear contents when the user may only delete', () => {
    expect(cellMenu(false, actions, true).map((i) => i.testId)).toEqual([
      'cell-menu-copy',
      'cell-menu-clear',
    ]);
  });

  it('offers only Copy to a viewer', () => {
    expect(cellMenu(false, actions, false).map((i) => i.testId)).toEqual(['cell-menu-copy']);
    expect(cellMenu(false, actions).map((i) => i.testId)).toEqual(['cell-menu-copy']);
  });
});
```

(Add `cellMenu` to that file's import from `'../src/sheet/cellMenu'` if it is not imported yet.)

Create `apps/web/test/deleteOnly.test.ts`:

```ts
import { allowedWhenFull, applyCommand, type Command, SESSION_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCalendarController } from '../src/calendar/calendarController';
import { createSheetController } from '../src/sheet/sheetController';
import { createCalendarStore } from '../src/store/calendarStore';
import { createDocStore } from '../src/store/docStore';
import { createSheetStore } from '../src/store/sheetStore';

/** Records what a controller commits, and applies it so the stores follow. */
function recorder(doc: Y.Doc) {
  const committed: Command[] = [];
  const commit = (...commands: Command[]) => {
    committed.push(...commands);
    for (const c of commands) applyCommand(doc, c);
    return true;
  };
  return { committed, commit };
}

describe('sheet controller on a full board', () => {
  function setup() {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id: 'p', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
        sheet: {
          rows: ['a0', 'a1'].map((order, i) => ({ id: `r${i}`, order })),
          cols: ['a0', 'a1'].map((order, i) => ({ id: `c${i}`, order })),
        },
      },
      SESSION_ORIGIN,
    );
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'p',
      cells: [
        { row: 'r0', col: 'c0', src: 'bold', fmt: { bold: true } },
        { row: 'r1', col: 'c1', src: 'plain' },
      ],
    });
    const docs = createDocStore(doc, 'p');
    const sheet = createSheetStore(doc, docs.store);
    const { committed, commit } = recorder(doc);
    const ctl = createSheetController({
      sheet: sheet.store,
      commit,
      canEdit: () => false,
      canDelete: () => true,
    });
    return { ctl, committed };
  }

  it('clears cells with their formats, so the write is a pure deletion', () => {
    const { ctl, committed } = setup();
    ctl.selectAll();
    ctl.clear();
    expect(committed).toHaveLength(1);
    expect(committed.every(allowedWhenFull)).toBe(true);
  });

  it('deletes rows but does not start an edit', () => {
    const { ctl, committed } = setup();
    ctl.startEdit('x');
    expect(ctl.ui.getState().editing).toBeNull();
    ctl.deleteRows();
    expect(committed.map((c) => c.type)).toEqual(['DeleteRows']);
  });
});

describe('calendar controller on a full board', () => {
  it('removes an event', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id: 'cal', type: 'calendar', title: 'C', order: 'a1', createdBy: 'u', createdAt: 0 },
      },
      SESSION_ORIGIN,
    );
    applyCommand(doc, {
      type: 'CreateEvent',
      pageId: 'cal',
      id: 'e1',
      fields: {
        title: 'Standup',
        color: '#E85A1B',
        when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
        createdBy: 'u',
        createdAt: 0,
      },
    });
    const docs = createDocStore(doc, 'cal');
    const calendar = createCalendarStore(doc, docs.store);
    const { committed, commit } = recorder(doc);
    const ctl = createCalendarController({
      calendar: calendar.store,
      commit,
      commitSession: () => {},
      canEdit: () => false,
      canDelete: () => true,
      notify: () => {},
      user: { id: 'u', name: 'U' },
      zone: 'UTC',
      now: () => Date.UTC(2026, 9, 5),
    });
    ctl.remove({ eventId: 'e1', key: '2026-10-05' });
    expect(committed).toEqual([{ type: 'DeleteEvent', pageId: 'cal', id: 'e1' }]);
  });
});
```

(If `OccRef` in `calendarController.ts` has more fields than `eventId` and `key`, fill them from its type; `remove` reads only `eventId` for an event without a rule.)

- [ ] **Step 3: Run them and see them fail**

Run: `npm test -w @relay/web -- shortcuts canvasMenu cellMenu deleteOnly`
Expected: FAIL — `gateByCapability` does not exist; the menus ignore `canDelete`; the controllers reject `canDelete` and commit nothing.

- [ ] **Step 4: Board — the Delete key and the context menu**

In `apps/web/src/ui/shortcuts.ts`, replace `gateByRole` (import `Capability` from `'../sync/clock'`; drop the `Role` import if nothing else uses it):

```ts
/**
 * Drops shortcuts the user may not use. Only an editor changes the document (delete, nudge,
 * routing, duplicate, restack, undo, redo) or picks the comment tool; on a full board an editor
 * keeps the delete shortcut only. The server drops the rest anyway; this keeps the local doc
 * and IndexedDB from forking.
 */
export function gateByCapability(
  action: ShortcutAction | null,
  cap: Capability,
): ShortcutAction | null {
  if (!action || cap === 'edit') return action;
  if (
    cap === 'delete-only' &&
    action.type === 'dispatch' &&
    action.event.type === 'deleteSelection'
  ) {
    return action;
  }
  switch (action.type) {
    case 'duplicate':
    case 'z':
    case 'undo':
    case 'redo':
      return null;
    case 'dispatch': {
      const { event } = action;
      if (MUTATING_EVENTS.has(event.type)) return null;
      if (event.type === 'setTool' && event.tool === 'comment') return null;
      return action;
    }
    default:
      return action;
  }
}
```

In `apps/web/src/ui/useShortcuts.ts`, import `gateByCapability` and `capability`, and change the keydown handler:

```ts
    // The capability is read at keydown time, so a late `hello` or a board becoming full applies at once.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!onBoardPage(session)) return;
      run(
        gateByCapability(
          keyDownAction(e, leavesKeyAlone(e.target, e.key)),
          capability(conn.clock.getState()),
        ),
        e,
      );
    };
```

In `apps/web/src/ui/canvasMenuItems.ts`, add to `CanvasMenuContext`:

```ts
  /** Deleting is allowed (true for an editor even on a full board). */
  canDelete: boolean;
```

and replace the line `if (!ctx.canEdit) return empty ? [fit] : [copy, fit];` with:

```ts
  if (!ctx.canEdit) {
    if (empty) return [fit];
    if (!ctx.canDelete) return [copy, fit];
    // A full board: nothing can be created or changed, but the selection can go.
    const removable = shapes.some((s) => !s.locked) || connectors.length > 0;
    return [
      copy,
      {
        label: 'Delete',
        hint: 'Del',
        onSelect: a.remove,
        disabled: !removable,
        danger: true,
        testId: 'menu-delete',
      },
      fit,
    ];
  }
```

In `apps/web/src/ui/CanvasMenu.tsx`, import `mayDelete` beside `mayEdit`, read it, and pass it:

```ts
  const deletable = useStore(session.conn.clock, mayDelete);
```

```ts
      canEdit,
      canDelete: deletable,
```

- [ ] **Step 5: Sheets — clearing cells and deleting rows and columns**

In `apps/web/src/sheet/sheetController.ts`:

Add the option after `canEdit` in `createSheetController`'s `opts`:

```ts
  /** Deleting is allowed (an editor on a full board); defaults to `canEdit`. */
  canDelete?: () => boolean;
```

Replace `run` and `setCells`:

```ts
  const run = (...commands: Command[]): boolean =>
    opts.canEdit() && commands.length > 0 && opts.commit(...commands);
  const canDelete = () => (opts.canDelete ?? opts.canEdit)();
  /** For commands that only delete: they still go through on a full board. */
  const runDelete = (...commands: Command[]): boolean =>
    canDelete() && commands.length > 0 && opts.commit(...commands);

  /** Writes cells (edit, clear, format, fill); paste checks its budget with its own wording. */
  const setCells = (cells: SheetCellWrite[], gate: typeof run = run): boolean => {
    const pageId = page();
    if (!pageId || cells.length === 0) return false;
    if (batchBytes(cells) > MAX_SHEET_BATCH_BYTES) {
      notify('Too many cells at once');
      return false;
    }
    return gate({ type: 'SetCells', pageId, cells });
  };
```

Replace `clear`:

```ts
  const clear = () => {
    const s = snap();
    const r = range();
    if (!s || !r) return;
    // Clearing keeps a cell's format. On a full board that would write the cell again, which
    // the server refuses, so there the format goes with the content.
    const keepFormat = opts.canEdit();
    const writes: SheetCellWrite[] = [];
    for (let i = r.r0; i <= r.r1; i++)
      for (let j = r.c0; j <= r.c1; j++) {
        const c = cellAt(s, i, j);
        if (!c?.cell) continue;
        if (keepFormat) {
          if (c.cell.src) writes.push(write(c.row, c.col, '', c.cell.fmt));
        } else {
          writes.push(write(c.row, c.col, ''));
        }
      }
    setCells(writes, keepFormat ? run : runDelete);
  };
```

In `deleteRows` and `deleteCols`, change `run(` to `runDelete(` on the lines that commit `DeleteRows` and `DeleteCols`.

In `apps/web/src/sheet/cellMenu.ts`, replace `cellMenu`:

```ts
/**
 * The menu of the selected cells (right-click, or press and hold on a touch screen, where there
 * is no Ctrl+C, Ctrl+V or Delete). Viewers can only copy; on a full board an editor can also
 * clear.
 */
export function cellMenu(
  canEdit: boolean,
  a: { cut(): void; copy(): void; paste(): void; clear(): void },
  canDelete: boolean = canEdit,
): MenuItem[] {
  const copy: MenuItem = {
    label: 'Copy',
    hint: 'Ctrl C',
    testId: 'cell-menu-copy',
    onSelect: a.copy,
  };
  const clear: MenuItem = {
    label: 'Clear contents',
    hint: 'Del',
    testId: 'cell-menu-clear',
    onSelect: a.clear,
  };
  if (!canEdit) return canDelete ? [copy, clear] : [copy];
  return [
    { label: 'Cut', hint: 'Ctrl X', testId: 'cell-menu-cut', onSelect: a.cut },
    copy,
    { label: 'Paste', hint: 'Ctrl V', testId: 'cell-menu-paste', onSelect: a.paste },
    clear,
  ];
}
```

In `apps/web/src/sheet/useSheetKeys.ts`, import `mayDelete` from `'../sync/clock'` and replace the line `if (!canEdit) return;` that precedes the `F2` branch with:

```ts
      if (!canEdit) {
        // A full board: Delete still clears the selected cells.
        const del = e.key === 'Delete' || e.key === 'Backspace';
        if (del && mayDelete(session.conn.clock.getState())) {
          e.preventDefault();
          ctl.clear();
        }
        return;
      }
```

In `apps/web/src/sheet/SheetHeaders.tsx`, give `useSheetHeaders` a fourth parameter and use it in `openMenu`:

```ts
export function useSheetHeaders(
  session: BoardSession,
  ctl: SheetController,
  canEdit: boolean,
  canDelete: boolean,
) {
```

```ts
    if (!canEdit && !canDelete) return;
```

and at the end of `openMenu`:

```ts
    // A full board keeps only the deleting entries (the ones marked `danger`).
    setMenu({ x, y, items: canEdit ? items : items.filter((item) => item.danger) });
```

In `apps/web/src/sheet/SheetGrid.tsx`, add a `canDelete: boolean` prop beside `canEdit` (in the destructured props and in the props type) and pass it to the menu:

```ts
  const menuItems = cellMenu(
    canEdit,
    {
      // …the four existing actions, unchanged…
    },
    canDelete,
  );
```

In `apps/web/src/sheet/SheetPage.tsx`, import `mayDelete` from `'../sync/clock'`; in `SheetPage` read it and pass it to the controller and to `SheetBody`:

```ts
  const deletable = useStore(session.conn.clock, mayDelete);
```

```ts
      canEdit: () => mayEdit(session.conn.clock.getState()),
      canDelete: () => mayDelete(session.conn.clock.getState()),
```

```tsx
  return <SheetBody session={session} ctl={ctl} canEdit={canEdit} canDelete={deletable} />;
```

In `SheetBody`, add `canDelete: boolean` to its props, call `useSheetHeaders(session, ctl, canEdit, canDelete)`, and pass `canDelete={canDelete}` to `SheetGrid`.

- [ ] **Step 6: Calendar — removing an event**

In `apps/web/src/calendar/calendarController.ts`:

Add to `CalendarControllerOptions` after `canEdit`:

```ts
  /** Deleting is allowed (an editor on a full board); defaults to `canEdit`. */
  canDelete?(): boolean;
```

Inside `createCalendarController`, next to the other helpers:

```ts
  const canDelete = () => (opts.canDelete ? opts.canDelete() : opts.canEdit());
```

Replace `remove`:

```ts
    remove(ref) {
      const page = pageId();
      const ev = eventById(ref.eventId);
      if (!canDelete() || !page || !ev) return;
      const done = () => ui.setState({ selected: null, editor: null });
      if (!ev.rule) {
        if (commitEvent({ type: 'DeleteEvent', pageId: page, id: ev.id })) done();
        return;
      }
      // Cancelling one occurrence writes an exception. A full board refuses that, so there
      // only the whole series can be removed.
      const allOnly = !opts.canEdit();
      ask(
        ref,
        { action: 'delete', drops: 0, ...(allOnly ? { allOnly: true as const } : {}) },
        (scope) => {
          const cur = eventById(ref.eventId);
          if (!cur) return;
          const ok =
            scope === 'one'
              ? setOccurrence(cur, ref.key, { cancelled: true })
              : commitEvent({ type: 'DeleteEvent', pageId: page, id: cur.id });
          if (ok) done();
        },
      );
    },
```

In `answer`, change the guard `!opts.canEdit()` to `!canDelete()`:

```ts
      if (!scope || !p || !canDelete() || !eventById(p.ref.eventId)) return;
```

In `apps/web/src/calendar/CalendarPage.tsx`, import `mayDelete` and add the option:

```ts
      canDelete: () => mayDelete(session.conn.clock.getState()),
```

In `apps/web/src/calendar/useCalendarKeys.ts`, import `mayDelete` and change the delete case:

```ts
        case 'delete':
          if (selected && mayDelete(session.conn.clock.getState())) ctl.remove(selected);
          return;
```

In `apps/web/src/calendar/EventEditor.tsx`, import `mayDelete`, read it, and show Delete when deleting is allowed:

```ts
  const deletable = useStore(session.conn.clock, mayDelete);
```

```tsx
          {editor.ref && (!ro || deletable) ? (
```

- [ ] **Step 7: Run, lint, commit**

Run: `npm test -w @relay/web && npm run format && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): a full board hides creating and editing and keeps Delete on boards, sheets and calendars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Notices

**Files:**
- Create: `apps/web/src/ui/statusNotice.ts`, `apps/web/src/ui/FullNotice.tsx`
- Modify: `apps/web/src/ui/StatusBanner.tsx`, `apps/web/src/board/Board.tsx`
- Test: `apps/web/test/statusNotice.test.ts` (create)

**Interfaces:**
- Consumes: `ConnStatus`, `RoomConnection.retry`, `RoomConnection.discardAndReload` (Task 9); `ClockState.unsaved`, `capability` (Task 6).
- Produces: `statusNotice(status: ConnStatus, unsaved: boolean): StatusNotice | null` with `StatusNotice = { title: string; body: string; action: 'home' | 'retry' | 'reload' }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/statusNotice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { statusNotice } from '../src/ui/statusNotice';

describe('statusNotice', () => {
  it('says nothing while the connection is working or simply offline', () => {
    for (const status of ['connecting', 'online', 'offline'] as const) {
      expect(statusNotice(status, false)).toBeNull();
    }
  });

  it('explains each stop and offers the way out', () => {
    expect(statusNotice('unauthorized', false)).toEqual({
      title: 'This link is invalid',
      body: 'Ask the board owner for a new share link.',
      action: 'home',
    });
    expect(statusNotice('crowded', false)).toEqual({
      title: 'This board has too many people right now',
      body: 'Try again in a moment.',
      action: 'retry',
    });
    expect(statusNotice('throttled', false)?.action).toBe('retry');
    expect(statusNotice('too-large', false)).toEqual({
      title: "Some changes couldn't be saved",
      body: 'A change was too large to sync.',
      action: 'reload',
    });
  });

  it('a refused change asks for a reload even while online', () => {
    expect(statusNotice('online', true)).toEqual({
      title: "Some changes couldn't be saved",
      body: 'The board was full when you made them.',
      action: 'reload',
    });
  });

  it('a stop wins over the unsaved notice', () => {
    expect(statusNotice('unauthorized', true)?.action).toBe('home');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -w @relay/web -- statusNotice`
Expected: FAIL — cannot resolve `../src/ui/statusNotice`.

- [ ] **Step 3: Implement the notice text**

Create `apps/web/src/ui/statusNotice.ts`:

```ts
import type { ConnStatus } from '../sync/connection';

export interface StatusNotice {
  title: string;
  body: string;
  /** Back home, connect again, or drop the local copy and reload. */
  action: 'home' | 'retry' | 'reload';
}

const STOPPED: Partial<Record<ConnStatus, StatusNotice>> = {
  unauthorized: {
    title: 'This link is invalid',
    body: 'Ask the board owner for a new share link.',
    action: 'home',
  },
  crowded: {
    title: 'This board has too many people right now',
    body: 'Try again in a moment.',
    action: 'retry',
  },
  throttled: {
    title: 'Too many changes at once',
    body: 'The connection was paused.',
    action: 'retry',
  },
  'too-large': {
    title: "Some changes couldn't be saved",
    body: 'A change was too large to sync.',
    action: 'reload',
  },
};

const UNSAVED: StatusNotice = {
  title: "Some changes couldn't be saved",
  body: 'The board was full when you made them.',
  action: 'reload',
};

/** The blocking notice for a connection state, or null when the board is usable. */
export function statusNotice(status: ConnStatus, unsaved: boolean): StatusNotice | null {
  return STOPPED[status] ?? (unsaved ? UNSAVED : null);
}
```

- [ ] **Step 4: Render it**

Replace `apps/web/src/ui/StatusBanner.tsx`:

```tsx
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { statusNotice } from './statusNotice';

const action = 'mt-4 inline-block border-2 border-ink bg-sun px-3 py-1.5 font-mono text-xs uppercase';

/** Covers the page when the connection stopped or a change was refused, and offers the way out. */
export function StatusBanner({ session }: { session: BoardSession }) {
  const status = useStore(session.conn.status, (s) => s.status);
  const unsaved = useStore(session.conn.clock, (c) => c.unsaved);
  const notice = statusNotice(status, unsaved);
  if (!notice) return null;
  return (
    <div
      data-testid="status-notice"
      data-action={notice.action}
      className="absolute inset-0 z-50 grid place-items-center bg-paper/80 px-4"
    >
      <div role="alert" className="max-w-sm border-[3px] border-ink bg-white p-6 shadow-hard">
        <p className="font-display text-lg uppercase">{notice.title}</p>
        <p className="mt-2 font-mono text-xs">{notice.body}</p>
        {notice.action === 'home' ? (
          <a href="/" className={action}>
            Back home
          </a>
        ) : notice.action === 'retry' ? (
          <button
            type="button"
            data-testid="status-retry"
            className={action}
            onClick={() => session.conn.retry()}
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            data-testid="status-reload"
            className={action}
            onClick={() => void session.conn.discardAndReload()}
          >
            Reload board
          </button>
        )}
      </div>
    </div>
  );
}
```

Create `apps/web/src/ui/FullNotice.tsx`:

```tsx
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { capability } from '../sync/clock';

/** Shown to editors while the board is over its size cap: only deleting works. */
export function FullNotice({ session }: { session: BoardSession }) {
  const cap = useStore(session.conn.clock, capability);
  if (cap !== 'delete-only') return null;
  return (
    <p
      role="status"
      data-testid="board-full"
      className="shrink-0 border-b-2 border-ink bg-sun px-3 py-1 font-mono text-[11px] uppercase"
    >
      This board is full — delete something to keep editing
    </p>
  );
}
```

In `apps/web/src/board/Board.tsx`, import `FullNotice` from `'../ui/FullNotice'` and render it under the page tabs:

```tsx
      <PageTabs session={session} />
      <FullNotice session={session} />
```

- [ ] **Step 5: Look at it in the browser**

Start the app (`preview_start` with the dev server from `.claude/launch.json`, or `npm run dev`), open a new board and check that nothing changed for a normal board: no notice, the header shows `Live`, the toolbar is complete. The full-board and stop notices are exercised end to end in Task 16.

- [ ] **Step 6: Run, lint, commit**

Run: `npm test -w @relay/web && npm run format && npm run lint && npm run typecheck`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): notices for a full board, a refused change, a crowded room and a paused connection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Room creation limit

**Files:**
- Modify: `apps/sync-server/wrangler.jsonc`, `apps/sync-server/src/env.ts`, `apps/sync-server/src/index.ts`, `apps/sync-server/package.json`
- Modify: `apps/sync-server/test/helpers/worker.ts`
- Modify: `apps/web/src/ui/NewBoardButton.tsx`
- Test: `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Produces: binding `ROOM_CREATE_LIMITER` (10 per 60 s, keyed by `CF-Connecting-IP`); var `ROOM_CREATE_LIMIT` (`'off'` disables the limit, for local dev and tests); `startWorker({ port, persistDir, vars? })`.

Local dev, the e2e suite and the integration suite all create far more than 10 rooms a minute from one address, so those servers run with `ROOM_CREATE_LIMIT:off`. Production has no such var and enforces the limit. The limit itself is tested against a second worker started without the override.

- [ ] **Step 1: Let the test harness choose vars and an inspector port**

In `apps/sync-server/test/helpers/worker.ts`, change `startWorker`'s options and arguments:

```ts
export async function startWorker(opts: {
  port: number;
  persistDir: string;
  /** Extra `--var` values; the room-creation limit is off unless a test turns it on. */
  vars?: Record<string, string>;
}): Promise<RunningWorker> {
  const logs: string[] = [];
  const vars = { ROOM_SECRET: 'test-secret', ROOM_CREATE_LIMIT: 'off', ...opts.vars };
  const child = spawn(
    process.execPath,
    [
      WRANGLER,
      'dev',
      '--port',
      String(opts.port),
      // Two workers run at once in the integration suite: each needs its own inspector port.
      '--inspector-port',
      String(opts.port + 1000),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      opts.persistDir,
      ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
    ],
```

- [ ] **Step 2: Write the failing test**

In `apps/sync-server/test/integration.test.ts`, add after the main `describe`:

```ts
describe('room creation limit', () => {
  const LIMITED_PORT = 8798;
  let limited: RunningWorker | undefined;

  beforeAll(async () => {
    limited = await startWorker({
      port: LIMITED_PORT,
      persistDir: mkdtempSync(join(tmpdir(), 'relay-do-limit-')),
      vars: { ROOM_CREATE_LIMIT: 'on' },
    });
  });
  afterAll(async () => {
    await limited?.stop();
  });

  it('answers 429 with Retry-After and CORS headers once an address passes 10 rooms a minute', async () => {
    const responses: Response[] = [];
    for (let i = 0; i < 25; i++) {
      responses.push(
        await fetch(`http://127.0.0.1:${LIMITED_PORT}/api/rooms`, {
          method: 'POST',
          headers: { Origin: 'http://localhost:4000' },
        }),
      );
    }
    expect(responses[0]?.status).toBe(200);
    const refused = responses.filter((r) => r.status === 429);
    // The limiter's minute may roll over once during the loop, so at most 20 of 25 get through.
    expect(refused.length).toBeGreaterThanOrEqual(5);
    expect(refused[0]?.headers.get('Retry-After')).toBe('60');
    expect(refused[0]?.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4000');
    expect(responses.every((r) => r.status === 200 || r.status === 429)).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL — all 25 answer 200.

- [ ] **Step 4: Implement the limit**

In `apps/sync-server/wrangler.jsonc`, add after `migrations`:

```jsonc
  "ratelimits": [
    {
      "name": "ROOM_CREATE_LIMITER",
      "namespace_id": "1001",
      "simple": { "limit": 10, "period": 60 }
    }
  ],
```

In `apps/sync-server/src/env.ts`:

```ts
export interface Env {
  Room: DurableObjectNamespace;
  ROOM_SECRET: string;
  /** Comma-separated list of origins allowed to call the HTTP API. */
  ALLOWED_ORIGINS: string;
  /** Workers rate limiting binding: 10 room creations per 60 s per address. */
  ROOM_CREATE_LIMITER: RateLimit;
  /** `'off'` skips the room-creation limit. Set only by local dev and the test servers. */
  ROOM_CREATE_LIMIT?: string;
}
```

In `apps/sync-server/src/index.ts`, replace the `/api/rooms` block:

```ts
    if (url.pathname === '/api/rooms') {
      const cors = corsHeaders(req, env);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method !== 'POST')
        return new Response('Method not allowed', { status: 405, headers: cors });
      if (env.ROOM_CREATE_LIMIT !== 'off') {
        // Rooms are anonymous: without a limit one address could fill the account's storage.
        const address = req.headers.get('CF-Connecting-IP') ?? 'unknown';
        const { success } = await env.ROOM_CREATE_LIMITER.limit({ key: address });
        if (!success) {
          return new Response('Too many rooms', {
            status: 429,
            headers: { ...cors, 'Retry-After': '60' },
          });
        }
      }
      return Response.json(await createRoom(env), { headers: cors });
    }
```

In `apps/sync-server/package.json`, turn the limit off for local dev (the e2e suite and `docker-compose.yml` both start the server through this script):

```json
    "dev": "wrangler dev --port 8787 --var ROOM_SECRET:dev-only-secret --var ROOM_CREATE_LIMIT:off",
```

- [ ] **Step 5: Run the server tests**

Run: `npm test -w @relay/sync-server`
Expected: PASS. If wrangler rejects the `ratelimits` key, run `npx wrangler dev --help` in `apps/sync-server` and check the config schema at `node_modules/wrangler/config-schema.json` for the current spelling of the rate-limit binding before changing anything else.

- [ ] **Step 6: Say it on the landing page**

In `apps/web/src/ui/NewBoardButton.tsx`, add a `limited` state and its message:

```tsx
  const [state, setState] = useState<'idle' | 'busy' | 'error' | 'limited'>('idle');

  async function create() {
    setState('busy');
    try {
      const res = await fetch(`${SYNC_HTTP}/api/rooms`, { method: 'POST' });
      if (res.status === 429) {
        setState('limited');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
      router.push(`/r/${roomId}#k=${encodeURIComponent(editKey)}`);
    } catch {
      setState('error');
    }
  }
```

and below the existing error paragraph:

```tsx
      {state === 'limited' && (
        <p role="alert" data-testid="new-board-limited" className="font-mono text-xs text-flame">
          Too many new boards. Try again in a minute.
        </p>
      )}
```

- [ ] **Step 7: Lint and commit**

Run: `npm run format && npm run lint && npm run typecheck`

```bash
git add apps/sync-server apps/web
git commit -m "feat(sync-server): limit room creation to 10 a minute per address; the landing page says so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The room after hibernation — presence is restored and the full flag is said again

A Durable Object that receives nothing for about ten seconds hibernates: its sockets stay open and its memory is discarded, the awareness map included. Measured on this branch before this task, after 15 s without messages: a late joiner is handed no presence at all, and when a peer closes nobody is told, so its cursor stays on the others' screens for good (y-partyserver removes on close only the states it still has in memory, and its provider turns off the awareness protocol's own expiry).

The fix keeps, in each connection's state, the last state and clock of every id the connection owns, and rebuilds the awareness map from them when the room starts. Connection state lives in the WebSocket attachment, which Cloudflare caps at 16,384 bytes and which also holds the request URL (partyserver puts it there). Hence two bounds: a stored state is at most 3000 characters, and the Worker refuses a request URL over 2048 characters before the room wakes.

The same wake recomputes the full flag from the saved size, so the room says it again to the connections that slept through it.

**Files:**
- Modify: `apps/sync-server/src/awareness.ts`, `apps/sync-server/src/limits.ts`, `apps/sync-server/src/index.ts`, `apps/sync-server/src/room.ts`
- Test: `apps/sync-server/test/awareness.test.ts`, `apps/sync-server/test/integration.test.ts`

**Interfaces:**
- Consumes: Task 8's `Room` (`#full`, `encode`, `onLoad`, `#onAwareness`) and its test helper `collectCustom`; Task 4's `stateOf`, `patchState`, `ownedIds`; Task 3's `AwarenessEntry`, `encodeAwarenessUpdate`; Task 5's `rawConnect` options.
- Produces: `compactState(state: Record<string, unknown>, maxChars: number): string` (`awareness.ts`); `LIMITS.maxStoredStateChars` (`3000`) and `LIMITS.maxUrlChars` (`2048`); the connection-state key `presence`, a list of `[clientId, clock, state]`.

- [ ] **Step 1: Write the failing unit tests**

In `apps/sync-server/test/awareness.test.ts`, add `compactState` to the import from `'../src/awareness'` and append:

```ts
describe('compactState', () => {
  it('keeps a state that fits as it is', () => {
    const state = presence('Ann', { selection: ['a', 'b'] });
    expect(compactState(state, 3000)).toBe(JSON.stringify(state));
  });

  it('drops the selection of a state that does not fit, and nothing else', () => {
    const state = presence('Ann', {
      cursor: { x: 1, y: 2 },
      selection: Array.from({ length: 100 }, (_, i) => `${'s'.repeat(60)}${i}`),
    });
    expect(JSON.stringify(state).length).toBeGreaterThan(3000);
    const compact = compactState(state, 3000);
    expect(compact.length).toBeLessThanOrEqual(3000);
    expect(JSON.parse(compact)).toEqual({ ...state, selection: [] });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- awareness`
Expected: FAIL — `compactState` is not exported.

- [ ] **Step 3: Implement the pure part and the limits**

Append to `apps/sync-server/src/awareness.ts`:

```ts
/**
 * A validated state short enough to keep on a connection: over `maxChars` it loses its
 * selection, the only part without a small bound.
 */
export function compactState(state: Record<string, unknown>, maxChars: number): string {
  const json = JSON.stringify(state);
  return json.length <= maxChars ? json : JSON.stringify({ ...state, selection: [] });
}
```

In `apps/sync-server/src/limits.ts`, add after `maxAwarenessIds`:

```ts
  /**
   * A presence state kept on a connection so it survives hibernation. Two of them, at two bytes
   * a character, fit a 16,384-byte WebSocket attachment next to the request URL.
   */
  maxStoredStateChars: 3000,
  /** The request URL is kept in the connection's attachment, so its length is bounded too. */
  maxUrlChars: 2048,
```

Run: `npm test -w @relay/sync-server -- awareness`
Expected: PASS.

- [ ] **Step 4: Write the failing integration tests**

In `apps/sync-server/test/integration.test.ts`, give `rawConnect` a `pad` option. Its head becomes:

```ts
function rawConnect(
  room: string,
  opts: {
    key?: string;
    sid?: string;
    pk?: string;
    pad?: number;
    headers?: Record<string, string>;
  } = {},
): WebSocket {
  // The app's provider keeps one `_pk` for its whole life: a reconnect arrives with the same one.
  const params = new URLSearchParams({ _pk: opts.pk ?? Math.random().toString(36).slice(2) });
  if (opts.key !== undefined) params.set('key', opts.key);
  if (opts.sid !== undefined) params.set('sid', opts.sid);
  if (opts.pad !== undefined) params.set('pad', 'x'.repeat(opts.pad));
```

Add:

```ts
  it('refuses a request whose URL is longer than the limit', async () => {
    const { roomId, editKey } = await createRoom();
    const ws = rawConnect(roomId, { key: editKey, pad: LIMITS.maxUrlChars });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('error', (e) => resolve(e.message));
      ws.on('open', () => resolve('the socket opened'));
    });
    expect(outcome).toContain('414');
  });

  it('presence and the full flag survive the room hibernating', { timeout: 60_000 }, async () => {
    const { roomId, editKey } = await createRoom();
    const ann = connect(roomId, editKey);
    await synced(ann.provider);
    const bob = rawConnect(roomId, { key: editKey });
    const told = collectCustom(bob);
    await waitForOpen(bob);
    ann.provider.awareness.setLocalState(presence('Ann'));
    bob.send(awarenessFrame([{ clientId: 7301, clock: 1, state: presence('Bob') }]));
    await waitFor(() => nameOf(ann.provider, 7301) === 'Bob');

    // With no messages for more than ten seconds the Durable Object hibernates and its memory goes.
    await new Promise((r) => setTimeout(r, 15_000));
    expect(told.some((m) => m.type === 'room')).toBe(false);

    // A late joiner wakes the room and is handed everyone who was there.
    const carol = connect(roomId, editKey);
    await waitFor(() => nameOf(carol.provider, 7301) === 'Bob');
    expect(nameOf(carol.provider, ann.doc.clientID)).toBe('Ann');
    // The connections that slept through it are told again whether the board is full.
    await waitFor(() => told.some((m) => m.type === 'room' && m.full === false));

    // The ids are still owned by the sockets that held them: Bob updates his, nobody else can.
    bob.send(awarenessFrame([{ clientId: 7301, clock: 2, state: presence('Bob B') }]));
    await waitFor(() => nameOf(carol.provider, 7301) === 'Bob B');
    const mallory = rawConnect(roomId, { key: editKey });
    await waitForOpen(mallory);
    mallory.send(awarenessFrame([{ clientId: 7301, clock: 9, state: presence('Mallory') }]));
    await settle();
    expect(nameOf(carol.provider, 7301)).toBe('Bob B');

    // A close still finds a state to remove, and the others are told.
    bob.close();
    await waitFor(() => !ann.provider.awareness.getStates().has(7301));
    await waitFor(() => !carol.provider.awareness.getStates().has(7301));
  });
```

- [ ] **Step 5: Run them and see them fail**

Run: `npm test -w @relay/sync-server -- integration`
Expected: FAIL in the two new tests — the long URL is let in (`the socket opened`), and after the idle period the late joiner is never handed Bob (`timed out waiting for condition`). The second test takes about 20 s.

- [ ] **Step 6: Bound the request URL**

In `apps/sync-server/src/index.ts`, import the limits:

```ts
import { LIMITS } from './limits';
```

and make it the first check of `onBeforeConnect`:

```ts
      onBeforeConnect: async (request, lobby) => {
        // The room keeps the request URL in the connection's attachment, which has a size limit.
        if (request.url.length > LIMITS.maxUrlChars) {
          return new Response('URI too long', { status: 414 });
        }
```

- [ ] **Step 7: Keep presence on the connection and restore it**

In `apps/sync-server/src/room.ts`:

Add `type AwarenessEntry` and `compactState` to the import from `'./awareness'`.

Add the key to `ConnState`:

```ts
  /** The last state of each owned id, as `[clientId, clock, state]`, kept across hibernation. */
  presence?: unknown;
```

Add below `ownedIds`:

```ts
type StoredPresence = [clientId: number, clock: number, state: string];

/** The states this connection carries for the ids it owns. */
function storedPresence(connection: Connection): StoredPresence[] {
  const raw = stateOf(connection).presence;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is StoredPresence =>
      Array.isArray(e) &&
      typeof e[0] === 'number' &&
      typeof e[1] === 'number' &&
      typeof e[2] === 'string',
  );
}
```

At the end of `onLoad`, after the `initMeta(...)` call, add the two calls, and add the method below `onLoad`:

```ts
    this.#restorePresence();
    // A connection that was open before the room hibernated still holds the flag it was last
    // told, and the flag is recomputed on waking: say it again.
    this.broadcastCustomMessage(encode({ type: 'room', full: this.#full, now: Date.now() }));
  }

  /**
   * Hibernation empties the awareness map while the sockets stay open. Each connection carries
   * the last state of the ids it owns, so the map is rebuilt here, before any event is handled
   * and before y-partyserver listens to it: a late joiner is handed everyone, and a close still
   * finds a state to remove and relay.
   */
  #restorePresence(): void {
    const entries: AwarenessEntry[] = [];
    for (const connection of this.getConnections()) {
      const owned = new Set(ownedIds(connection));
      for (const [clientId, clock, state] of storedPresence(connection)) {
        if (owned.has(clientId)) entries.push({ clientId, clock, state });
      }
    }
    if (entries.length === 0) return;
    applyAwarenessUpdate(this.document.awareness, encodeAwarenessUpdate(entries), null);
  }
```

`onLoad` runs inside y-partyserver's `onStart`, before it starts listening to the awareness map. That is why the restore relays nothing and changes no ownership: there is nobody to tell, the other connections never lost these states. On a room's very first start no connection is open yet, so nothing is restored and `room` reaches nobody.

In `#onAwareness`, replace the line that stores the owned ids:

```ts
    patchState(connection, { __ypsAwarenessIds: verdict.owned.filter((id) => states.has(id)) });
```

with:

```ts
    const owned = verdict.owned.filter((id) => states.has(id));
    patchState(connection, {
      __ypsAwarenessIds: owned,
      presence: owned.map((id) => [
        id,
        awareness.meta.get(id)?.clock ?? 0,
        compactState(states.get(id) ?? {}, LIMITS.maxStoredStateChars),
      ]),
    });
```

- [ ] **Step 8: Run all the server tests**

Run: `npm test -w @relay/sync-server`
Expected: PASS.

- [ ] **Step 9: Lint and commit**

Run: `npm run format && npm run lint && npm run typecheck`

```bash
git add apps/sync-server
git commit -m "feat(sync-server): presence survives hibernation — each connection carries the state of the ids it owns; the room says again whether it is full; request URLs are bounded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The board is read-only for whoever cannot edit

Measured on this branch before this task, with a view link in its own browser context: `R` and a drag draws a rectangle, the toolbar's sticky tool creates one, an editor's sticky drags, a double-click opens the text editor and typing changes the text, and eight resize handles show. The room is unchanged, but the viewer's own copy is not: it survives a reload (IndexedDB), and the header still reads LIVE. Task 10 already stops those changes at the controller. This task stops them where they start, so that nothing appears to move or get typed either: in the tool machine and in the UI.

**Files:**
- Create: `packages/core/test/tools-access.test.ts`, `e2e/readonly.spec.ts`
- Modify: `packages/core/src/tools/machine.ts`, `apps/web/src/board/controller.ts`, `apps/web/src/board/session.ts`, `apps/web/src/ui/Toolbar.tsx`, `apps/web/src/render/SelectionLayer.tsx`
- Test: `apps/web/test/controller.test.ts`

**Interfaces:**
- Consumes: `BoardAccess` (core) and `boardAccess`, the controller's `access` option (web), all from Task 10; the toolbar's `editable` from Task 11.
- Produces: `ToolContext.access?: BoardAccess` (`edit` when absent); `BoardController.accessChanged(): void`.

- [ ] **Step 1: Write the scenario and see it fail**

Create `e2e/readonly.spec.ts`:

```ts
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("a viewer cannot change the board, not even in the viewer's own copy", async ({
  page,
  browser,
  request,
}) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  await openBoard(page, `/r/${roomId}#k=${editKey}`);
  await page.keyboard.press('s');
  await page.mouse.click(400, 320);
  await page.keyboard.type('Read only');
  await page.keyboard.press('Escape');

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await openBoard(viewer, `/r/${roomId}#k=${viewKey}`);
  const shapes = viewer.locator('[data-shape-id]');
  await expect(viewer.getByText('Read only')).toBeVisible();

  // No tool that creates, and the key that would pick one draws nothing.
  await expect(viewer.getByTestId('tool-select')).toBeVisible();
  await expect(viewer.getByTestId('tool-sticky')).toHaveCount(0);
  await expect(viewer.getByTestId('tool-shapes')).toHaveCount(0);
  await viewer.keyboard.press('r');
  await drag(viewer, { x: 1000, y: 560 }, { x: 1140, y: 660 });
  await expect(shapes).toHaveCount(1);

  // Pressing the sticky selects it. Dragging does not move it, and no resize handle shows.
  const box = await shapes.first().boundingBox();
  if (!box) throw new Error('sticky not rendered for the viewer');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(viewer, centre, { x: centre.x - 160, y: centre.y - 120 });
  await expect(viewer.getByTestId('selection-outline')).toHaveCount(1);
  expect(await shapes.first().boundingBox()).toEqual(box);
  await expect(viewer.locator('[data-handle]')).toHaveCount(0);

  // A double-click opens no editor.
  await viewer.mouse.dblclick(centre.x, centre.y);
  await expect(viewer.getByTestId('text-editor')).toHaveCount(0);

  // Nothing was kept in the viewer's copy either: after a reload the board is the room's.
  await viewer.reload();
  await expect(viewer.getByText('Read only')).toBeVisible();
  await expect(shapes).toHaveCount(1);
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
  await viewerCtx.close();
});
```

Run: `npx playwright test e2e/readonly.spec.ts --project=chromium` (with no dev server already running, so Playwright starts its own)
Expected: FAIL at `tool-sticky`: the viewer's toolbar still has it.

- [ ] **Step 2: Write the failing table test for the tool machine**

Create `packages/core/test/tools-access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type BoardAccess,
  type Connector,
  DEFAULT_STYLE,
  type Effect,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolEvent,
  type ToolState,
} from '../src';

const base: Omit<Shape, 'id'> = {
  type: 'rect',
  x: 100,
  y: 100,
  w: 160,
  h: 96,
  z: 'a1',
  style: DEFAULT_STYLE.rect,
  text: '',
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 0,
};
const a: Shape = { ...base, id: 'a' };
const b: Shape = { ...base, id: 'b', x: 400 };
const note: Shape = { ...base, id: 'n', type: 'sticky', x: 700, style: DEFAULT_STYLE.sticky };
const frame: Shape = {
  ...base,
  id: 'f',
  type: 'frame',
  x: 0,
  y: 300,
  w: 720,
  h: 440,
  z: 'a0',
  style: DEFAULT_STYLE.frame,
  columns: [{ id: 'c1', title: 'A' }],
};
const link: Connector = {
  id: 'k',
  from: { shapeId: 'a', anchor: 'auto' },
  to: { shapeId: 'b', anchor: 'auto' },
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

function ctx(access: BoardAccess): ToolContext {
  return {
    shapes: Object.fromEntries([a, b, note, frame].map((s) => [s.id, s])),
    connectors: { k: link },
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => 'new',
    now: () => 0,
    access,
  };
}
const idle = (selection: string[], tool: ToolState['tool'] = 'select'): ToolState =>
  ({ mode: 'idle', tool, selection }) as ToolState;
const at = (x: number, y: number, hitId: string | null, extra: Partial<PointerInfo> = {}) => ({
  world: { x, y },
  shift: false,
  hitId,
  ...extra,
});
const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

/** Runs events in order and collects every effect. */
function run(state: ToolState, events: ToolEvent[], access: BoardAccess) {
  const effects: Effect[] = [];
  let s = state;
  for (const event of events) {
    const r = step(s, event, ctx(access));
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

describe.each<BoardAccess>(['read-only', 'delete-only'])(
  'tool machine with %s access',
  (access) => {
    it('a press on a shape selects it and a drag moves nothing', () => {
      const r = run(
        idle([]),
        [
          { type: 'pointerDown', p: at(120, 120, 'a') },
          { type: 'pointerMove', p: at(300, 300, null) },
          { type: 'pointerUp', p: at(300, 300, null) },
        ],
        access,
      );
      expect(r.state).toEqual(idle(['a']));
      expect(r.effects).toEqual([]);
    });

    it('Shift adds to the selection and takes from it; a connector selects too', () => {
      const add = step(
        idle(['a']),
        { type: 'pointerDown', p: at(420, 120, 'b', { shift: true }) },
        ctx(access),
      );
      expect(add.state).toEqual(idle(['a', 'b']));
      const take = step(
        idle(['a', 'b']),
        { type: 'pointerDown', p: at(420, 120, 'b', { shift: true }) },
        ctx(access),
      );
      expect(take.state).toEqual(idle(['a']));
      const edge = step(
        idle([]),
        { type: 'pointerDown', p: at(300, 150, null, { connectorId: 'k' }) },
        ctx(access),
      );
      expect(edge.state).toEqual(idle(['k']));
    });

    it('a press on a resize handle does not resize', () => {
      const r = run(
        idle(['a']),
        [
          { type: 'pointerDown', p: at(260, 196, 'a', { handle: 'se' }) },
          { type: 'pointerMove', p: at(400, 400, null) },
          { type: 'pointerUp', p: at(400, 400, null) },
        ],
        access,
      );
      expect(r.state).toEqual(idle(['a']));
      expect(commands(r.effects)).toEqual([]);
    });

    it('a drag on empty canvas is still a marquee', () => {
      const r = run(
        idle([]),
        [
          { type: 'pointerDown', p: at(50, 50, null) },
          { type: 'pointerMove', p: at(600, 250, null) },
          { type: 'pointerUp', p: at(600, 250, null) },
        ],
        access,
      );
      expect(r.state).toEqual(idle(['a', 'b']));
      expect(commands(r.effects)).toEqual([]);
    });

    it('no tool but select exists: a drawing tool draws nothing and a click tool creates nothing', () => {
      const picked = step(idle([]), { type: 'setTool', tool: 'rect' }, ctx(access));
      expect(picked.state).toEqual(idle([]));
      for (const tool of ['rect', 'sticky', 'connector', 'frame'] as const) {
        const r = run(
          idle([], tool),
          [
            { type: 'pointerDown', p: at(900, 50, null) },
            { type: 'pointerMove', p: at(1000, 150, null) },
            { type: 'pointerUp', p: at(1000, 150, null) },
          ],
          access,
        );
        expect(r.state).toEqual(idle([]));
        expect(commands(r.effects)).toEqual([]);
        expect(r.effects.some((e) => e.type === 'editText')).toBe(false);
      }
    });

    it('a double-click edits neither text nor a column title', () => {
      const text = step(idle([]), { type: 'doubleClick', p: at(720, 120, 'n') }, ctx(access));
      expect(text.effects).toEqual([]);
      const column = step(
        idle([]),
        { type: 'doubleClick', p: at(20, 350, 'f', { column: { frameId: 'f', columnId: 'c1' } }) },
        ctx(access),
      );
      expect(column.effects).toEqual([]);
    });

    it('nudging and routing change nothing', () => {
      expect(step(idle(['a']), { type: 'nudge', dx: 10, dy: 0 }, ctx(access)).effects).toEqual([]);
      expect(step(idle(['k']), { type: 'toggleRouting' }, ctx(access)).effects).toEqual([]);
    });

    it('a gesture under way when the board stopped being editable is dropped', () => {
      const dragging: ToolState = {
        mode: 'dragging',
        tool: 'select',
        selection: ['a'],
        origin: { x: 120, y: 120 },
        starts: { a: { x: 100, y: 100, w: 160, h: 96 } },
        moved: true,
      };
      const r = step(dragging, { type: 'pointerMove', p: at(300, 300, null) }, ctx(access));
      expect(r.state).toEqual(idle(['a']));
      expect(r.effects).toEqual([
        { type: 'overlay', rects: null },
        { type: 'preview', preview: null },
      ]);
    });
  },
);

describe('deleting by access', () => {
  it('read-only deletes nothing', () => {
    const r = step(idle(['a', 'k']), { type: 'deleteSelection' }, ctx('read-only'));
    expect(r.state).toEqual(idle(['a', 'k']));
    expect(r.effects).toEqual([]);
  });

  it('delete-only deletes the selection as an editor would', () => {
    const r = step(idle(['a', 'k']), { type: 'deleteSelection' }, ctx('delete-only'));
    expect(r.state).toEqual(idle([]));
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['a', 'k'] }]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('edit access is the machine as it always was', () => {
    const down = step(idle([]), { type: 'pointerDown', p: at(120, 120, 'a') }, ctx('edit'));
    expect(down.state.mode).toBe('dragging');
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npm test -w @relay/core -- tools-access`
Expected: FAIL — the machine ignores `access`: a press starts a drag, a drawing tool draws and a double-click asks for the text editor.

- [ ] **Step 4: Teach the machine**

In `packages/core/src/tools/machine.ts`:

Import the type:

```ts
import type { BoardAccess } from '../commands/full';
```

Add to `ToolContext`, after `now`:

```ts
  /**
   * What the user may change; `edit` when absent. Otherwise pointing only selects, and
   * `deleteSelection` works in `delete-only` alone.
   */
  access?: BoardAccess;
```

Add `stepLocked` above `step`, and make it `step`'s first line:

```ts
/**
 * The machine for a user who cannot edit (a viewer, or an editor on a full board). Pointing
 * selects and draws a marquee; nothing is created, moved, resized or edited, whatever tool the
 * state names. Only `delete-only` keeps `deleteSelection`.
 */
function stepLocked(state: ToolState, event: ToolEvent, ctx: ToolContext): StepResult {
  if (state.mode === 'marquee') return stepMarquee(state, event, ctx);
  // A gesture that was under way when the board stopped being editable is dropped.
  if (state.mode !== 'idle') {
    return { state: idle('select', state.selection), effects: [overlay(null), preview(null)] };
  }
  const { selection } = state;
  switch (event.type) {
    case 'deleteSelection':
      return ctx.access === 'delete-only'
        ? stepIdle(idle('select', selection), event, ctx)
        : none(idle('select', selection));
    case 'pointerDown': {
      const { p } = event;
      const hit = p.hitId && ctx.shapes[p.hitId] ? p.hitId : null;
      if (hit) {
        if (p.shift) return none(idle('select', toggled(selection, hit, true)));
        return none(idle('select', selection.includes(hit) ? selection : [hit]));
      }
      if (p.connectorId && ctx.connectors?.[p.connectorId])
        return none(idle('select', toggled(selection, p.connectorId, p.shift)));
      const base = p.shift ? selection : [];
      return none({
        mode: 'marquee',
        tool: 'select',
        selection: base,
        base,
        origin: p.world,
        moved: false,
      });
    }
    default:
      return none(idle('select', selection));
  }
}

/** Pure tool reducer: (state, event) → (state, effects). */
export function step(state: ToolState, event: ToolEvent, ctx: ToolContext): StepResult {
  if (ctx.access !== undefined && ctx.access !== 'edit') return stepLocked(state, event, ctx);
  switch (state.mode) {
    // …the existing cases, unchanged…
  }
}
```

Run: `npm test -w @relay/core`
Expected: PASS, the existing `tools`, `tools-lock` and `tools-structure` suites included: without `access` the machine is what it was.

- [ ] **Step 5: Write the failing controller tests**

Append to `apps/web/test/controller.test.ts`:

```ts
describe('board controller gestures by access', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rect = (doc: Y.Doc, id: string) =>
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id,
        type: 'rect',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        style: DEFAULT_STYLE.rect,
        text: '',
        createdBy: 'u1',
        authorName: 'Brisk Otter',
        createdAt: 0,
      },
    });

  it("a viewer's press selects, and the drag neither moves the shape nor shows it moving", () => {
    const { doc, controller } = setup({ access: () => 'read-only' });
    rect(doc, 'r1');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    expect(controller.ui.getState().overlay).toBeNull();
    controller.dispatch({ type: 'pointerUp', p: at(60, 10) });
    vi.advanceTimersByTime(200);
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(0);
    expect(controller.ui.getState().tool).toEqual({
      mode: 'idle',
      tool: 'select',
      selection: ['r1'],
    });
  });

  it('a viewer cannot pick a tool that creates, and a double-click opens no editor', () => {
    const { doc, controller } = setup({ access: () => 'read-only' });
    rect(doc, 'r1');
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    expect(controller.ui.getState().tool.tool).toBe('select');
    controller.dispatch({ type: 'pointerDown', p: at(300, 200) });
    controller.dispatch({ type: 'pointerUp', p: at(300, 200) });
    expect(getRoots(doc).shapes.size).toBe(1);
    controller.dispatch({ type: 'doubleClick', p: at(10, 10, 'r1') });
    expect(controller.ui.getState().editingId).toBeNull();
  });

  it('on a full board the Delete key still works and nothing else does', () => {
    const { doc, controller } = setup({ access: () => 'delete-only' });
    rect(doc, 'r1');
    rect(doc, 'r2');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerUp', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'nudge', dx: 10, dy: 0 });
    expect(getRoots(doc).shapes.get('r1')?.get('x')).toBe(0);
    controller.dispatch({ type: 'deleteSelection' });
    expect(getRoots(doc).shapes.has('r1')).toBe(false);
    expect(getRoots(doc).shapes.has('r2')).toBe(true);
  });

  it('when the board stops taking edits, the open editor closes and the tool is select again', () => {
    let access: BoardAccess = 'edit';
    const { controller } = setup({ access: () => access });
    controller.dispatch({ type: 'setTool', tool: 'sticky' });
    controller.dispatch({ type: 'pointerDown', p: at(300, 200) });
    expect(controller.ui.getState().editingId).toBe('s1');
    controller.dispatch({ type: 'setTool', tool: 'rect' });

    access = 'delete-only';
    controller.accessChanged();
    expect(controller.ui.getState().editingId).toBeNull();
    expect(controller.ui.getState().tool).toEqual({ mode: 'idle', tool: 'select', selection: [] });
  });

  it('a drag under way when the board fills up is dropped without a trace', () => {
    let access: BoardAccess = 'edit';
    const { doc, controller } = setup({ access: () => access });
    rect(doc, 'r1');
    controller.dispatch({ type: 'pointerDown', p: at(10, 10, 'r1') });
    controller.dispatch({ type: 'pointerMove', p: at(60, 10) });
    expect(controller.ui.getState().overlay).not.toBeNull();

    access = 'delete-only';
    controller.accessChanged();
    expect(controller.ui.getState().overlay).toBeNull();
    expect(controller.ui.getState().tool.mode).toBe('idle');
  });
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `npm test -w @relay/web -- controller.test`
Expected: FAIL — the viewer's drag shows an overlay, the sticky tool is picked, and `accessChanged` is not a function.

- [ ] **Step 7: Pass the access to the machine and close what cannot be saved**

In `apps/web/src/board/controller.ts`:

In `dispatch`, add the access to the context given to `step`, after `now,`:

```ts
      access: access(),
```

Add to the `BoardController` interface, after `setAddToCalendar`:

```ts
  /**
   * The board's access changed (the server's hello, or the board filled up). When it no longer
   * takes edits, whatever was being drawn or typed is closed: it could not be saved.
   */
  accessChanged(): void;
```

Add the method to the returned object, above `destroy`:

```ts
    accessChanged() {
      if (access() === 'edit') return;
      throttledCommit.cancel();
      // The tool machine drops a gesture that is under way, and its overlay with it.
      if (ui.getState().tool.mode !== 'idle') dispatch({ type: 'cancel' });
      ui.setState({
        tool: { mode: 'idle', tool: 'select', selection: ui.getState().tool.selection },
        editingId: null,
        editingColumn: null,
        editingConnector: null,
        composer: null,
        graphDialog: false,
        addToCalendar: null,
      });
      undoStack.stopCapturing();
    },
```

In `apps/web/src/board/session.ts`, below the `controller.ui.subscribe(...)` block that publishes the selection:

```ts
  // A hello that names a viewer, or a board that fills up, ends what was being edited.
  const unsubscribeAccess = conn.clock.subscribe((clock, prev) => {
    if (boardAccess(clock) !== boardAccess(prev)) controller.accessChanged();
  });
```

and call `unsubscribeAccess();` in `destroy`, next to `unsubscribe();`.

- [ ] **Step 8: Hide the tools that create, and the resize handles**

In `apps/web/src/ui/Toolbar.tsx`, import `boardAccess` from `'../sync/clock'`. In `Toolbar`, below the line that reads `editable` (Task 11 named it; keep the name the file has):

```ts
  // The tools that create show only while the board takes edits: not for a viewer, not when full.
  const creating = useStore(session.conn.clock, (c) => boardAccess(c) === 'edit');
```

and render the Shapes button and the tools after it only then:

```tsx
      {creating && <ShapesButton session={session} active={active} />}
      {creating &&
        AFTER_SHAPES.filter((t) => t.id !== 'comment' || editable).map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={active === tool.id}
            onPick={() => pick(tool.id)}
          />
        ))}
```

Select, the touch selection toggle, Graph and Help stay as they are.

In `apps/web/src/render/SelectionLayer.tsx`, import `boardAccess` from `'../sync/clock'`, read it below `touch`:

```ts
  // Resize handles are for whoever can resize: not a viewer, not anyone on a full board.
  const resizable = useStore(session.conn.clock, (c) => boardAccess(c) === 'edit');
```

and add `resizable &&` after `!single.locked &&` in both handle blocks (the touch hit areas and the visible handles).

- [ ] **Step 9: Run the unit tests and the scenario**

Run: `npm test -w @relay/web && npx playwright test e2e/readonly.spec.ts e2e/canvas-ux.spec.ts e2e/session.spec.ts e2e/graphs.spec.ts --project=chromium`
Expected: PASS. The three older specs each open a board as a viewer (menus, votes and comments, the graph menu): they must be as green as before.

- [ ] **Step 10: Lint and commit**

Run: `npm run format && npm run lint && npm run typecheck`

```bash
git add packages/core apps/web e2e
git commit -m "feat: the board is read-only for whoever cannot edit — the tool machine only selects, the creating tools and the handles are hidden, and what was being typed closes when access is lost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: End to end, and the docs

**Files:**
- Create: `e2e/helpers/filler.ts`, `e2e/hardening.spec.ts`
- Modify: `README.md`, `README.es.md`

**Interfaces:**
- Consumes: test ids `board-full` (Task 12), `status-notice`, `tool-sticky`, `canvas`, `text-editor`, `conn-status` (existing). The scenario expects `tool-sticky` to be gone on a full board: Task 15 hides it.

The board is filled by a third client running in Node, which writes large strings into a document root the app does not read (`e2e-bulk`). The server counts those bytes like any others, and neither browser has to render a megabyte of text.

- [ ] **Step 1: Write the filler**

Create `e2e/helpers/filler.ts`:

```ts
import WebSocket from 'ws';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A third client, in Node, that pushes a room over the 1 MB cap and empties it again. It writes
 * into a root the app never reads, so the browsers have nothing extra to draw.
 */
export async function connectFiller(roomId: string, editKey: string) {
  const doc = new Y.Doc();
  const provider = new YProvider('127.0.0.1:8787', roomId, doc, {
    party: 'room',
    params: { key: editKey },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the filler did not sync')), 20_000);
    provider.on('sync', (ok: boolean) => {
      if (!ok) return;
      clearTimeout(timer);
      resolve();
    });
  });
  const bulk = doc.getMap<string>('e2e-bulk');
  return {
    /** Six 200 KB writes, each under the 256 KB message cap, 1.2 MB in all. */
    async fill() {
      for (let i = 0; i < 6; i++) {
        bulk.set(`k${i}`, 'x'.repeat(200_000));
        await sleep(100);
      }
    },
    /** One deletion per key: each is its own update, so each is a pure deletion. */
    async empty() {
      for (const key of [...bulk.keys()]) {
        bulk.delete(key);
        await sleep(50);
      }
    },
    close() {
      provider.destroy();
    },
  };
}
```

`ws`, `yjs` and `y-partyserver` resolve from the root `node_modules` (the workspaces hoist them). Check with `node -e "import('ws').then(()=>import('y-partyserver/provider')).then(()=>console.log('ok'))"` from the repo root; if that fails, add them to the root `devDependencies` with `npm install -D ws y-partyserver yjs`.

- [ ] **Step 2: Write the scenario**

Create `e2e/hardening.spec.ts`:

```ts
import { expect, type Page, test, type WebSocketRoute } from '@playwright/test';
import { connectFiller } from './helpers/filler';

const SYNC = 'http://localhost:8787';

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
    timeout: 20_000,
  });
}

/** Creates a sticky with `text` at a canvas position and leaves the editor. */
async function addSticky(page: Page, text: string, x: number, y: number) {
  await page.getByTestId('tool-sticky').click();
  await page.getByTestId('canvas').click({ position: { x, y } });
  await page.getByTestId('text-editor').fill(text);
  await page.getByTestId('canvas').click({ position: { x: 900, y: 560 } });
  await expect(page.getByTestId('text-editor')).toBeHidden();
}

test('a full board says so to everyone, still deletes, and edits again once it shrinks', async ({
  browser,
  request,
}) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openBoard(pa, path);
  await openBoard(pb, path);

  await addSticky(pa, 'Keep me', 300, 250);
  await addSticky(pa, 'Drop me', 600, 250);
  await expect(pb.getByText('Drop me')).toBeVisible();

  const filler = await connectFiller(roomId, editKey);
  try {
    await filler.fill();

    // Both users are told, and neither can create.
    await expect(pa.getByTestId('board-full')).toBeVisible({ timeout: 15_000 });
    await expect(pb.getByTestId('board-full')).toBeVisible();
    await expect(pa.getByTestId('board-full')).toHaveText(
      'This board is full — delete something to keep editing',
    );
    await expect(pa.getByTestId('tool-sticky')).toHaveCount(0);
    await expect(pa.getByTestId('undo')).toHaveCount(0);

    // Deleting still works and reaches the other user.
    await pa.getByText('Drop me').click();
    await pa.keyboard.press('Delete');
    await expect(pa.getByText('Drop me')).toHaveCount(0);
    await expect(pb.getByText('Drop me')).toHaveCount(0);
    await expect(pb.getByText('Keep me')).toBeVisible();
    await expect(pa.getByTestId('status-notice')).toHaveCount(0);

    // Once the bulk is gone the server saves, measures under 900 KB and lets everyone edit again.
    await filler.empty();
    await expect(pa.getByTestId('board-full')).toHaveCount(0, { timeout: 20_000 });
    await expect(pb.getByTestId('board-full')).toHaveCount(0);
    await addSticky(pb, 'Back in business', 450, 450);
    await expect(pa.getByText('Back in business')).toBeVisible();
  } finally {
    filler.close();
    await a.close();
    await b.close();
  }
});

test('a user whose change was refused is asked to reload, and the reload restores the shared board', async ({
  browser,
  request,
}) => {
  const res = await request.post(`${SYNC}/api/rooms`);
  const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
  const path = `/r/${roomId}#k=${editKey}`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // The page's socket goes through this route, so the test can lose what the page sends
  // (a change made on a bad network) and then cut the connection.
  let losing = false;
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/parties\/room\//, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (!losing) server.send(message);
    });
  });

  await openBoard(page, path);
  await addSticky(page, 'Shared', 300, 250);

  const filler = await connectFiller(roomId, editKey);
  try {
    // This sticky never reaches the server; meanwhile the board fills up.
    losing = true;
    await addSticky(page, 'Never sent', 600, 250);
    await filler.fill();
    await expect(page.getByTestId('board-full')).toBeVisible({ timeout: 15_000 });

    // The connection drops and comes back: the reconnect offers the lost sticky, and the
    // full board refuses it.
    losing = false;
    await socket?.close({ code: 4000, reason: 'test cut' });
    const notice = page.getByTestId('status-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("Some changes couldn't be saved");
    await page.getByTestId('status-reload').click();

    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', {
      timeout: 20_000,
    });
    await expect(page.getByText('Shared')).toBeVisible();
    await expect(page.getByText('Never sent')).toHaveCount(0);
    await expect(page.getByTestId('status-notice')).toHaveCount(0);
  } finally {
    filler.close();
    await ctx.close();
  }
});
```

The route replaces going offline with `context.setOffline`, which does not close a WebSocket that is already open in Chromium, so the sticky would be sent after all.

- [ ] **Step 3: Run the scenarios**

Run: `npx playwright test e2e/hardening.spec.ts --project=chromium`
Expected: PASS (2 scenarios). If the first fails at `pa.getByText('Drop me').click()` because a full board ignores the click, selection is being gated: a press must still select without edit access (`stepLocked` in `packages/core/src/tools/machine.ts`, Task 15). If the notice in the second scenario does not appear, check that the route saw the reconnect (log inside the `routeWebSocket` handler) and read the server log before changing the test.

- [ ] **Step 4: Run the whole suite**

Run: `npm run lint && npm run typecheck && npm test && npm run e2e`
Expected: PASS. Write down the totals `npm test` prints per workspace and the number of e2e scenarios per project; Step 5 needs them.

- [ ] **Step 5: Update both READMEs**

In `README.md`:

1. **Known limitations:** rename the heading line to `**Known limitations:**` and delete the first bullet with its three sub-bullets ("The sync protocol needs a hardening pass…", "strict awareness frame validation", "a finer document-size estimator", "surfacing "message too big" closes in the UI"). The calendar bullets stay, and one bullet is added above them: `- Offline: a board opened from the local copy takes edits until the server answers, a viewer's included; the server never accepts a viewer's (F5c).`
2. **Roadmap:** replace the `F5 — Ship` line with:

```markdown
- [ ] **F5 — Ship**
  - [x] **F5a protocol hardening:** awareness ids owned by their connection and validated on the server, presence that survives the room hibernating, a full board that stays deletable and resumes when it shrinks, a board that is read-only for viewers in their own copy too, visible closes instead of silent reconnect loops, a per-address limit on new boards ([plan](docs/superpowers/plans/2026-10-03-relay-f5a-hardening.md))
  - [ ] **F5b demo room** (next): a seeded board that resets nightly
  - [ ] **F5c offline polish**
  - [ ] **F5d deploy:** Vercel + Workers
```

3. **Tests:** update the `npm test` and `npm run e2e` lines with the totals from Step 4, and extend the table: the `sync-server` row gains "awareness ownership and validation, session takeover, presence after a hibernation, a full board accepting deletions, the room-creation limit"; the `packages/core` row gains "the tool machine by access"; the `e2e/` row gains "a board that fills, stays deletable and resumes; a viewer who cannot change the board".
4. **Engineering highlights:** add two rows:

```markdown
| Hostile input | The room inspects every frame before the Yjs handler: awareness ids belong to the connection that claimed them, states are re-encoded from a validator shared with the client, and a full board accepts only updates that add no structs | A peer cannot rewrite someone's cursor or name, and a board at its size cap can still be cleaned up instead of being stuck read-only |
| Hibernation | The room sleeps when nobody speaks and wakes with empty memory. Each connection carries the last presence of the ids it owns in its WebSocket attachment, and the room rebuilds from them on waking | Idle rooms cost nothing on the free plan, and nobody vanishes or lingers because the room slept |
```

Apply the same four changes, in Spanish, to `README.es.md` ("Limitaciones conocidas", "Hoja de ruta" with `F5a endurecimiento del protocolo` marked done and `F5b sala demo` as the next one, the test counts, and the highlights row).

- [ ] **Step 6: Check links, lint, commit**

Run: `npm run format && npm run lint`
Check that `docs/superpowers/plans/2026-10-03-relay-f5a-hardening.md` exists at the path both READMEs link to.

```bash
git add e2e README.md README.es.md
git commit -m "test(e2e): a board that fills, stays deletable and resumes; docs: F5a done, hardening limitations removed (EN + ES)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
