import { isVoteOpen, type Shape, type Tallies, voteTallies } from '@relay/core';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

let last: { keys: string[]; shapes: Record<string, Shape>; max: number; result: Tallies } | null =
  null;

/**
 * Tallies for the current stores. The stores replace `voteKeys`/`shapes` only on change,
 * so one cached result serves every badge rendered for the same state.
 */
export function cachedTallies(keys: string[], shapes: Record<string, Shape>, max: number): Tallies {
  if (last && last.keys === keys && last.shapes === shapes && last.max === max) return last.result;
  const result = voteTallies(keys, shapes, max);
  last = { keys, shapes, max, result };
  return result;
}

/** True while the vote is open; re-renders exactly when the deadline passes (server time). */
export function useVoteOpen(session: BoardSession): boolean {
  const vote = useStore(session.activity, (a) => a.vote);
  const [, expire] = useState(0);
  const open = isVoteOpen(vote, session.conn.serverNow());
  useEffect(() => {
    if (!open || !vote) return;
    const t = setTimeout(() => expire((n) => n + 1), vote.endsAt - session.conn.serverNow() + 50);
    return () => clearTimeout(t);
  }, [open, vote, session]);
  return open;
}

/** Server time, re-read every 250 ms while `active` (for the header countdown). */
export function useServerNow(session: BoardSession, active: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
  return session.conn.serverNow();
}
