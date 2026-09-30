import { MAX_ZOOM, screenToWorld } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { pinchCamera, startPinch } from '../src/render/pinch';

const cam = { x: 10, y: -20, zoom: 1 };

describe('pinch', () => {
  it('keeps the camera while the fingers stay put', () => {
    const start = startPinch(cam, { x: 100, y: 100 }, { x: 200, y: 300 });
    expect(pinchCamera(start, { x: 100, y: 100 }, { x: 200, y: 300 })).toEqual(cam);
  });

  it('pans with the midpoint when both fingers move together', () => {
    const start = startPinch(cam, { x: 100, y: 100 }, { x: 200, y: 100 });
    expect(pinchCamera(start, { x: 130, y: 60 }, { x: 230, y: 60 })).toEqual({
      x: 40,
      y: -60,
      zoom: 1,
    });
  });

  it('zooms by the change in finger distance, keeping the world under the midpoint', () => {
    const a = { x: 100, y: 200 };
    const b = { x: 300, y: 200 };
    const start = startPinch(cam, a, b);
    const next = pinchCamera(start, { x: 0, y: 200 }, { x: 400, y: 200 });
    expect(next.zoom).toBe(2);
    expect(screenToWorld(next, { x: 200, y: 200 })).toEqual(screenToWorld(cam, { x: 200, y: 200 }));
  });

  it('clamps the zoom', () => {
    const start = startPinch(cam, { x: 50, y: 50 }, { x: 60, y: 50 });
    expect(pinchCamera(start, { x: 0, y: 50 }, { x: 5000, y: 50 }).zoom).toBe(MAX_ZOOM);
  });

  it('only pans when the fingers start on the same spot', () => {
    const start = startPinch(cam, { x: 50, y: 50 }, { x: 50, y: 50 });
    const next = pinchCamera(start, { x: 0, y: 0 }, { x: 200, y: 200 });
    expect(next).toEqual({ x: 60, y: 30, zoom: 1 });
  });
});
