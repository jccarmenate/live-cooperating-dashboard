import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'unauthorized';

export interface RoomConnection {
  doc: Y.Doc;
  provider: YProvider;
  status: StoreApi<{ status: ConnStatus }>;
  destroy(): void;
}

export function connectRoom(opts: {
  roomId: string;
  key: string | null;
  host: string;
}): RoomConnection {
  const doc = new Y.Doc();
  const local = new IndexeddbPersistence(`relay:${opts.roomId}`, doc);
  const provider = new YProvider(opts.host, opts.roomId, doc, {
    party: 'room',
    params: opts.key ? { key: opts.key } : {},
  });
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

  return {
    doc,
    provider,
    status,
    destroy() {
      provider.destroy();
      void local.destroy();
      doc.destroy();
    },
  };
}
