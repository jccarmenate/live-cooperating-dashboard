import type { Point, Rect, Shape, ShapeType } from '../schema/types';
import { rectFromPoints } from './rect';

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type LineHandle = 'start' | 'end';
export type Handle = BoxHandle | LineHandle;

export const BOX_HANDLES: readonly BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const LINE_HANDLES: readonly LineHandle[] = ['start', 'end'];
export const HANDLES: readonly Handle[] = [...BOX_HANDLES, ...LINE_HANDLES];

/** Boxes never shrink below this many world units on either axis. */
export const MIN_SIZE = 8;

type Geometry = Pick<Shape, 'type' | 'x' | 'y' | 'w' | 'h'>;

export const isHandle = (v: unknown): v is Handle =>
  typeof v === 'string' && (HANDLES as readonly string[]).includes(v);

/** Axis-aligned bounds. Lines store a signed vector from their start point, so normalize them. */
export function shapeBounds(s: Geometry): Rect {
  if (s.type === 'line') return rectFromPoints({ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h });
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

export function handlesFor(type: ShapeType): readonly Handle[] {
  return type === 'line' ? LINE_HANDLES : BOX_HANDLES;
}

export function handlePoint(s: Geometry, handle: Handle): Point {
  if (handle === 'start') return { x: s.x, y: s.y };
  if (handle === 'end') return { x: s.x + s.w, y: s.y + s.h };
  const b = shapeBounds(s);
  const x = handle.includes('w') ? b.x : handle.includes('e') ? b.x + b.w : b.x + b.w / 2;
  const y = handle.includes('n') ? b.y : handle.includes('s') ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

/** Touching edges count as intersecting. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/**
 * Ids of shapes whose bounds intersect `rect`, sorted for determinism.
 * A linear scan: fine for the hundreds of shapes a board holds; an R-tree can
 * replace it behind this signature if profiling ever demands it.
 */
export function shapesInRect(shapes: Readonly<Record<string, Shape>>, rect: Rect): string[] {
  return Object.values(shapes)
    .filter((s) => rectsIntersect(shapeBounds(s), rect))
    .map((s) => s.id)
    .sort();
}

/** Keeps `moving` at least MIN_SIZE away from `fixed`, on the side it was dragged to. */
function clampFrom(fixed: number, moving: number, movingIsMin: boolean): number {
  const d = moving - fixed;
  if (Math.abs(d) >= MIN_SIZE) return moving;
  const side = d === 0 ? (movingIsMin ? -1 : 1) : Math.sign(d);
  return fixed + side * MIN_SIZE;
}

/**
 * New geometry when `handle` of a shape whose geometry was `start` is dragged by `delta`.
 * Boxes flip instead of going negative and never shrink below MIN_SIZE; `keepAspect`
 * applies to corner handles. Lines move one endpoint of their signed vector.
 */
export function resizeGeometry(
  type: ShapeType,
  start: Rect,
  handle: Handle,
  delta: Point,
  keepAspect = false,
): Rect {
  if (type === 'line') {
    if (handle === 'start') {
      return {
        x: start.x + delta.x,
        y: start.y + delta.y,
        w: start.w - delta.x,
        h: start.h - delta.y,
      };
    }
    if (handle === 'end') {
      return { x: start.x, y: start.y, w: start.w + delta.x, h: start.h + delta.y };
    }
    return { ...start };
  }
  if (handle === 'start' || handle === 'end') return { ...start };

  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  if (handle.includes('w')) left += delta.x;
  if (handle.includes('e')) right += delta.x;
  if (handle.includes('n')) top += delta.y;
  if (handle.includes('s')) bottom += delta.y;

  if (keepAspect && handle.length === 2 && start.w > 0 && start.h > 0) {
    const w = right - left;
    const h = bottom - top;
    const scale = Math.max(Math.abs(w) / start.w, Math.abs(h) / start.h);
    const nw = (w < 0 ? -1 : 1) * start.w * scale;
    const nh = (h < 0 ? -1 : 1) * start.h * scale;
    if (handle.includes('w')) left = right - nw;
    else right = left + nw;
    if (handle.includes('n')) top = bottom - nh;
    else bottom = top + nh;
  }

  if (handle.includes('w')) left = clampFrom(right, left, true);
  if (handle.includes('e')) right = clampFrom(left, right, false);
  if (handle.includes('n')) top = clampFrom(bottom, top, true);
  if (handle.includes('s')) bottom = clampFrom(top, bottom, false);

  return rectFromPoints({ x: left, y: top }, { x: right, y: bottom });
}
