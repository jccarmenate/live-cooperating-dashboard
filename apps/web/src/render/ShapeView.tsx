import { initials, PALETTE, type Shape, shapeBounds } from '@relay/core';
import { Lock } from 'lucide-react';
import { memo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { FrameBody } from './FrameView';
import { CODE_HEADER, TEXT_BOX, textStyle } from './typography';
import { useShape } from './useShape';
import { VoteBadge } from './VoteBadge';

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Shadow({ s }: { s: Shape }) {
  return <rect x={s.x + 4} y={s.y + 4} width={s.w} height={s.h} fill={PALETTE.ink} />;
}

function CenteredLabel({ s, editing }: { s: Shape; editing: boolean }) {
  const { className, fontSize } = textStyle(s);
  return (
    <foreignObject x={s.x} y={s.y} width={s.w} height={s.h} pointerEvents="none">
      <div className={`grid h-full place-items-center ${TEXT_BOX[s.type]}`}>
        <p
          className={`whitespace-pre-wrap break-words ${className} ${editing ? 'invisible' : ''}`}
          style={{ fontSize }}
        >
          {s.text}
        </p>
      </div>
    </foreignObject>
  );
}

function Body({ s, editing, session }: { s: Shape; editing: boolean; session: BoardSession }) {
  const hidden = editing ? 'invisible' : '';
  const { className, fontSize } = textStyle(s);
  switch (s.type) {
    case 'frame':
      return <FrameBody s={s} editing={editing} session={session} />;
    case 'sticky':
      return (
        <>
          <Shadow s={s} />
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={2}
          />
          <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
            <div className={`flex h-full flex-col justify-between ${TEXT_BOX.sticky}`}>
              <p
                className={`whitespace-pre-wrap break-words ${className} ${hidden}`}
                style={{ fontSize }}
              >
                {s.text}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-wider opacity-70">
                {initials(s.authorName)} · {timeOf(s.createdAt)}
              </p>
            </div>
          </foreignObject>
          <VoteBadge s={s} session={session} />
        </>
      );
    case 'text':
      return (
        <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
          <p
            className={`whitespace-pre-wrap break-words ${className} ${hidden}`}
            style={{ fontSize }}
          >
            {s.text || (editing ? '' : 'Text')}
          </p>
        </foreignObject>
      );
    case 'ellipse': {
      const rx = s.w / 2;
      const ry = s.h / 2;
      const cx = s.x + rx;
      const cy = s.y + ry;
      return (
        <>
          <ellipse cx={cx + 4} cy={cy + 4} rx={rx} ry={ry} fill={PALETTE.ink} />
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={3}
          />
          <CenteredLabel s={s} editing={editing} />
        </>
      );
    }
    case 'line':
      return (
        <>
          <line
            x1={s.x}
            y1={s.y}
            x2={s.x + s.w}
            y2={s.y + s.h}
            stroke={s.style.stroke}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {/* A wide invisible stroke so a 3px line is easy to grab. */}
          <line
            x1={s.x}
            y1={s.y}
            x2={s.x + s.w}
            y2={s.y + s.h}
            stroke="transparent"
            strokeWidth={14}
            pointerEvents="stroke"
          />
        </>
      );
    case 'code':
      return (
        <>
          <Shadow s={s} />
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={3}
          />
          <rect x={s.x} y={s.y} width={s.w} height={CODE_HEADER} fill={PALETTE.ink} />
          <text
            x={s.x + 10}
            y={s.y + 15}
            fill={PALETTE.paper}
            fontSize={11}
            className="font-mono"
            tabIndex={-1}
            aria-hidden="true"
          >
            {'{ }'}
          </text>
          <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
            <pre
              className={`h-full overflow-hidden whitespace-pre-wrap break-words ${TEXT_BOX.code} ${className} ${hidden}`}
              style={{ fontSize }}
            >
              {s.text}
            </pre>
          </foreignObject>
        </>
      );
    default:
      return (
        <>
          <Shadow s={s} />
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            fill={s.style.fill}
            stroke={s.style.stroke}
            strokeWidth={3}
          />
          <CenteredLabel s={s} editing={editing} />
        </>
      );
  }
}

/** A small ink tag on the top-right corner of a locked shape. */
function LockBadge({ s }: { s: Shape }) {
  const b = shapeBounds(s);
  return (
    <g
      data-testid="lock-badge"
      transform={`translate(${b.x + b.w - 10} ${b.y - 10})`}
      pointerEvents="none"
    >
      <rect width={20} height={20} fill={PALETTE.ink} />
      <Lock x={4} y={4} size={12} color={PALETTE.paper} strokeWidth={2.5} />
    </g>
  );
}

export const ShapeView = memo(function ShapeView({
  id,
  session,
}: {
  id: string;
  session: BoardSession;
}) {
  const shape = useShape(session, id);
  const editing = useStore(session.controller.ui, (s) => s.editingId === id);
  if (!shape) return null;
  return (
    <g data-shape-id={id} className={shape.locked ? 'cursor-default' : 'cursor-move'}>
      <Body s={shape} editing={editing} session={session} />
      {shape.locked && <LockBadge s={shape} />}
    </g>
  );
});
