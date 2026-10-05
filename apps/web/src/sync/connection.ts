import { parseServerMessage, TIME_REQUEST } from '@relay/core';
import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { type ClockState, INITIAL_CLOCK, nextClock, TIME_REFRESH_MS } from './clock';
import { newSessionId } from './key';
import { sendOnlyOwnAwareness } from './ownAwareness';

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'unauthorized';

export interface RoomConnection {
  doc: Y.Doc;
  provider: YProvider;
  status: StoreApi<{ status: ConnStatus }>;
  clock: StoreApi<ClockState>;
  /** Current server time in epoch ms (local time until the first hello). */
  serverNow(): number;
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
    if (status.getState().status === 'unauthorized') return;
    status.setState({
      status: s === 'connected' ? 'online' : s === 'connecting' ? 'connecting' : 'offline',
    });
  });
  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event?.code === 4401) {
      status.setState({ status: 'unauthorized' });
      provider.disconnect();
    }
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
    destroy() {
      clearInterval(refresh);
      provider.destroy();
      void local.destroy();
      doc.destroy();
    },
  };
}
