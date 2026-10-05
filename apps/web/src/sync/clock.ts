import type { Role, ServerMessage } from '@relay/core';

export interface ClockState {
  /** Capability from the server's hello; null until the first hello arrives. */
  role: Role | null;
  /** serverNow = Date.now() + offset. Error is at most the one-way latency. */
  offset: number;
  /** Read-only link key (editors only, from hello). */
  viewKey: string | null;
  /** The board is over its size cap: the server only accepts deletions. */
  full: boolean;
  /** The server refused one of this client's changes; the local copy has drifted from the board. */
  unsaved: boolean;
}

export const INITIAL_CLOCK: ClockState = {
  role: null,
  offset: 0,
  viewKey: null,
  full: false,
  unsaved: false,
};

/** How often the client asks for the server time while online. */
export const TIME_REFRESH_MS = 300_000;

export function nextClock(prev: ClockState, msg: ServerMessage, localNow: number): ClockState {
  const offset = msg.now - localNow;
  switch (msg.type) {
    case 'hello':
      return { ...prev, role: msg.role, offset, viewKey: msg.viewKey ?? null, full: msg.full };
    case 'room':
      return { ...prev, offset, full: msg.full };
    case 'rejected':
      // Only a reload clears it: the local document still holds the refused change.
      return { ...prev, offset, unsaved: true };
    case 'time':
      return { ...prev, offset };
  }
}

/** What this user may do: edit, only delete (an editor on a full board), or view. */
export type Capability = 'edit' | 'delete-only' | 'view';

type Capable = Pick<ClockState, 'role' | 'full'>;

export function capability(c: Capable): Capability {
  if (c.role !== 'edit') return 'view';
  return c.full ? 'delete-only' : 'edit';
}

export const mayEdit = (c: Capable): boolean => capability(c) === 'edit';
/** Deleting stays available on a full board. */
export const mayDelete = (c: Capable): boolean => c.role === 'edit';
