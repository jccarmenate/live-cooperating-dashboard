import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCommand, DEFAULT_STYLE, getRoots, readMeta } from '@relay/core';
import * as encoding from 'lib0/encoding';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import YProvider from 'y-partyserver/provider';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
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

afterAll(async () => {
  for (const p of open) p.destroy();
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
  opts: { key?: string; headers?: Record<string, string> } = {},
): WebSocket {
  const params = new URLSearchParams({ _pk: Math.random().toString(36).slice(2) });
  if (opts.key !== undefined) params.set('key', opts.key);
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

/** Encodes a raw `messageAwareness` (type byte 1) frame carrying the given state. */
function encodeAwarenessMessage(state: Record<string, unknown>): Uint8Array {
  const awareness = new Awareness(new Y.Doc());
  awareness.setLocalState(state);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1); // messageAwareness
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [awareness.clientID]));
  return encoding.toUint8Array(encoder);
}

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
});
