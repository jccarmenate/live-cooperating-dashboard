import { PALETTE, type Shape } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { cachedTallies, useVoteOpen } from './voting';

/** `● n` on a sticky: its own hit target, so voting never selects or drags the sticky. */
export function VoteBadge({ s, session }: { s: Shape; session: BoardSession }) {
  const vote = useStore(session.activity, (a) => a.vote);
  const keys = useStore(session.activity, (a) => a.voteKeys);
  // Primitive selectors over the doc store: a shape edit re-renders the badge only when it
  // changes this sticky's count or mine flag, not on every edit.
  const count = useStore(session.doc, (d) =>
    vote ? (cachedTallies(keys, d.shapes, vote.maxPerUser).counts[s.id] ?? 0) : 0,
  );
  const mine = useStore(session.doc, (d) =>
    vote
      ? (cachedTallies(keys, d.shapes, vote.maxPerUser).byUser[session.user.id]?.includes(s.id) ??
        false)
      : false,
  );
  const role = useStore(session.conn.clock, (c) => c.role);
  const open = useVoteOpen(session);
  if (!vote) return null;
  if (!open && count === 0) return null;
  const clickable = open && role === 'edit';
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onDoubleClick only shields the canvas; it adds no interaction
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
      // Two quick votes fire a dblclick that would otherwise reach the canvas, whose hit-test
      // finds the sticky underneath and opens its text editor.
      onDoubleClick={(e) => {
        if (clickable) e.stopPropagation();
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
