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
import { type CalendarState, createCalendarStore } from '../store/calendarStore';
import { createDocStore, type DocState } from '../store/docStore';
import { createPresenceStore } from '../store/presenceStore';
import { createSheetStore, type SheetState } from '../store/sheetStore';
import { boardAccess } from '../sync/clock';
import { connectRoom, type RoomConnection } from '../sync/connection';
import { hashFor, hashTarget, pageFromHash } from '../sync/key';
import { createPresencePublisher, type PresencePublisher } from '../sync/presence';
import { toast } from '../ui/toasts';
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
  /** Projection of the active sheet page (null sheet on other pages). */
  sheet: StoreApi<SheetState>;
  /** Projection of the active calendar page (null calendar on other pages). */
  calendar: StoreApi<CalendarState>;
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
  const sheetStore = createSheetStore(conn.doc, docStore.store);
  const calendarStore = createCalendarStore(conn.doc, docStore.store);
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
    notify: toast,
    access: () => boardAccess(conn.clock.getState()),
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

  /**
   * A stale `#p=` (deleted or unknown page, or none at all) must not stay in the URL.
   * `keepNamed` leaves a hash that names a page alone: before the first sync, that page
   * may still arrive.
   */
  const correctHash = (keepNamed = false) => {
    try {
      const named = pageFromHash(window.location.hash);
      const active = docStore.store.getState().activePage;
      if (named !== active && !(keepNamed && named !== null)) {
        window.history.replaceState(null, '', hashFor(key, active));
      }
    } catch {
      // Non-browser environments: nothing to mirror.
    }
  };
  // After the first sync every page the link could name has arrived: pin what is showing
  // (a stale link stops waiting) and fix the URL to match.
  let pinned = false;
  const pinAfterFirstSync = () => {
    if (pinned) return;
    pinned = true;
    docStore.pinActive();
    correctHash();
  };

  const onSync = (isSynced: boolean) => {
    if (!isSynced) return;
    controller.markSynced();
    pinAfterFirstSync();
  };
  conn.provider.on('sync', onSync);
  if (conn.provider.synced) {
    controller.markSynced();
    pinAfterFirstSync();
  } else {
    correctHash(true);
  }

  // Editing the fragment (or following an in-app #p= link) switches pages; replaceState never fires this.
  const onHashChange = () => {
    const target = hashTarget(window.location.hash, key, docStore.store.getState().activePage);
    if (target === 'reload') window.location.reload();
    else if (target) {
      // After the first sync a missing page never arrives: the user stays where they are and
      // the dead #p= is dropped from the URL. Before it, the named page may still arrive, so
      // it is requested and keeps waiting.
      if (pinned && !docStore.store.getState().pages.some((p) => p.id === target.page)) {
        correctHash();
        return;
      }
      controller.setPage(target.page);
      if (pinned) {
        docStore.pinActive();
        correctHash();
      }
    }
  };
  window.addEventListener('hashchange', onHashChange);

  return {
    roomId,
    key,
    user,
    conn,
    doc: docStore.store,
    activity: activity.store,
    presence: presence.store,
    sheet: sheetStore.store,
    calendar: calendarStore.store,
    publisher,
    controller,
    setPage: controller.setPage,
    destroy() {
      window.removeEventListener('hashchange', onHashChange);
      unsubscribe();
      unsubscribePage();
      conn.provider.off('sync', onSync);
      controller.destroy();
      publisher.destroy();
      presence.destroy();
      activity.destroy();
      sheetStore.destroy();
      calendarStore.destroy();
      docStore.destroy();
      conn.destroy();
    },
  };
}
