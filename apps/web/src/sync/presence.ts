import { type Identity, type Point, type PresenceState, type Rect, throttle } from '@relay/core';
import type { Awareness } from 'y-protocols/awareness';

export interface PresencePublisher {
  setCursor(p: Point | null): void;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  setViewport(r: Rect | null): void;
  setPage(page: string): void;
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
    setSelection: (ids) => awareness.setLocalStateField('selection', ids),
    setEditing: (id) => awareness.setLocalStateField('editing', id),
    setViewport,
    setPage: (page) => awareness.setLocalStateField('page', page),
    destroy() {
      setCursor.cancel();
      setViewport.cancel();
      awareness.setLocalState(null);
    },
  };
}
