import type { ConnStatus } from '../sync/connection';

export interface StatusNotice {
  title: string;
  body: string;
  /** Back home, connect again, or drop the local copy and reload. */
  action: 'home' | 'retry' | 'reload';
}

const STOPPED: Partial<Record<ConnStatus, StatusNotice>> = {
  unauthorized: {
    title: 'This link is invalid',
    body: 'Ask the board owner for a new share link.',
    action: 'home',
  },
  crowded: {
    title: 'This board has too many people right now',
    body: 'Try again in a moment.',
    action: 'retry',
  },
  throttled: {
    title: 'Too many changes at once',
    body: 'The connection was paused.',
    action: 'retry',
  },
  'too-large': {
    title: "Some changes couldn't be saved",
    body: 'A change was too large to sync.',
    action: 'reload',
  },
};

const UNSAVED: StatusNotice = {
  title: "Some changes couldn't be saved",
  body: 'The board was full when you made them.',
  action: 'reload',
};

/** The blocking notice for a connection state, or null when the board is usable. */
export function statusNotice(status: ConnStatus, unsaved: boolean): StatusNotice | null {
  return STOPPED[status] ?? (unsaved ? UNSAVED : null);
}
