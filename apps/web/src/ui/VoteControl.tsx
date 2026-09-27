import { isVoteOpen, VOTE_DURATIONS_MIN } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { cachedTallies, useServerNow } from '../render/voting';

const pill = 'border-2 border-ink px-2 py-0.5 font-mono text-[11px] font-bold uppercase';

export function VoteControl({ session }: { session: BoardSession }) {
  const { controller } = session;
  const vote = useStore(session.activity, (a) => a.vote);
  const keys = useStore(session.activity, (a) => a.voteKeys);
  // Room-wide: the cap and "N left" count stickies on every visible page.
  const shapes = useStore(session.doc, (d) => d.allShapes);
  const role = useStore(session.conn.clock, (c) => c.role);
  const [picking, setPicking] = useState(false);
  // Tick only while actually open: a vote that expires unended keeps `open: true` in the doc.
  // The tick that crosses the deadline renders VOTE ENDED and stops the interval.
  const now = useServerNow(session, isVoteOpen(vote, session.conn.serverNow()));
  const canEdit = role === 'edit';

  if (vote && isVoteOpen(vote, now)) {
    const mine = cachedTallies(keys, shapes, vote.maxPerUser).byUser[session.user.id]?.length ?? 0;
    // Clamped so a hostile far-future `endsAt` can't print a huge minute count.
    const left = Math.min(Math.max(0, vote.endsAt - now), 99 * 60_000);
    const mm = Math.floor(left / 60_000);
    const ss = String(Math.floor(left / 1000) % 60).padStart(2, '0');
    // Viewers can't vote, so they get no "N left".
    const remaining = canEdit ? ` · ${Math.max(0, vote.maxPerUser - mine)} left` : '';
    return (
      <div className="flex items-center gap-1.5">
        <span data-testid="vote-status" className={`${pill} bg-sun`}>
          {`VOTE OPEN · ${mm}:${ss}${remaining}`}
        </span>
        {canEdit && (
          <button
            type="button"
            data-testid="vote-end"
            className={`${pill} bg-white hover:bg-paper`}
            onClick={() => controller.endVote()}
          >
            End
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1.5">
      {vote && (
        <span data-testid="vote-status" className={`${pill} bg-paper`}>
          VOTE ENDED
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          data-testid="vote-start"
          aria-expanded={picking}
          className={`${pill} bg-white hover:bg-sun`}
          onClick={() => setPicking((p) => !p)}
        >
          Vote
        </button>
      )}
      {picking && canEdit && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 flex gap-1 border-2 border-ink bg-white p-1 shadow-hard"
        >
          {VOTE_DURATIONS_MIN.map((min) => (
            <button
              key={min}
              type="button"
              role="menuitem"
              data-testid={`vote-${min}m`}
              className={`${pill} hover:bg-sun`}
              onClick={() => {
                controller.startVote(min);
                setPicking(false);
              }}
            >
              {`${min} min`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
