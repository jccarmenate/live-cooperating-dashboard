import type { Point, Rect, Shape } from '../schema/types';
import { unionRects } from './rect';
import { shapeBounds } from './shapes';

/** Maps the `world` rectangle into a minimap box: box = (world − world.xy) · scale + offset. */
export interface MinimapProjection {
  world: Rect;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Bounds of every shape on the board, or null for an empty board. */
export function contentBounds(shapes: Readonly<Record<string, Shape>>): Rect | null {
  return unionRects(Object.values(shapes).map(shapeBounds));
}

/**
 * Fits the union of the content and the viewport, padded by `pad` of its size on each side,
 * into a `boxW`×`boxH` box, keeping the aspect ratio and centring it.
 */
export function minimapProjection(
  content: Rect | null,
  viewport: Rect,
  boxW: number,
  boxH: number,
  pad = 0.1,
): MinimapProjection {
  const base = (content ? unionRects([content, viewport]) : null) ?? viewport;
  const px = Math.max(base.w * pad, 1);
  const py = Math.max(base.h * pad, 1);
  const world = { x: base.x - px, y: base.y - py, w: base.w + 2 * px, h: base.h + 2 * py };
  const scale = Math.min(boxW / world.w, boxH / world.h);
  return {
    world,
    scale,
    offsetX: (boxW - world.w * scale) / 2,
    offsetY: (boxH - world.h * scale) / 2,
  };
}

export function toMinimap(p: MinimapProjection, pt: Point): Point {
  return {
    x: (pt.x - p.world.x) * p.scale + p.offsetX,
    y: (pt.y - p.world.y) * p.scale + p.offsetY,
  };
}

export function fromMinimap(p: MinimapProjection, pt: Point): Point {
  return {
    x: (pt.x - p.offsetX) / p.scale + p.world.x,
    y: (pt.y - p.offsetY) / p.scale + p.world.y,
  };
}

export function rectToMinimap(p: MinimapProjection, r: Rect): Rect {
  const topLeft = toMinimap(p, r);
  return { x: topLeft.x, y: topLeft.y, w: r.w * p.scale, h: r.h * p.scale };
}
