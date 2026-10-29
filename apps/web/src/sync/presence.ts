import {
  type Identity,
  MAX_PRESENCE_SELECTION,
  type Point,
  type PresenceState,
  type Rect,
  type SheetPresence,
  throttle,
} from '@relay/core';
import type { Awareness } from 'y-protocols/awareness';

export interface PresencePublisher {
  setCursor(p: Point | null): void;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  setViewport(r: Rect | null): void;
  setPage(page: string): void;
  setSheet(s: SheetPresence | null): void;
  setCalEvent(id: string | null): void;
  destroy(): void;
}

export function createPresencePublisher(awareness: Awareness, user: Identity): PresencePublisher {
  const initial: PresenceState = {
    user,
    cursor: null,
    selection: [],
    editing: null,
    viewport: null,
    page: null,
    sheet: null,
    calEvent: null,
  };
  awareness.setLocalState(initial);
  const setCursor = throttle((cursor: Point | null) => {
    awareness.setLocalStateField('cursor', cursor);
  }, 50);
  const setViewport = throttle((viewport: Rect | null) => {
    awareness.setLocalStateField('viewport', viewport);
  }, 50);
  return {
    setCursor,
    setSelection: (ids) =>
      // Shape ids are UUIDs: more than about 200 of them would pass the server's 8 KB frame cap.
      awareness.setLocalStateField('selection', ids.slice(0, MAX_PRESENCE_SELECTION)),
    setEditing: (id) => awareness.setLocalStateField('editing', id),
    setViewport,
    setPage: (page) => awareness.setLocalStateField('page', page),
    setSheet: (s) => awareness.setLocalStateField('sheet', s),
    setCalEvent: (id) => awareness.setLocalStateField('calEvent', id),
    destroy() {
      setCursor.cancel();
      setViewport.cancel();
      awareness.setLocalState(null);
    },
  };
}
