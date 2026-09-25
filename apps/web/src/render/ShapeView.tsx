import { initials, PALETTE, type Shape } from '@relay/core';
import { memo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const timeOf = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Shadow({ s }: { s: Shape }) {
  return <rect x={s.x + 4} y={s.y + 4} width={s.w} height={s.h} fill={PALETTE.ink} />;
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
            <div className="flex h-full flex-col justify-between p-3">
              <p
                className={`whitespace-pre-wrap break-words text-[14px] font-semibold leading-snug ${hidden}`}
              >
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
          <p
            className={`whitespace-pre-wrap break-words font-display text-[28px] uppercase leading-tight ${hidden}`}
          >
            {s.text || (editing ? '' : 'Text')}
          </p>
        </foreignObject>
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
          <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
            <div className="grid h-full place-items-center p-2 text-center">
              <p
                className={`whitespace-pre-wrap break-words text-[13px] font-bold uppercase ${hidden}`}
              >
                {s.text}
              </p>
            </div>
          </foreignObject>
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
