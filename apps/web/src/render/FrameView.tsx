import {
  COLUMN_HEADER_H,
  columnCounts,
  FRAME_TITLE_H,
  frameColumns,
  PALETTE,
  type Shape,
} from '@relay/core';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { BoardSession } from '../board/session';
import { TEXT_BOX, textStyle } from './typography';

export function FrameBody({
  s,
  editing,
  session,
}: {
  s: Shape;
  editing: boolean;
  session: BoardSession;
}) {
  const counts = useStore(
    session.doc,
    useShallow((d) => columnCounts(d.shapes, s.id)),
  );
  const columns = frameColumns(s);
  const { className, fontSize } = textStyle(s);
  return (
    <>
      <rect
        x={s.x + 4}
        y={s.y + 4}
        width={s.w}
        height={s.h}
        fill={PALETTE.ink}
        pointerEvents="none"
      />
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        fill={s.style.fill}
        stroke={s.style.stroke}
        strokeWidth={3}
        pointerEvents="none"
      />
      {/* The title band is the frame's handle; the body lets clicks through to the canvas. */}
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={FRAME_TITLE_H}
        fill={s.style.fill}
        stroke={s.style.stroke}
        strokeWidth={3}
      />
      <foreignObject x={s.x} y={s.y} width={s.w} height={FRAME_TITLE_H} pointerEvents="none">
        <p
          className={`truncate ${TEXT_BOX.frame} ${className} ${editing ? 'invisible' : ''}`}
          style={{ fontSize }}
        >
          {s.text || 'Frame'}
        </p>
      </foreignObject>
      {columns.map((c, i) => (
        <g key={c.id}>
          {i > 0 && (
            <line
              x1={c.x}
              y1={c.y}
              x2={c.x}
              y2={c.y + c.h}
              stroke={PALETTE.ink}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          )}
          <foreignObject data-column-id={c.id} x={c.x} y={c.y} width={c.w} height={COLUMN_HEADER_H}>
            <p className="truncate border-b-2 border-ink/80 px-3 pt-1.5 font-mono text-[11px] font-bold uppercase tracking-wider">
              {`${c.title} · ${counts[c.id] ?? 0}`}
            </p>
          </foreignObject>
        </g>
      ))}
    </>
  );
}
