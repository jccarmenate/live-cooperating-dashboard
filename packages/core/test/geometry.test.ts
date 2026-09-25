import { describe, expect, it } from 'vitest';
import {
  type Camera,
  centerOf,
  containsPoint,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  rectFromPoints,
  screenToWorld,
  unionRects,
  worldToScreen,
  zoomAt,
} from '../src';

describe('rect', () => {
  it('builds a positive rect from any two corners', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, w: 10, h: 15 });
  });

  it('containsPoint is inclusive of edges', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(containsPoint(r, { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(r, { x: 10.01, y: 5 })).toBe(false);
  });

  it('unionRects', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -5, y: 5, w: 5, h: 20 },
      ]),
    ).toEqual({ x: -5, y: 0, w: 15, h: 25 });
  });

  it('centerOf', () => {
    expect(centerOf({ x: 0, y: 10, w: 20, h: 40 })).toEqual({ x: 10, y: 30 });
  });
});

describe('camera', () => {
  const cam: Camera = { x: 100, y: -50, zoom: 2 };

  it('screen and world transforms are inverses', () => {
    const world = { x: 12.5, y: -7 };
    expect(screenToWorld(cam, worldToScreen(cam, world))).toEqual(world);
    expect(worldToScreen(cam, { x: 0, y: 0 })).toEqual({ x: 200, y: -100 });
  });

  it('panBy moves by screen pixels', () => {
    const next = panBy(cam, 20, -10);
    expect(next).toEqual({ x: 110, y: -55, zoom: 2 });
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const p = { x: 300, y: 200 };
    const before = screenToWorld(cam, p);
    const next = zoomAt(cam, p, 3);
    expect(next.zoom).toBe(3);
    const after = screenToWorld(next, p);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt clamps zoom', () => {
    expect(zoomAt(cam, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(cam, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM);
  });
});
