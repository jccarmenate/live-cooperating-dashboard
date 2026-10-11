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
