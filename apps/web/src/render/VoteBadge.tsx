import { PALETTE, type Shape } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { cachedTallies, useVoteOpen } from './voting';

/** `● n` on a sticky: its own hit target, so voting never selects or drags the sticky. */
export function VoteBadge({ s, session }: { s: Shape; session: BoardSession }) {
  const vote = useStore(session.activity, (a) => a.vote);
  const keys = useStore(session.activity, (a) => a.voteKeys);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const role = useStore(session.conn.clock, (c) => c.role);
  const open = useVoteOpen(session);
  if (!vote) return null;
  const t = cachedTallies(keys, shapes, vote.maxPerUser);
  const count = t.counts[s.id] ?? 0;
  if (!open && count === 0) return null;
  const mine = t.byUser[session.user.id]?.includes(s.id) ?? false;
  const clickable = open && role === 'edit';
  return (
    <g
      data-testid="vote-badge"
      data-vote-id={s.id}
      data-mine={mine}
      transform={`translate(${s.x + s.w - 44} ${s.y + s.h - 28})`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onPointerDown={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        e.preventDefault();
        session.controller.toggleVote(s.id);
      }}
    >
      <rect
        width={36}
        height={20}
        fill={mine ? PALETTE.cobalt : PALETTE.white}
        stroke={PALETTE.ink}
        strokeWidth={2}
      />
      <text
        x={18}
        y={14}
        textAnchor="middle"
        className="font-mono"
        fontSize={11}
        fontWeight={700}
        fill={mine ? PALETTE.white : PALETTE.ink}
      >
        {`● ${count}`}
      </text>
    </g>
  );
}
