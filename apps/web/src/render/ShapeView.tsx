import { initials, PALETTE, type Shape } from '@relay/core';
import { memo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { CODE_HEADER, TEXT_BOX, TEXT_STYLE } from './typography';

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Shadow({ s }: { s: Shape }) {
  return <rect x={s.x + 4} y={s.y + 4} width={s.w} height={s.h} fill={PALETTE.ink} />;
}

function CenteredLabel({ s, editing }: { s: Shape; editing: boolean }) {
  return (
    <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
      <div className={`grid h-full place-items-center ${TEXT_BOX[s.type]}`}>
        <p
          className={`whitespace-pre-wrap break-words ${TEXT_STYLE[s.type]} ${editing ? 'invisible' : ''}`}
        >
          {s.text}
        </p>
      </div>
    </foreignObject>
  );
}

function Body({ s, editing }: { s: Shape; editing: boolean }) {
  const hidden = editing ? 'invisible' : '';
  switch (s.type) {
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
              <p className={`whitespace-pre-wrap break-words ${TEXT_STYLE.sticky} ${hidden}`}>
                {s.text}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-wider opacity-70">
                {initials(s.authorName)} · {timeOf(s.createdAt)}
              </p>
            </div>
          </foreignObject>
        </>
      );
    case 'text':
      return (
        <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
          <p className={`whitespace-pre-wrap break-words ${TEXT_STYLE.text} ${hidden}`}>
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
          <text x={s.x + 10} y={s.y + 15} fill={PALETTE.paper} fontSize={11} className="font-mono">
            {'{ }'}
          </text>
          <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
            <pre
              className={`h-full overflow-hidden whitespace-pre-wrap break-words ${TEXT_BOX.code} ${TEXT_STYLE.code} ${hidden}`}
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

export const ShapeView = memo(function ShapeView({
  id,
  session,
}: {
  id: string;
  session: BoardSession;
}) {
  const shape = useStore(session.doc, (s) => s.shapes[id]);
  const editing = useStore(session.controller.ui, (s) => s.editingId === id);
  if (!shape) return null;
  return (
    <g data-shape-id={id} className="cursor-move">
      <Body s={shape} editing={editing} />
    </g>
  );
});
