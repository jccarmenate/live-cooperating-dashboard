import { type Identity, loadIdentity, type Peer, parseCamera, viewportRect } from '@relay/core';
import type { StoreApi } from 'zustand/vanilla';
import { SYNC_HOST } from '../config';
import { createDocStore, type DocState } from '../store/docStore';
import { createPresenceStore } from '../store/presenceStore';
import { connectRoom, type RoomConnection } from '../sync/connection';
import { createPresencePublisher, type PresencePublisher } from '../sync/presence';
import { type BoardController, type CameraStorage, createBoardController } from './controller';

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

function cameraStorage(roomId: string): CameraStorage {
  const key = `relay:camera:${roomId}`;
  return {
    load() {
      try {
        const raw = safeLocalStorage()?.getItem(key);
        return raw ? parseCamera(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(camera) {
      try {
        safeLocalStorage()?.setItem(key, JSON.stringify(camera));
      } catch {
        // Storage full or blocked: the camera just is not restored next time.
      }
    },
  };
}

export function createBoardSession(roomId: string, key: string | null): BoardSession {
  const user = loadIdentity(safeLocalStorage());
  const conn = connectRoom({ roomId, key, host: SYNC_HOST });
  const docStore = createDocStore(conn.doc);
  const presence = createPresenceStore(conn.provider.awareness);
  const publisher = createPresencePublisher(conn.provider.awareness, user);
  const controller = createBoardController({
    doc: conn.doc,
    docStore: docStore.store,
    user,
    cameraStorage: cameraStorage(roomId),
  });

  const unsubscribe = controller.ui.subscribe((state, prev) => {
    if (state.tool.selection !== prev.tool.selection) publisher.setSelection(state.tool.selection);
    if (state.editingId !== prev.editingId) publisher.setEditing(state.editingId);
    if (state.camera !== prev.camera || state.viewport !== prev.viewport) {
      publisher.setViewport(
        state.viewport ? viewportRect(state.camera, state.viewport.w, state.viewport.h) : null,
      );
    }
  });

  const onSync = (isSynced: boolean) => {
    if (isSynced) controller.markSynced();
  };
  conn.provider.on('sync', onSync);
  if (conn.provider.synced) controller.markSynced();

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
      conn.provider.off('sync', onSync);
      controller.destroy();
      publisher.destroy();
      presence.destroy();
      docStore.destroy();
      conn.destroy();
    },
  };
}
