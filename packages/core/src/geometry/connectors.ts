import type {
  AnchorSide,
  AttachedEnd,
  Connector,
  Endpoint,
  Point,
  Rect,
  Shape,
} from '../schema/types';
import { centerOf } from './rect';
import { shapeBounds } from './shapes';

export type ShapeGeometry = Pick<Shape, 'type' | 'x' | 'y' | 'w' | 'h'>;
export type ShapeLookup = Readonly<Record<string, ShapeGeometry | undefined>>;

export const isAttached = (e: Endpoint): e is AttachedEnd => 'shapeId' in e;

export function anchorPoint(b: Rect, side: AnchorSide): Point {
  switch (side) {
    case 'n':
      return { x: b.x + b.w / 2, y: b.y };
    case 's':
      return { x: b.x + b.w / 2, y: b.y + b.h };
    case 'e':
      return { x: b.x + b.w, y: b.y + b.h / 2 };
    case 'w':
      return { x: b.x, y: b.y + b.h / 2 };
  }
}

/** Side of `b` facing `target`, by the dominant axis from b's centre (ties go horizontal). */
export function facingSide(b: Rect, target: Point): AnchorSide {
  const c = centerOf(b);
  return sideFor(target.x - c.x, target.y - c.y);
}

function sideFor(dx: number, dy: number): AnchorSide {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/** Where the ray from the shape's centre toward `target` leaves its outline. */
export function clipToOutline(s: ShapeGeometry, target: Point): Point {
  const b = shapeBounds(s);
  const c = centerOf(b);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  let t: number;
  if (s.type === 'ellipse') {
    const rx = b.w / 2;
    const ry = b.h / 2;
    t = rx > 0 && ry > 0 ? 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)) : 0;
  } else {
    const tx = dx === 0 ? Number.POSITIVE_INFINITY : b.w / 2 / Math.abs(dx);
    const ty = dy === 0 ? Number.POSITIVE_INFINITY : b.h / 2 / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const horizontal = (s: AnchorSide) => s === 'e' || s === 'w';

function withoutRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => {
    const prev = points[i - 1];
    return !prev || prev.x !== p.x || prev.y !== p.y;
  });
}

/** Orthogonal polyline with at most two bends, leaving `a` along `sa` and entering `b` along `sb`. */
export function elbowPath(a: Point, sa: AnchorSide, b: Point, sb: AnchorSide): Point[] {
  if (a.x === b.x && a.y === b.y) return [a, b];
  if (horizontal(sa) && horizontal(sb)) {
    if (a.y === b.y) return [a, b];
    const mx = (a.x + b.x) / 2;
    return withoutRepeats([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
  }
  if (!horizontal(sa) && !horizontal(sb)) {
    if (a.x === b.x) return [a, b];
    const my = (a.y + b.y) / 2;
    return withoutRepeats([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
  }
  if (horizontal(sa)) return withoutRepeats([a, { x: b.x, y: a.y }, b]);
  return withoutRepeats([a, { x: a.x, y: b.y }, b]);
}

function referencePoint(e: Endpoint, shapes: ShapeLookup): Point | null {
  if (!isAttached(e)) return { x: e.x, y: e.y };
  const s = shapes[e.shapeId];
  return s ? centerOf(shapeBounds(s)) : null;
}

/**
 * Polyline for a connector from start to end, derived from the current shape
 * geometry (so it follows shapes as they move). Null if an attached shape is gone.
 */
export function connectorPath(
  c: Pick<Connector, 'from' | 'to' | 'routing'>,
  shapes: ShapeLookup,
): Point[] | null {
  const fromRef = referencePoint(c.from, shapes);
  const toRef = referencePoint(c.to, shapes);
  if (!fromRef || !toRef) return null;

  const endOf = (e: Endpoint, other: Point): { p: Point; side: AnchorSide } => {
    if (!isAttached(e)) {
      return { p: { x: e.x, y: e.y }, side: sideFor(other.x - e.x, other.y - e.y) };
    }
    const s = shapes[e.shapeId] as ShapeGeometry;
    const b = shapeBounds(s);
    if (e.anchor !== 'auto') return { p: anchorPoint(b, e.anchor), side: e.anchor };
    const side = facingSide(b, other);
    if (c.routing === 'elbow') return { p: anchorPoint(b, side), side };
    return { p: clipToOutline(s, other), side };
  };

  const a = endOf(c.from, toRef);
  const b = endOf(c.to, fromRef);
  if (c.routing === 'straight') return [a.p, b.p];
  return elbowPath(a.p, a.side, b.p, b.side);
}

/** Triangle [tip, left, right] for an arrowhead at `tip` coming from `from`. */
export function arrowHead(tip: Point, from: Point, size = 12): [Point, Point, Point] | null {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  return [tip, { x: bx + px, y: by + py }, { x: bx - px, y: by - py }];
}
