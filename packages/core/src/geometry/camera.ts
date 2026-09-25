import type { Point } from '../schema/types';

/** screen = (world + {x, y}) * zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom - cam.x, y: p.y / cam.zoom - cam.y };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x + cam.x) * cam.zoom, y: (p.y + cam.y) * cam.zoom };
}

/** Pans by a delta expressed in screen pixels. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { x: cam.x + dx / cam.zoom, y: cam.y + dy / cam.zoom, zoom: cam.zoom };
}

/** Zooms keeping the world point under `screenPoint` fixed. */
export function zoomAt(cam: Camera, screenPoint: Point, nextZoom: number): Camera {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(cam, screenPoint);
  return { x: screenPoint.x / zoom - world.x, y: screenPoint.y / zoom - world.y, zoom };
}
