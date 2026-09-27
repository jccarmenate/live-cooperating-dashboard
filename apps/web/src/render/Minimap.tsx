import {
  contentBounds,
  fromMinimap,
  type MinimapProjection,
  minimapProjection,
  PALETTE,
  type Point,
  type Rect,
  rectToMinimap,
  shapeBounds,
  viewportRect,
} from '@relay/core';
import { type PointerEvent, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from './pageFilter';

const W = 200;
const H = 140;

export function Minimap({ session }: { session: BoardSession }) {
  const { controller } = session;
  const shapes = useStore(session.doc, (s) => s.shapes);
  const order = useStore(session.doc, (s) => s.order);
  const camera = useStore(controller.ui, (s) => s.camera);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const peers = useStore(session.presence, (s) => s.peers);
  const page = useStore(session.doc, (d) => d.activePage);
  // Frozen while dragging: re-projecting as the viewport moves would slide the map under the pointer.
  const drag = useRef<MinimapProjection | null>(null);
  if (!viewport) return null;

  const view = viewportRect(camera, viewport.w, viewport.h);
  const projection = drag.current ?? minimapProjection(contentBounds(shapes), view, W, H);
  const box = (r: Rect) => {
    const m = rectToMinimap(projection, r);
    return { x: m.x, y: m.y, width: m.w, height: m.h };
  };
  const local = (e: PointerEvent<SVGSVGElement>): Point => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  return (
    <svg
      data-testid="minimap"
      aria-label="Minimap"
      width={W}
      height={H}
      className="absolute right-4 bottom-4 touch-none border-2 border-ink bg-white shadow-hard"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = projection;
        controller.centerOn(fromMinimap(projection, local(e)));
      }}
      onPointerMove={(e) => {
        if (drag.current) controller.centerOn(fromMinimap(drag.current, local(e)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      {order.map((id) => {
        const s = shapes[id];
        if (!s) return null;
        const frame = s.type === 'frame';
        return (
          <rect
            key={id}
            {...box(shapeBounds(s))}
            fill={frame ? 'none' : '#11111133'}
            stroke={frame ? PALETTE.ink : 'none'}
            strokeWidth={1}
          />
        );
      })}
      {peers
        .filter((p) => onPage(p, page))
        .map((peer) =>
          peer.viewport ? (
            <rect
              key={peer.clientId}
              data-testid="minimap-peer"
              {...box(peer.viewport)}
              fill="none"
              stroke={peer.user.color}
              strokeWidth={1.5}
            />
          ) : null,
        )}
      <rect
        data-testid="minimap-viewport"
        {...box(view)}
        fill={`${PALETTE.cobalt}14`}
        stroke={PALETTE.cobalt}
        strokeWidth={2}
      />
    </svg>
  );
}
