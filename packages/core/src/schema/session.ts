import * as Y from 'yjs';
import { MAX_AUTHOR_NAME, MAX_COMMENT_BODY, MAX_THREAD_ENTRIES } from './defaults';
import type { CommentAnchor, CommentEntry, CommentThread, Point, Shape, VoteState } from './types';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Key of one user's vote on one sticky in the flat `votes` map (flat: concurrent creation). */
export const voteKey = (shapeId: string, userId: string): string => `${shapeId}:${userId}`;

export function readVote(session: Y.Map<unknown>): VoteState | null {
  const v = session.get('vote');
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.open !== 'boolean' || !finite(o.endsAt) || !finite(o.maxPerUser)) return null;
  if (typeof o.startedBy !== 'string') return null;
  const maxPerUser = Math.max(0, Math.min(99, Math.floor(o.maxPerUser)));
  return { open: o.open, endsAt: o.endsAt, maxPerUser, startedBy: o.startedBy };
}

export const isVoteOpen = (vote: VoteState | null, serverNow: number): boolean =>
  vote?.open === true && serverNow < vote.endsAt;

export interface Tallies {
  counts: Record<string, number>;
  byUser: Record<string, string[]>;
}

/**
 * Derived vote totals. Only votes on existing stickies count, and each user's votes are
 * capped at `maxPerUser` taking their keys in sorted order, so two tabs of one user
 * racing past the cap converge to the same tallies everywhere.
 */
export function voteTallies(
  keys: Iterable<string>,
  shapes: Readonly<Record<string, Shape>>,
  maxPerUser: number,
): Tallies {
  const perUser = new Map<string, string[]>();
  for (const key of keys) {
    const i = key.lastIndexOf(':');
    if (i <= 0 || i === key.length - 1) continue;
    const shapeId = key.slice(0, i);
    const userId = key.slice(i + 1);
    if (!Object.hasOwn(shapes, shapeId) || shapes[shapeId]?.type !== 'sticky') continue;
    const list = perUser.get(userId) ?? [];
    list.push(shapeId);
    perUser.set(userId, list);
  }
  const counts: Record<string, number> = {};
  const byUser: Record<string, string[]> = {};
  for (const [userId, ids] of perUser) {
    const kept = ids.sort().slice(0, maxPerUser);
    byUser[userId] = kept;
    for (const id of kept) counts[id] = (counts[id] ?? 0) + 1;
  }
  return { counts, byUser };
}

function readAnchor(v: unknown): CommentAnchor | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.shapeId === 'string' && finite(o.dx) && finite(o.dy)) {
    return { shapeId: o.shapeId, dx: o.dx, dy: o.dy };
  }
  if (finite(o.x) && finite(o.y)) return { x: o.x, y: o.y };
  return null;
}

function readEntry(v: unknown): CommentEntry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.authorId !== 'string') return null;
  if (typeof o.author !== 'string' || typeof o.body !== 'string' || !finite(o.ts)) return null;
  return {
    id: o.id,
    authorId: o.authorId,
    author: o.author.slice(0, MAX_AUTHOR_NAME),
    body: o.body.slice(0, MAX_COMMENT_BODY),
    ts: o.ts,
  };
}

/** A validated, limit-enforced thread, or null without a valid anchor or any valid entry. */
export function readComment(id: string, m: Y.Map<unknown>): CommentThread | null {
  const anchor = readAnchor(m.get('anchor'));
  const thread = m.get('thread');
  if (!anchor || !(thread instanceof Y.Array)) return null;
  const entries: CommentEntry[] = [];
  for (const raw of thread.toArray()) {
    if (entries.length >= MAX_THREAD_ENTRIES) break;
    const e = readEntry(raw);
    if (e) entries.push(e);
  }
  if (entries.length === 0) return null;
  const createdBy = m.get('createdBy');
  const createdAt = m.get('createdAt');
  return {
    id,
    anchor,
    resolved: m.get('resolved') === true,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: finite(createdAt) ? createdAt : 0,
    entries,
  };
}

/** Where a thread's pin sits in world coordinates; null when its shape is gone. */
export function commentPoint(
  anchor: CommentAnchor,
  shapes: Readonly<Record<string, Pick<Shape, 'x' | 'y'>>>,
): Point | null {
  if ('shapeId' in anchor) {
    const s = Object.hasOwn(shapes, anchor.shapeId) ? shapes[anchor.shapeId] : undefined;
    return s ? { x: s.x + anchor.dx, y: s.y + anchor.dy } : null;
  }
  return { x: anchor.x, y: anchor.y };
}
