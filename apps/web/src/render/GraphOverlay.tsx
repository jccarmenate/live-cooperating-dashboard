import {
  connectorPath,
  isAttached,
  PALETTE,
  type Point,
  PRESENCE_COLORS,
  shapeBounds,
} from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

// Component rings: the palette colours that read on paper (paper and white do not), then the
// presence colours, so the first 8 components never share a colour.
const GROUP_COLORS: string[] = [
  ...new Set<string>([PALETTE.cobalt, PALETTE.flame, PALETTE.sun, PALETTE.ink, ...PRESENCE_COLORS]),
];
const toPoints = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * The last algorithm's result: highlighted nodes and edges, visit numbers, component colours.
 * Local only. Stroke widths and badges are divided by the zoom, so they keep their screen size.
 */
export function GraphOverlay({ session }: { session: BoardSession }) {
  const result = useStore(session.controller.ui, (s) => s.graphResult);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const zoom = useStore(session.controller.ui, (s) => s.camera.zoom);
  if (!result || result.kind === 'error') return null;

  const ring = (id: string, color: string, key: string) => {
    const s = shapes[id];
    if (!s) return null;
    const b = shapeBounds(s);
    return (
      <rect
        key={key}
        data-testid="graph-highlight-node"
        x={b.x - 6}
        y={b.y - 6}
        width={b.w + 12}
        height={b.h + 12}
        fill="none"
        stroke={color}
        strokeWidth={3 / zoom}
        rx={6}
      />
    );
  };
  const edge = (id: string) => {
    const c = connectors[id];
    if (!c) return null;
    const lookup = {
      ...(isAttached(c.from) && shapes[c.from.shapeId]
        ? { [c.from.shapeId]: shapes[c.from.shapeId] }
        : {}),
      ...(isAttached(c.to) && shapes[c.to.shapeId] ? { [c.to.shapeId]: shapes[c.to.shapeId] } : {}),
    };
    const path = connectorPath(c, lookup);
    if (!path) return null;
    return (
      <polyline
        key={`e:${id}`}
        data-testid="graph-highlight-edge"
        points={toPoints(path)}
        fill="none"
        stroke={PALETTE.cobalt}
        strokeOpacity={0.45}
        strokeWidth={10 / zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  };

  return (
    <g pointerEvents="none">
      {result.kind === 'traversal' && (
        <>
          {result.edges.map(edge)}
          {result.order.map((id, i) => {
            const s = shapes[id];
            if (!s) return null;
            const b = shapeBounds(s);
            return (
              <g
                key={`o:${id}`}
                data-testid="graph-order-badge"
                transform={`translate(${b.x + b.w} ${b.y}) scale(${1 / zoom})`}
              >
                <circle r={11} fill={PALETTE.cobalt} stroke={PALETTE.ink} strokeWidth={1.5} />
                <text
                  y={4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill={PALETTE.white}
                  className="font-mono"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </>
      )}
      {result.kind === 'path' && (
        <>
          {result.edges.map(edge)}
          {result.nodes.map((id) => ring(id, PALETTE.cobalt, `p:${id}`))}
        </>
      )}
      {result.kind === 'mst' && result.edges.map(edge)}
      {result.kind === 'components' &&
        result.groups.flatMap((group, gi) =>
          group.map((id) => ring(id, GROUP_COLORS[gi % GROUP_COLORS.length] as string, `c:${id}`)),
        )}
    </g>
  );
}
