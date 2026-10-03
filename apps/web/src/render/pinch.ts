import { type Camera, clampZoom, type Point, screenToWorld } from '@relay/core';

/** A two-finger gesture as it began: the world point under the fingers' midpoint stays under it. */
export interface PinchStart {
  zoom: number;
  world: Point;
  dist: number;
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Starts a pinch from two touch points in canvas pixels. */
export function startPinch(camera: Camera, a: Point, b: Point): PinchStart {
  return {
    zoom: camera.zoom,
    world: screenToWorld(camera, midpoint(a, b)),
    dist: distance(a, b),
  };
}

/** The camera for the fingers now at `a` and `b`: moving them pans, spreading them zooms. */
export function pinchCamera(start: PinchStart, a: Point, b: Point): Camera {
  const zoom = start.dist > 0 ? clampZoom((start.zoom * distance(a, b)) / start.dist) : start.zoom;
  const m = midpoint(a, b);
  return { x: m.x / zoom - start.world.x, y: m.y / zoom - start.world.y, zoom };
}
