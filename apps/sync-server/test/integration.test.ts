import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCommand, DEFAULT_STYLE, getRoots, readMeta } from '@relay/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { type RunningWorker, startWorker } from './helpers/worker';

const PORT = 8799;
const persistDir = mkdtempSync(join(tmpdir(), 'relay-do-'));
let worker: RunningWorker | undefined;
const open: YProvider[] = [];

beforeAll(async () => {
  worker = await startWorker({ port: PORT, persistDir });
});

afterAll(async () => {
  for (const p of open) p.destroy();
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
    // Locally under `wrangler dev`, the hibernatable-websocket close frame sent
    // from `onConnect` is observed to take ~10s to reach the client (consistently
    // reproduced by connecting directly with `ws`, bypassing the provider) even
    // though the DO calls `connection.close()` synchronously; the 5s default is
    // too tight here, so this waits longer while staying under the 30s test timeout.
    await waitFor(() => codes.includes(4401), 20_000);
    provider.destroy();
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
