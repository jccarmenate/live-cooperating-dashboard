import { describe, expect, it } from 'vitest';
import {
  type Camera,
  centerOn,
  contentBounds,
  DEFAULT_STYLE,
  fitBounds,
  fromMinimap,
  MIN_ZOOM,
  minimapProjection,
  parseCamera,
  rectToMinimap,
  type Shape,
  toMinimap,
  viewportRect,
  wheelZoomFactor,
  worldToScreen,
} from '../src';

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    z: 'a0',
    style: DEFAULT_STYLE.rect,
    text: '',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 0,
    ...partial,
  };
}

describe('camera navigation', () => {
  it('viewportRect is the world rectangle on screen', () => {
    expect(viewportRect({ x: -100, y: -50, zoom: 2 }, 800, 600)).toEqual({
      x: 100,
      y: 50,
      w: 400,
      h: 300,
    });
  });

  it('centerOn keeps the zoom and puts the point at the viewport centre', () => {
    const cam = centerOn({ x: 0, y: 0, zoom: 2 }, { x: 500, y: 300 }, 800, 600);
    expect(cam).toEqual({ x: -300, y: -150, zoom: 2 });
    expect(worldToScreen(cam, { x: 500, y: 300 })).toEqual({ x: 400, y: 300 });
  });

  it('fitBounds shrinks to fit, centred, with padding', () => {
    const cam = fitBounds({ x: 0, y: 0, w: 1000, h: 500 }, 800, 600);
    expect(cam.zoom).toBeCloseTo(0.704, 6); // (800 - 2·48) / 1000
    const c = worldToScreen(cam, { x: 500, y: 250 });
    expect(c.x).toBeCloseTo(400, 6);
    expect(c.y).toBeCloseTo(300, 6);
  });

  it('fitBounds never zooms past 100% and clamps to the minimum zoom', () => {
    expect(fitBounds({ x: 10, y: 10, w: 100, h: 100 }, 800, 600)).toEqual({
      x: 340,
      y: 240,
      zoom: 1,
    });
    expect(fitBounds({ x: 0, y: 0, w: 1e6, h: 1e6 }, 800, 600).zoom).toBe(MIN_ZOOM);
  });

  it('wheelZoomFactor is exponential and caps a single event', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-10)).toBeCloseTo(Math.exp(0.1), 12);
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.5), 12);
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.5), 12);
  });

  it('parseCamera accepts only finite cameras within the zoom range', () => {
    const ok: Camera = { x: 1, y: -2, zoom: 1.5 };
    expect(parseCamera(ok)).toEqual(ok);
    expect(parseCamera({ x: 1, y: 2, zoom: 5 })).toBeNull();
    expect(parseCamera({ x: Number.NaN, y: 2, zoom: 1 })).toBeNull();
    expect(parseCamera({ x: '1', y: 2, zoom: 1 })).toBeNull();
    expect(parseCamera(null)).toBeNull();
  });
});

describe('minimap projection', () => {
  it('contentBounds unions every shape (lines normalized) and is null when empty', () => {
    expect(contentBounds({})).toBeNull();
    expect(
      contentBounds({
        r: shape('r', { x: 0, y: 0, w: 100, h: 50 }),
        l: shape('l', { type: 'line', x: 300, y: 200, w: -100, h: 100 }),
      }),
    ).toEqual({ x: 0, y: 0, w: 300, h: 300 });
  });

  it('projects the padded viewport into the box when there is no content', () => {
    const p = minimapProjection(null, { x: 0, y: 0, w: 1000, h: 700 }, 200, 140);
    expect(p.world).toEqual({ x: -100, y: -70, w: 1200, h: 840 });
    expect(p.scale).toBeCloseTo(1 / 6, 12);
    expect(p.offsetX).toBeCloseTo(0, 12);
    expect(p.offsetY).toBeCloseTo(0, 12);
    const m = toMinimap(p, { x: 0, y: 0 });
    expect(m.x).toBeCloseTo(100 / 6, 9);
    expect(m.y).toBeCloseTo(70 / 6, 9);
  });

  it('keeps the aspect ratio and centres the union of content and viewport', () => {
    const p = minimapProjection(
      { x: 2000, y: 0, w: 1000, h: 700 },
      { x: 0, y: 0, w: 1000, h: 700 },
      200,
      140,
    );
    expect(p.world).toEqual({ x: -300, y: -70, w: 3600, h: 840 });
    expect(p.scale).toBeCloseTo(200 / 3600, 12);
    expect(p.offsetX).toBeCloseTo(0, 9);
    expect(p.offsetY).toBeCloseTo((140 - 840 * (200 / 3600)) / 2, 9);
    const r = rectToMinimap(p, { x: -300, y: -70, w: 3600, h: 840 });
    expect(r.w).toBeCloseTo(200, 9);
  });

  it('fromMinimap inverts toMinimap', () => {
    const p = minimapProjection(
      { x: 50, y: 80, w: 900, h: 300 },
      { x: 0, y: 0, w: 640, h: 480 },
      200,
      140,
    );
    const back = fromMinimap(p, toMinimap(p, { x: 123, y: 456 }));
    expect(back.x).toBeCloseTo(123, 9);
    expect(back.y).toBeCloseTo(456, 9);
  });
});
