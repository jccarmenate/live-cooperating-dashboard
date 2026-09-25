import { type Identity, loadIdentity, type Peer } from '@relay/core';
import type { StoreApi } from 'zustand/vanilla';
import { SYNC_HOST } from '../config';
import { createDocStore, type DocState } from '../store/docStore';
import { createPresenceStore } from '../store/presenceStore';
import { connectRoom, type RoomConnection } from '../sync/connection';
import { createPresencePublisher, type PresencePublisher } from '../sync/presence';
import { type BoardController, createBoardController } from './controller';

export interface BoardSession {
  roomId: string;
  user: Identity;
  conn: RoomConnection;
  doc: StoreApi<DocState>;
  presence: StoreApi<{ peers: Peer[] }>;
  publisher: PresencePublisher;
  controller: BoardController;
  destroy(): void;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createBoardSession(roomId: string, key: string | null): BoardSession {
  const user = loadIdentity(safeLocalStorage());
  const conn = connectRoom({ roomId, key, host: SYNC_HOST });
  const docStore = createDocStore(conn.doc);
  const presence = createPresenceStore(conn.provider.awareness);
  const publisher = createPresencePublisher(conn.provider.awareness, user);
  const controller = createBoardController({ doc: conn.doc, docStore: docStore.store, user });

  const unsubscribe = controller.ui.subscribe((state, prev) => {
    if (state.tool.selection !== prev.tool.selection) publisher.setSelection(state.tool.selection);
    if (state.editingId !== prev.editingId) publisher.setEditing(state.editingId);
  });

  return {
    roomId,
    user,
    conn,
    doc: docStore.store,
    presence: presence.store,
    publisher,
    controller,
    destroy() {
      unsubscribe();
      controller.destroy();
      publisher.destroy();
      presence.destroy();
      docStore.destroy();
      conn.destroy();
    },
  };
}
