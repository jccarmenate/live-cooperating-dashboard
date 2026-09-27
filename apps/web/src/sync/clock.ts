import type { Role, ServerMessage } from '@relay/core';

export interface ClockState {
  /** Capability from the server's hello; null until the first hello arrives. */
  role: Role | null;
  /** serverNow = Date.now() + offset. Error is at most the one-way latency. */
  offset: number;
}

/** How often the client asks for the server time while online. */
export const TIME_REFRESH_MS = 300_000;

export function nextClock(prev: ClockState, msg: ServerMessage, localNow: number): ClockState {
  const offset = msg.now - localNow;
  return msg.type === 'hello' ? { role: msg.role, offset } : { role: prev.role, offset };
}
