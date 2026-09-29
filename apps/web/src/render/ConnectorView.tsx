import {
  arrowGeometry,
  connectorPath,
  isAttached,
  PALETTE,
  type Point,
  pathMidpoint,
} from '@relay/core';
import { memo } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { useShape } from './useShape';

const toPoints = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

export const ConnectorView = memo(function ConnectorView({
  id,
  session,
}: {
  id: string;
  session: BoardSession;
}) {
  const connector = useStore(session.doc, (s) => s.connectors[id]);
  const fromId = connector && isAttached(connector.from) ? connector.from.shapeId : null;
  const toId = connector && isAttached(connector.to) ? connector.to.shapeId : null;
  // Overlay-aware endpoints: connectors follow local drags and resizes every frame.
  const fromShape = useShape(session, fromId);
  const toShape = useShape(session, toId);
  const selected = useStore(session.controller.ui, (s) => s.tool.selection.includes(id));
  const editing = useStore(session.controller.ui, (s) => s.editingConnector === id);
  if (!connector) return null;

  const lookup = {
    ...(fromId && fromShape ? { [fromId]: fromShape } : {}),
    ...(toId && toShape ? { [toId]: toShape } : {}),
  };
  const path = connectorPath(connector, lookup);
  if (!path || path.length < 2) return null;
  const color = selected ? PALETTE.cobalt : PALETTE.ink;
  const { stroke, head } =
    connector.head === 'arrow' ? arrowGeometry(path) : { stroke: path, head: null };

  return (
    <g data-connector-id={id} className="cursor-pointer">
      <polyline
        points={toPoints(stroke)}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {head && <polygon points={toPoints(head)} fill={color} />}
      {/* A wide invisible stroke so a thin connector is easy to click. */}
      <polyline
        points={toPoints(path)}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        pointerEvents="stroke"
      />
      {connector.label &&
        !editing &&
        (() => {
          const mid = pathMidpoint(path);
          const w = connector.label.length * 6.6 + 12;
          return (
            <g data-testid="connector-label" pointerEvents="none">
              <rect
                x={mid.x - w / 2}
                y={mid.y - 10}
                width={w}
                height={20}
                fill={PALETTE.white}
                stroke={color}
                strokeWidth={1.5}
              />
              <text
                x={mid.x}
                y={mid.y + 4}
                textAnchor="middle"
                fontSize={11}
                className="font-mono"
                fill={PALETTE.ink}
              >
                {connector.label}
              </text>
            </g>
          );
        })()}
    </g>
  );
});
