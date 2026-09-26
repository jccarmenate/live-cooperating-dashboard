import {
  type Handle,
  handlePoint,
  handlesFor,
  PALETTE,
  type Rect,
  type Shape,
  shapeBounds,
} from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const PAD = 4;
const HANDLE_PX = 9;

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  start: 'crosshair',
  end: 'crosshair',
};

const outline = (b: Rect) => ({
  x: b.x - PAD,
  y: b.y - PAD,
  width: b.w + PAD * 2,
  height: b.h + PAD * 2,
});

export function SelectionLayer({ session }: { session: BoardSession }) {
  const ui = session.controller.ui;
  const selection = useStore(ui, (s) => s.tool.selection);
  const zoom = useStore(ui, (s) => s.camera.zoom);
  const overlay = useStore(ui, (s) => s.overlay);
  const shapes = useStore(session.doc, (s) => s.shapes);
  const peers = useStore(session.presence, (s) => s.peers);
  const stroke = 2 / zoom;
  const handleSize = HANDLE_PX / zoom;

  const current = (id: string): Shape | undefined => {
    const s = shapes[id];
    const o = overlay?.[id];
    return s && o ? { ...s, ...o } : s;
  };
  const single = selection.length === 1 ? current(selection[0] ?? '') : undefined;
  const singleBounds = single ? shapeBounds(single) : undefined;

  return (
    <g pointerEvents="none">
      {peers.flatMap((peer) =>
        peer.selection.map((id) => {
          const s = shapes[id];
          if (!s) return null;
          return (
            <rect
              key={`${peer.clientId}:${id}`}
              {...outline(shapeBounds(s))}
              fill="none"
              stroke={peer.user.color}
              strokeWidth={stroke}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            />
          );
        }),
      )}
      {selection.map((id) => {
        const s = current(id);
        if (!s) return null;
        return (
          <rect
            key={id}
            data-testid="selection-outline"
            {...outline(shapeBounds(s))}
            fill="none"
            stroke={PALETTE.cobalt}
            strokeWidth={stroke}
          />
        );
      })}
      {single && singleBounds && (
        <g
          transform={`translate(${singleBounds.x + singleBounds.w / 2} ${singleBounds.y + singleBounds.h + PAD + 8 / zoom}) scale(${1 / zoom})`}
        >
          <rect x={-36} y={0} width={72} height={18} fill={PALETTE.cobalt} />
          <text
            x={0}
            y={13}
            textAnchor="middle"
            fill={PALETTE.white}
            className="font-mono"
            fontSize={10}
          >
            {`${Math.round(singleBounds.w)} × ${Math.round(singleBounds.h)}`}
          </text>
        </g>
      )}
      {single &&
        handlesFor(single.type).map((h) => {
          const pt = handlePoint(single, h);
          return (
            <rect
              key={h}
              data-handle={h}
              x={pt.x - handleSize / 2}
              y={pt.y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              fill={PALETTE.white}
              stroke={PALETTE.cobalt}
              strokeWidth={stroke}
              pointerEvents="all"
              style={{ cursor: CURSOR[h] }}
            />
          );
        })}
    </g>
  );
}
