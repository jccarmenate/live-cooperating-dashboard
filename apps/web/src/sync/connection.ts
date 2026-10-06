import { parseServerMessage, TIME_REQUEST } from '@relay/core';
import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
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
  const localName = `relay:${opts.roomId}`;
  const local = new IndexeddbPersistence(localName, doc);
  const sid = newSessionId();
  const provider = new YProvider(opts.host, opts.roomId, doc, {
    party: 'room',
    connect: false,
    params: opts.key ? { key: opts.key, sid } : { sid },
  });
  sendOnlyOwnAwareness(provider);
  // The provider's connect() is async: started in the same task as a destroy(), it would open
  // its socket afterwards (React StrictMode mounts, cleans up and mounts again in one task).
  // So every connect waits one microtask and does nothing if the connection is gone by then.
  let destroyed = false;
  const connect = () =>
    queueMicrotask(() => {
      if (!destroyed) void provider.connect();
    });
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
    waiting = setTimeout(connect, action.ms);
  });

  const clock = createStore<ClockState>(() => INITIAL_CLOCK);
  provider.on('custom-message', (raw: string) => {
    const msg = parseServerMessage(raw);
    if (msg) clock.setState(nextClock(clock.getState(), msg, Date.now()));
  });
  const refresh = setInterval(() => {
    if (status.getState().status === 'online') provider.sendMessage(TIME_REQUEST);
  }, TIME_REFRESH_MS);

  connect();
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
      connect();
    },
    async discardAndReload() {
      clearTimeout(waiting);
      provider.disconnect();
      try {
        // clearData() only asks for the delete. Waiting for it keeps the reloaded page from
        // opening the copy that still holds the refused change.
        await local.destroy();
        await clearDocument(localName);
      } finally {
        // If the copy cannot be cleared there is none to clear (IndexedDB is unavailable).
        window.location.reload();
      }
    },
    destroy() {
      destroyed = true;
      clearInterval(refresh);
      clearTimeout(waiting);
      provider.destroy();
      void local.destroy();
      doc.destroy();
    },
  };
}
