import type { NewConnector, NewShape } from '../commands/types';
import { DEFAULT_STYLE } from '../schema/defaults';
import type { Point } from '../schema/types';
import { layoutGraph, NODE_SIZE } from './layout';
import type { GraphDraft } from './model';

/** Ellipse nodes and connector edges for a draft, laid out around `at` (ready for PasteItems). */
export function graphPlan(
  d: GraphDraft,
  at: Point,
  ctx: { newId(): string; userId: string; userName: string; now(): number },
): { shapes: NewShape[]; connectors: NewConnector[] } {
  const pts = layoutGraph(d);
  const ids = d.names.map(() => ctx.newId());
  const shapes: NewShape[] = d.names.map((name, i) => {
    const p = pts[i] as Point;
    return {
      id: ids[i] as string,
      type: 'ellipse',
      x: at.x + p.x - NODE_SIZE / 2,
      y: at.y + p.y - NODE_SIZE / 2,
      w: NODE_SIZE,
      h: NODE_SIZE,
      style: DEFAULT_STYLE.ellipse,
      text: name,
      createdBy: ctx.userId,
      authorName: ctx.userName,
      createdAt: ctx.now(),
    };
  });
  const connectors: NewConnector[] = d.edges.map((e) => ({
    id: ctx.newId(),
    from: { shapeId: ids[e.from] as string, anchor: 'auto' },
    to: { shapeId: ids[e.to] as string, anchor: 'auto' },
    routing: 'straight',
    head: e.directed ? 'arrow' : 'none',
    createdBy: ctx.userId,
    ...(e.label ? { label: e.label } : {}),
  }));
  return { shapes, connectors };
}
