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
import { onPage } from './pageFilter';

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
  const page = useStore(session.doc, (d) => d.activePage);
  const peers = useStore(session.presence, (s) => s.peers).filter((p) => onPage(p, page));
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
      {peers.map((peer) => {
        const s = peer.editing ? shapes[peer.editing] : undefined;
        if (!s) return null;
        const b = shapeBounds(s);
        const label = `${peer.user.name} · typing…`;
        return (
          <g key={`typing:${peer.clientId}`} data-testid="typing-indicator">
            <rect
              {...outline(b)}
              fill="none"
              stroke={peer.user.color}
              strokeWidth={stroke * 1.5}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            />
            {/* Screen-sized tag above the shape, like the W × H label. */}
            <g transform={`translate(${b.x - PAD} ${b.y - PAD - 22 / zoom}) scale(${1 / zoom})`}>
              <rect
                width={label.length * 6.2 + 12}
                height={18}
                fill={peer.user.color}
                stroke={PALETTE.ink}
                strokeWidth={1.5}
              />
              <text
                x={6}
                y={13}
                fill={PALETTE.white}
                className="font-mono"
                fontSize={10}
                fontWeight={700}
              >
                {label}
              </text>
            </g>
          </g>
        );
      })}
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
        !single.locked &&
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
