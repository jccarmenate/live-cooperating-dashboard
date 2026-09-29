import type { Point, Rect } from '../schema/types';
import { type Identity, isIdentity } from './identity';

/** A user's selection on a sheet page: [rowId, colId] corners, and whether they are editing. */
export interface SheetPresence {
  anchor: [string, string];
  focus: [string, string];
  editing: boolean;
}

export interface PresenceState {
  user: Identity;
  /** World coordinates, or null when the pointer is off the canvas. */
  cursor: Point | null;
  selection: string[];
  /** Id of the shape whose text this user is editing. */
  editing: string | null;
  /** World rectangle this user is looking at (minimap), or null before the canvas is measured. */
  viewport: Rect | null;
  /** Page this user is looking at; null = unknown (treated as main). */
  page: string | null;
  /** Selection on a sheet page (only sheet pages publish it). */
  sheet?: SheetPresence | null;
  /** Event open in the editor on a calendar page. */
  calEvent?: string | null;
}

export interface Peer extends PresenceState {
  clientId: number;
}

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as Point).x) &&
  Number.isFinite((v as Point).y);

/** Peers' viewports are untrusted: finite, positive and at most this many world units per side. */
export const MAX_VIEWPORT_SIDE = 1e6;
/** Peers' viewports are untrusted: the origin is bounded to this many world units per axis. */
export const MAX_VIEWPORT_COORD = 1e9;

const isViewport = (v: unknown): v is Rect => {
  if (!isPoint(v)) return false;
  const { x, y, w, h } = v as Rect;
  return (
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0 &&
    w <= MAX_VIEWPORT_SIDE &&
    h <= MAX_VIEWPORT_SIDE &&
    Math.abs(x) <= MAX_VIEWPORT_COORD &&
    Math.abs(y) <= MAX_VIEWPORT_COORD
  );
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isCellPair = (v: unknown): v is [string, string] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 16);

const readSheetPresence = (v: unknown): SheetPresence | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isCellPair(o.anchor) || !isCellPair(o.focus) || typeof o.editing !== 'boolean') return null;
  return {
    anchor: [o.anchor[0], o.anchor[1]],
    focus: [o.focus[0], o.focus[1]],
    editing: o.editing,
  };
};

/** Validates an untrusted awareness state. */
export function parsePresence(raw: unknown): PresenceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isIdentity(o.user)) return null;
  // user.color is rendered verbatim in inline `style.background` and
  // user.id is untrusted network input; without these bounds a peer could
  // smuggle a `url(...)` background (leaking every viewer's IP) or an
  // unbounded id.
  if (!HEX_COLOR.test(o.user.color) || o.user.id.length > 64) return null;
  const state: PresenceState = {
    user: { id: o.user.id, name: o.user.name.slice(0, 40), color: o.user.color },
    cursor: isPoint(o.cursor) ? { x: o.cursor.x, y: o.cursor.y } : null,
    selection: Array.isArray(o.selection)
      ? o.selection.filter((s): s is string => typeof s === 'string')
      : [],
    editing: typeof o.editing === 'string' ? o.editing : null,
    viewport: isViewport(o.viewport)
      ? { x: o.viewport.x, y: o.viewport.y, w: o.viewport.w, h: o.viewport.h }
      : null,
    page: typeof o.page === 'string' && o.page.length > 0 && o.page.length <= 64 ? o.page : null,
  };
  const sheet = readSheetPresence(o.sheet);
  if (sheet) state.sheet = sheet;
  if (typeof o.calEvent === 'string' && o.calEvent.length > 0 && o.calEvent.length <= 64)
    state.calEvent = o.calEvent;
  return state;
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
