import type { Point } from '../schema/types';
import { type Identity, isIdentity } from './identity';

export interface PresenceState {
  user: Identity;
  /** World coordinates, or null when the pointer is off the canvas. */
  cursor: Point | null;
  selection: string[];
  /** Id of the shape whose text this user is editing. */
  editing: string | null;
}

export interface Peer extends PresenceState {
  clientId: number;
}

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as Point).x) &&
  Number.isFinite((v as Point).y);

/** Validates an untrusted awareness state. */
export function parsePresence(raw: unknown): PresenceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isIdentity(o.user)) return null;
  return {
    user: { id: o.user.id, name: o.user.name.slice(0, 40), color: o.user.color },
    cursor: isPoint(o.cursor) ? { x: o.cursor.x, y: o.cursor.y } : null,
    selection: Array.isArray(o.selection)
      ? o.selection.filter((s): s is string => typeof s === 'string')
      : [],
    editing: typeof o.editing === 'string' ? o.editing : null,
  };
}

export function peersFrom(states: Map<number, unknown>, selfClientId: number): Peer[] {
  const peers: Peer[] = [];
  for (const [clientId, raw] of states) {
    if (clientId === selfClientId) continue;
    const state = parsePresence(raw);
    if (state) peers.push({ clientId, ...state });
  }
  return peers.sort((a, b) => a.clientId - b.clientId);
}

/** Unique users currently present (a user may have several tabs), self first. */
export function onlineUsers(peers: readonly Peer[], self: Identity): Identity[] {
  const seen = new Set<string>([self.id]);
  const users: Identity[] = [self];
  for (const p of peers) {
    if (seen.has(p.user.id)) continue;
    seen.add(p.user.id);
    users.push(p.user);
  }
  return users;
}
