import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCommand, DEFAULT_STYLE, getRoots, readMeta } from '@relay/core';
import * as encoding from 'lib0/encoding';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import YProvider from 'y-partyserver/provider';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';
import { encodeAwarenessUpdate as encodeEntries, wrapAwareness } from '../src/awareness';
import { LIMITS } from '../src/limits';
import { type RunningWorker, startWorker } from './helpers/worker';

const PORT = 8799;
const persistDir = mkdtempSync(join(tmpdir(), 'relay-do-'));
let worker: RunningWorker | undefined;
const open: YProvider[] = [];
const rawSockets: WebSocket[] = [];

beforeAll(async () => {
  worker = await startWorker({ port: PORT, persistDir });
});

afterEach(() => {
  // A provider adds a listener to the process's `exit` event and removes it only when it is
  // destroyed: more than ten alive at once make Node print a MaxListenersExceededWarning.
  for (const p of open.splice(0)) p.destroy();
});

afterAll(async () => {
  for (const ws of rawSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  await worker?.stop();
});

function connect(room: string, key: string | null) {
  const doc = new Y.Doc();
  const provider = new YProvider(`127.0.0.1:${PORT}`, room, doc, {
    party: 'room',
    params: key ? { key } : {},
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  open.push(provider);
  return { doc, provider };
}

/** Connects directly to the room's WebSocket endpoint, bypassing the Yjs provider. */
function rawConnect(
  room: string,
  opts: { key?: string; sid?: string; pk?: string; headers?: Record<string, string> } = {},
): WebSocket {
  // The app's provider keeps one `_pk` for its whole life: a reconnect arrives with the same one.
  const params = new URLSearchParams({ _pk: opts.pk ?? Math.random().toString(36).slice(2) });
  if (opts.key !== undefined) params.set('key', opts.key);
  if (opts.sid !== undefined) params.set('sid', opts.sid);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/parties/room/${room}?${params.toString()}`, {
    headers: opts.headers,
  });
  rawSockets.push(ws);
  return ws;
}

function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for open')), timeoutMs);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Resolves with the next custom (`__YPS:`) JSON message on a raw socket; with `type`, with the
 * next one of that type.
 */
function nextCustom(
  ws: WebSocket,
  timeoutMs = 5000,
  type?: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for a custom message')),
      timeoutMs,
    );
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      const text = data.toString();
      if (!text.startsWith('__YPS:')) return;
      const message = JSON.parse(text.slice(6)) as Record<string, unknown>;
      if (type !== undefined && message.type !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    };
    ws.on('message', onMessage);
  });
}

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

/**
 * Asks the server time and waits for the answer. The server's close of a socket that never
 * sent anything takes about ten seconds to complete (55 ms once it has spoken), so a test that
 * waits for the close code of a socket the server retires makes it speak first.
 */
async function ping(ws: WebSocket): Promise<void> {
  ws.send('__YPS:{"type":"time?"}');
  // One listener until the answer. Messages that arrive in one chunk are emitted in one turn, so
  // a listener attached after the first of them (a `hello`, say) would miss the second.
  await nextCustom(ws, 5000, 'time');
}

/** Encodes a raw `messageAwareness` (type byte 1) frame carrying the given state. */
function encodeAwarenessMessage(state: Record<string, unknown>): Uint8Array {
  const awareness = new Awareness(new Y.Doc());
  awareness.setLocalState(state);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1); // messageAwareness
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [awareness.clientID]));
  return encoding.toUint8Array(encoder);
}

/** Encodes a raw `messageSync` (type byte 0) frame carrying a sync-protocol Update (sub-type 2). */
function encodeUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // messageSync
  writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

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
      entries.map((e) => ({
        clientId: e.clientId,
        clock: e.clock,
        state: JSON.stringify(e.state),
      })),
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

async function createRoom(): Promise<{ roomId: string; editKey: string; viewKey: string }> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/rooms`, { method: 'POST' });
  expect(res.ok).toBe(true);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const synced = (p: YProvider) => waitFor(() => p.synced);

function addSticky(doc: Y.Doc, id: string) {
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id,
      type: 'sticky',
      x: 0,
      y: 0,
      w: 180,
      h: 140,
      style: DEFAULT_STYLE.sticky,
      text: 'hello',
      createdBy: 'u1',
      authorName: 'Test',
      createdAt: 0,
    },
  });
}

describe('sync server', () => {
  it('creates rooms with distinct capability keys', async () => {
    const a = await createRoom();
    const b = await createRoom();
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.editKey).not.toBe(a.viewKey);
  });

  it('propagates edits between two editors', async () => {
    const { roomId, editKey } = await createRoom();
    const a = connect(roomId, editKey);
    const b = connect(roomId, editKey);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    addSticky(a.doc, 's1');
    await waitFor(() => getRoots(b.doc).shapes.has('s1'));
  });

  it('viewers receive updates but cannot write', async () => {
    const { roomId, editKey, viewKey } = await createRoom();
    const editor = connect(roomId, editKey);
    const viewer = connect(roomId, viewKey);
    await Promise.all([synced(editor.provider), synced(viewer.provider)]);
    addSticky(editor.doc, 'from-editor');
    await waitFor(() => getRoots(viewer.doc).shapes.has('from-editor'));
    addSticky(viewer.doc, 'from-viewer');
    await new Promise((r) => setTimeout(r, 1000));
    expect(getRoots(editor.doc).shapes.has('from-viewer')).toBe(false);
  });

  it('closes connections with an invalid key using code 4401', async () => {
    const { roomId } = await createRoom();
    const { provider } = connect(roomId, 'bogus');
    const codes: number[] = [];
    provider.on('connection-close', (event: CloseEvent | null) => {
      if (event) codes.push(event.code);
    });
    // The Worker's onBeforeConnect now rejects an invalid key with a locally
    // accepted-then-closed WebSocketPair before the request ever reaches the
    // Durable Object (fix-round-1 item 4), so the close is no longer gated by
    // DO hibernation wake latency. Measured directly with `ws` (bypassing the
    // provider): close arrives in ~9-17ms. The default 5s waitFor is now ample.
    await waitFor(() => codes.includes(4401));
    provider.destroy();
  });

  it('rejects a spoofed role header without a valid key, before reaching the room', async () => {
    const { roomId } = await createRoom();
    const ws = rawConnect(roomId, { headers: { 'x-relay-role': 'edit' } });
    const messages: unknown[] = [];
    ws.on('message', (data) => messages.push(data));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4401);
    expect(messages).toHaveLength(0);
  });

  it('never lets an unauthorized socket leak an awareness update to a real editor', async () => {
    const { roomId, editKey } = await createRoom();
    const editor = connect(roomId, editKey);
    await synced(editor.provider);

    const intruder = rawConnect(roomId, { key: 'bogus' });
    intruder.on('open', () => {
      intruder.send(encodeAwarenessMessage({ name: 'INTRUDER' }));
    });
    // Give the intruder's send (if it ever went anywhere) time to be broadcast
    // and observed by the editor.
    await new Promise((r) => setTimeout(r, 1500));

    const states = [...editor.provider.awareness.getStates().values()] as Array<{ name?: string }>;
    expect(states.some((s) => s.name === 'INTRUDER')).toBe(false);
  });

  it('closes a single oversized message from an editor with code 1009', async () => {
    const { roomId, editKey } = await createRoom();
    const ws = rawConnect(roomId, { key: editKey });
    await waitForOpen(ws);
    const oversized = Buffer.alloc(LIMITS.maxMessageBytes + 1024, 1);
    const closed = waitForClose(ws);
    ws.send(oversized);
    const { code } = await closed;
    expect(code).toBe(1009);
  });

  it('a connection that floods the room is closed with 4429', async () => {
    const { roomId, editKey } = await createRoom();
    const ws = rawConnect(roomId, { key: editKey });
    await waitForOpen(ws);
    const closed = waitForClose(ws);
    // Far past the burst of 120, whatever the refill while the room reads them.
    for (let i = 0; i < 400; i++) ws.send('__YPS:{"type":"time?"}');
    expect((await closed).code).toBe(4429);
  });

  it('freezes the room once an editor pushes it past the document size cap', async () => {
    const { roomId, editKey } = await createRoom();
    const a = connect(roomId, editKey);
    const b = connect(roomId, editKey);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    addSticky(a.doc, 'growing');
    await waitFor(() => getRoots(b.doc).shapes.has('growing'));

    // Several sub-256KB updates that together exceed the 1 MB document cap.
    const chunk = 'x'.repeat(200_000);
    for (let i = 0; i < 6; i++) {
      applyCommand(a.doc, {
        type: 'SetText',
        id: 'growing',
        index: 0,
        deleteCount: 0,
        insert: chunk,
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    // Let the server catch up on the backlog of sync messages.
    await new Promise((r) => setTimeout(r, 500));

    addSticky(a.doc, 'after-cap');
    await new Promise((r) => setTimeout(r, 1000));
    expect(getRoots(b.doc).shapes.has('after-cap')).toBe(false);
  });

  it('does not stay frozen forever from re-sent no-op sync messages, once the real size is re-measured', async () => {
    const { roomId, editKey } = await createRoom();
    const a = connect(roomId, editKey);
    const b = connect(roomId, editKey);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    addSticky(a.doc, 'growing');
    await waitFor(() => getRoots(b.doc).shapes.has('growing'));

    // A single real edit, captured as a raw sync-protocol Update frame the
    // room already fully knows about (it came from `a`'s own provider).
    applyCommand(a.doc, {
      type: 'SetText',
      id: 'growing',
      index: 0,
      deleteCount: 0,
      insert: 'x'.repeat(150_000),
    });
    await new Promise((r) => setTimeout(r, 300));
    const duplicateFrame = encodeUpdateMessage(Y.encodeStateAsUpdate(a.doc));

    const raw = rawConnect(roomId, { key: editKey });
    await waitForOpen(raw);
    // Re-send the *same* already-applied update several times. Each resend
    // is a no-op for the real document (Yjs already has this state), but a
    // naive byte-counter that adds the full frame size every time would
    // still cross the 1 MB cap and freeze the room forever.
    for (let i = 0; i < 8; i++) {
      raw.send(duplicateFrame);
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 500));

    addSticky(a.doc, 'after-duplicates');
    await waitFor(() => getRoots(b.doc).shapes.has('after-duplicates'));
  });

  it('a full board says so, accepts deletions, refuses the rest and resumes when it shrinks', {
    timeout: 60_000,
  }, async () => {
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

  it('keeps nothing it cannot apply: an update with a gap closes its sender with 4400', async () => {
    const { roomId, editKey } = await createRoom();
    const mallory = rawConnect(roomId, { key: editKey });
    await waitForOpen(mallory);
    // The second change of a document whose first change the room never got. Yjs cannot apply it
    // and would park it in the store, where nothing counts it and no deletion reaches it.
    const doc = new Y.Doc();
    doc.getMap('m').set('a', 1);
    const afterFirst = Y.encodeStateVector(doc);
    doc.getMap('m').set('b', 'x'.repeat(100_000));
    const closed = waitForClose(mallory);
    mallory.send(encodeUpdateMessage(Y.encodeStateAsUpdate(doc, afterFirst)));
    expect((await closed).code).toBe(4400);

    // Nobody who syncs afterwards is handed the parked data.
    const late = connect(roomId, editKey);
    await synced(late.provider);
    expect(late.doc.store.pendingStructs).toBeNull();
    expect(late.doc.store.pendingDs).toBeNull();
  });

  it('a deletion of content the room does not have closes its sender with 4400', async () => {
    const { roomId, editKey } = await createRoom();
    const mallory = rawConnect(roomId, { key: editKey });
    await waitForOpen(mallory);
    const doc = new Y.Doc();
    doc.getMap('m').set('never-sent', 1);
    let deletion: Uint8Array | undefined;
    doc.on('update', (u: Uint8Array) => {
      deletion = u;
    });
    doc.getMap('m').delete('never-sent');
    const closed = waitForClose(mallory);
    mallory.send(encodeUpdateMessage(deletion as Uint8Array));
    expect((await closed).code).toBe(4400);
  });

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

  it('a connection updates and removes the state of an id it owns', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    const ann = rawConnect(roomId, { key: editKey });
    await waitForOpen(ann);
    ann.send(awarenessFrame([{ clientId: 7001, clock: 1, state: presence('Ann') }]));
    await waitFor(() => nameOf(watcher.provider, 7001) === 'Ann');
    ann.send(awarenessFrame([{ clientId: 7001, clock: 2, state: presence('Ann B') }]));
    await waitFor(() => nameOf(watcher.provider, 7001) === 'Ann B');
    ann.send(awarenessFrame([{ clientId: 7001, clock: 3, state: null }]));
    await waitFor(() => !watcher.provider.awareness.getStates().has(7001));
    // The id was released with its state: two others fit the cap again.
    ann.send(awarenessFrame([{ clientId: 7002, clock: 1, state: presence('two') }]));
    ann.send(awarenessFrame([{ clientId: 7003, clock: 1, state: presence('three') }]));
    await waitFor(() => nameOf(watcher.provider, 7003) === 'three');
    expect(nameOf(watcher.provider, 7002)).toBe('two');
  });

  it('a removal with a stale clock does not free the id, and a close removes what was left', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    const mallory = rawConnect(roomId, { key: editKey });
    await waitForOpen(mallory);
    const closed = waitForClose(mallory);
    for (const id of [7101, 7102, 7103]) {
      mallory.send(awarenessFrame([{ clientId: id, clock: 5, state: presence(`ghost ${id}`) }]));
      mallory.send(awarenessFrame([{ clientId: id, clock: 3, state: null }]));
    }
    expect((await closed).code).toBe(4429);
    await settle();
    const left = [7101, 7102, 7103].filter((id) => watcher.provider.awareness.getStates().has(id));
    expect(left).toEqual([]);
  });

  it('ids claimed and removed inside one frame cannot pass the cap', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = rawConnect(roomId, { key: editKey });
    const mallory = rawConnect(roomId, { key: editKey });
    await Promise.all([waitForOpen(watcher), waitForOpen(mallory)]);
    const seen = countAwarenessFrames(watcher);
    const closed = waitForClose(mallory);
    mallory.send(
      awarenessFrame(
        [7201, 7202, 7203].flatMap((id) => [
          { clientId: id, clock: 5, state: presence(`ghost ${id}`) },
          { clientId: id, clock: 3, state: null },
        ]),
      ),
    );
    expect((await closed).code).toBe(4429);
    await settle();
    expect(seen()).toBe(0);
  });

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

  it('the new socket of a session owns the ids it inherited, until it closes', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    const tab = { key: editKey, sid: 'tab-session-0004', pk: 'tab-conn-04' };
    const first = rawConnect(roomId, tab);
    await waitForOpen(first);
    first.send(awarenessFrame([{ clientId: 4201, clock: 1, state: presence('Ann') }]));
    await waitFor(() => nameOf(watcher.provider, 4201) === 'Ann');

    const firstClosed = waitForClose(first);
    const second = rawConnect(roomId, tab);
    await waitForOpen(second);
    expect((await firstClosed).code).toBe(4409);
    // The new socket has sent no presence yet, and already owns the id: another session cannot
    // take it.
    const stranger = rawConnect(roomId, { key: editKey, sid: 'tab-session-0005' });
    await waitForOpen(stranger);
    stranger.send(awarenessFrame([{ clientId: 4201, clock: 9, state: presence('Mallory') }]));
    await settle();
    expect(nameOf(watcher.provider, 4201)).toBe('Ann');
    // And the room removes the state when that socket goes, as it does for any owner.
    await ping(second);
    second.close();
    await waitFor(() => !watcher.provider.awareness.getStates().has(4201));
  });

  it('tells two sockets that share a connection id apart when they publish presence', async () => {
    const { roomId, editKey } = await createRoom();
    const watcher = connect(roomId, editKey);
    await synced(watcher.provider);
    // No `sid`, so the room cannot know the first socket is stale: both are live.
    const a = rawConnect(roomId, { key: editKey, pk: 'shared-conn-02' });
    const b = rawConnect(roomId, { key: editKey, pk: 'shared-conn-02' });
    await Promise.all([waitForOpen(a), waitForOpen(b)]);
    a.send(awarenessFrame([{ clientId: 4301, clock: 1, state: presence('Ann') }]));
    await waitFor(() => nameOf(watcher.provider, 4301) === 'Ann');
    b.send(awarenessFrame([{ clientId: 4301, clock: 5, state: presence('Mallory') }]));
    await settle();
    expect(nameOf(watcher.provider, 4301)).toBe('Ann');
  });

  it('two sockets that share a connection id each have their own message allowance', async () => {
    const { roomId, editKey } = await createRoom();
    const a = rawConnect(roomId, { key: editKey, pk: 'shared-conn-03' });
    const b = rawConnect(roomId, { key: editKey, pk: 'shared-conn-03' });
    const toA = collectCustom(a);
    const toB = collectCustom(b);
    await Promise.all([waitForOpen(a), waitForOpen(b)]);
    // A hundred each: under one socket's burst of 120, and over it if the two shared a bucket.
    for (let i = 0; i < 100; i++) b.send('__YPS:{"type":"time?"}');
    for (let i = 0; i < 100; i++) a.send('__YPS:{"type":"time?"}');
    const answers = (seen: Record<string, unknown>[]) =>
      seen.filter((m) => m.type === 'time').length;
    await waitFor(() => answers(toA) === 100 && answers(toB) === 100);
    expect(a.readyState).toBe(WebSocket.OPEN);
    expect(b.readyState).toBe(WebSocket.OPEN);
  });

  it('lets anyone into the demo room and initializes its metadata', async () => {
    const { doc, provider } = connect('demo', null);
    await synced(provider);
    await waitFor(() => readMeta(getRoots(doc).meta).title === 'Sprint 14 Retro');
  });

  it('persists documents across a server restart', async () => {
    const { roomId, editKey } = await createRoom();
    const a = connect(roomId, editKey);
    await synced(a.provider);
    addSticky(a.doc, 'durable');
    await new Promise((r) => setTimeout(r, 3000)); // > debounceWait (2 s)
    a.provider.destroy();
    await worker?.stop();
    worker = await startWorker({ port: PORT, persistDir });
    const b = connect(roomId, editKey);
    await synced(b.provider);
    await waitFor(() => getRoots(b.doc).shapes.has('durable'));
  });

  it('says hello with the role and server time, and answers time requests', async () => {
    const { roomId, editKey, viewKey } = await createRoom();
    const editor = rawConnect(roomId, { key: editKey });
    const hello = nextCustom(editor);
    await waitForOpen(editor);
    const h = await hello;
    expect(h.type).toBe('hello');
    expect(h.role).toBe('edit');
    expect(h.full).toBe(false);
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

  it('sends the view key to editors only', async () => {
    const { roomId, editKey, viewKey } = await createRoom();
    const editor = rawConnect(roomId, { key: editKey });
    const editorHello = nextCustom(editor);
    await waitForOpen(editor);
    expect((await editorHello).viewKey).toBe(viewKey);
    const viewer = rawConnect(roomId, { key: viewKey });
    const viewerHello = nextCustom(viewer);
    await waitForOpen(viewer);
    expect((await viewerHello).viewKey).toBeUndefined();
  });

  it('sends no view key in the demo room, where every key edits', async () => {
    const editor = rawConnect('demo');
    const hello = nextCustom(editor);
    await waitForOpen(editor);
    const h = await hello;
    expect(h.role).toBe('edit');
    expect(h.viewKey).toBeUndefined();
  });
});
