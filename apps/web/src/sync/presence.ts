import { type Identity, type Point, type PresenceState, throttle } from '@relay/core';
import type { Awareness } from 'y-protocols/awareness';

export interface PresencePublisher {
  setCursor(p: Point | null): void;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  destroy(): void;
}

export function createPresencePublisher(awareness: Awareness, user: Identity): PresencePublisher {
  const initial: PresenceState = { user, cursor: null, selection: [], editing: null };
  awareness.setLocalState(initial);
  const setCursor = throttle((cursor: Point | null) => {
    awareness.setLocalStateField('cursor', cursor);
  }, 50);
  return {
    setCursor,
    setSelection: (ids) => awareness.setLocalStateField('selection', ids),
    setEditing: (id) => awareness.setLocalStateField('editing', id),
    destroy() {
      setCursor.cancel();
      awareness.setLocalState(null);
    },
  };
}
