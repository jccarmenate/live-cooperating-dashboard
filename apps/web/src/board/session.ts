import {
  type Identity,
  loadIdentity,
  MAIN_PAGE,
  type Peer,
  parseCamera,
  viewportRect,
} from '@relay/core';
import type { StoreApi } from 'zustand/vanilla';
import { SYNC_HOST } from '../config';
import { type ActivityState, createActivityStore } from '../store/activityStore';
import { createDocStore, type DocState } from '../store/docStore';
import { createPresenceStore } from '../store/presenceStore';
import { connectRoom, type RoomConnection } from '../sync/connection';
import { hashFor } from '../sync/key';
import { createPresencePublisher, type PresencePublisher } from '../sync/presence';
import { type BoardController, type CameraStorage, createBoardController } from './controller';

export interface BoardSession {
  roomId: string;
  /** Capability key from the URL fragment (null when the room is open). */
  key: string | null;
  user: Identity;
  conn: RoomConnection;
  doc: StoreApi<DocState>;
  activity: StoreApi<ActivityState>;
  presence: StoreApi<{ peers: Peer[] }>;
  publisher: PresencePublisher;
  controller: BoardController;
  /** Switches the active page (the same as `controller.setPage`). */
  setPage(id: string): void;
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
  const keyFor = (page: string) => `relay:camera:${roomId}:${page}`;
  return {
    load(page) {
      try {
        const raw = safeLocalStorage()?.getItem(keyFor(page));
        return raw ? parseCamera(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(page, camera) {
      try {
        safeLocalStorage()?.setItem(keyFor(page), JSON.stringify(camera));
      } catch {
        // Storage full or blocked: the camera just is not restored next time.
      }
    },
  };
}

export function createBoardSession(
  roomId: string,
  key: string | null,
  initialPage: string | null,
): BoardSession {
  const user = loadIdentity(safeLocalStorage());
  const conn = connectRoom({ roomId, key, host: SYNC_HOST });
  const docStore = createDocStore(conn.doc, initialPage ?? MAIN_PAGE);
  const presence = createPresenceStore(conn.provider.awareness);
  const publisher = createPresencePublisher(conn.provider.awareness, user);
  const activity = createActivityStore(conn.doc);
  const controller = createBoardController({
    doc: conn.doc,
    docStore: docStore.store,
    setPage: docStore.setPage,
    activity: activity.store,
    user,
    serverNow: conn.serverNow,
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

  // Peers see which page we are on; the URL keeps it for reloads and shared links.
  publisher.setPage(docStore.store.getState().activePage);
  const unsubscribePage = docStore.store.subscribe((state, prev) => {
    if (state.activePage === prev.activePage) return;
    publisher.setPage(state.activePage);
    try {
      window.history.replaceState(null, '', hashFor(key, state.activePage));
    } catch {
      // Non-browser environments: nothing to mirror.
    }
  });

  const onSync = (isSynced: boolean) => {
    if (isSynced) controller.markSynced();
  };
  conn.provider.on('sync', onSync);
  if (conn.provider.synced) controller.markSynced();

  return {
    roomId,
    key,
    user,
    conn,
    doc: docStore.store,
    activity: activity.store,
    presence: presence.store,
    publisher,
    controller,
    setPage: controller.setPage,
    destroy() {
      unsubscribe();
      unsubscribePage();
      conn.provider.off('sync', onSync);
      controller.destroy();
      publisher.destroy();
      presence.destroy();
      activity.destroy();
      docStore.destroy();
      conn.destroy();
    },
  };
}
