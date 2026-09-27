import type { Point, Rect } from '../schema/types';
import { centerOf } from './rect';

/** screen = (world + {x, y}) * zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Zoom-control step (× / ÷ per click). */
export const ZOOM_STEP = 1.25;
/** Largest |deltaY| one wheel event contributes to zoom: a mouse notch reports ~100. */
export const WHEEL_DELTA_CAP = 50;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

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

/** Zoom multiplier for one ctrl+wheel / pinch event. */
export function wheelZoomFactor(deltaY: number): number {
  const d = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, deltaY));
  return Math.exp(-d * 0.01);
}

/** World rectangle visible in a `w`×`h` px viewport. */
export function viewportRect(cam: Camera, w: number, h: number): Rect {
  const topLeft = screenToWorld(cam, { x: 0, y: 0 });
  return { x: topLeft.x, y: topLeft.y, w: w / cam.zoom, h: h / cam.zoom };
}

/** Same zoom, with the world point `p` at the centre of a `w`×`h` px viewport. */
export function centerOn(cam: Camera, p: Point, w: number, h: number): Camera {
  return { x: w / 2 / cam.zoom - p.x, y: h / 2 / cam.zoom - p.y, zoom: cam.zoom };
}

/** Camera showing `bounds` centred in a `w`×`h` px viewport with `padding` px, never above `maxZoom`. */
export function fitBounds(bounds: Rect, w: number, h: number, padding = 48, maxZoom = 1): Camera {
  const zoom = clampZoom(
    Math.min(
      maxZoom,
      Math.max(1, w - 2 * padding) / Math.max(1, bounds.w),
      Math.max(1, h - 2 * padding) / Math.max(1, bounds.h),
    ),
  );
  return centerOn({ x: 0, y: 0, zoom }, centerOf(bounds), w, h);
}

/** Validates a camera read back from storage. */
export function parseCamera(raw: unknown): Camera | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!(zoom >= MIN_ZOOM && zoom <= MAX_ZOOM)) return null;
  return { x, y, zoom };
}
