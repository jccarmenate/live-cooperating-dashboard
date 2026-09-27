import { describe, expect, it } from 'vitest';
import {
  BOX_HANDLES,
  COLUMN_HEADER_H,
  DEFAULT_STYLE,
  FRAME_MIN_H,
  FRAME_TITLE_H,
  handlePoint,
  handlesFor,
  isHandle,
  MIN_SIZE,
  minSize,
  rectsIntersect,
  resizeGeometry,
  type Shape,
  shapeBounds,
  shapesInRect,
} from '../src';

const box = { x: 100, y: 100, w: 200, h: 100 };

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 'a0',
    style: DEFAULT_STYLE.rect,
    createdBy: 'u',
    authorName: 'U',
    createdAt: 0,
    ...partial,
  };
}

describe('resizeGeometry — boxes', () => {
  it('se grows from the top-left anchor', () => {
    expect(resizeGeometry('rect', box, 'se', { x: 20, y: 10 })).toEqual({
      x: 100,
      y: 100,
      w: 220,
      h: 110,
    });
  });

  it('nw moves the origin and keeps the opposite corner', () => {
    expect(resizeGeometry('rect', box, 'nw', { x: 20, y: 10 })).toEqual({
      x: 120,
      y: 110,
      w: 180,
      h: 90,
    });
  });

  it('edge handles change one axis only', () => {
    expect(resizeGeometry('rect', box, 'e', { x: 30, y: 50 })).toEqual({
      x: 100,
      y: 100,
      w: 230,
      h: 100,
    });
    expect(resizeGeometry('rect', box, 'n', { x: 30, y: -20 })).toEqual({
      x: 100,
      y: 80,
      w: 200,
      h: 120,
    });
  });

  it('flips instead of going negative when dragged past the opposite edge', () => {
    expect(resizeGeometry('rect', box, 'e', { x: -260, y: 0 })).toEqual({
      x: 40,
      y: 100,
      w: 60,
      h: 100,
    });
  });

  it('never shrinks below MIN_SIZE', () => {
    expect(resizeGeometry('rect', box, 'e', { x: -198, y: 0 })).toEqual({
      x: 100,
      y: 100,
      w: MIN_SIZE,
      h: 100,
    });
  });

  it('clamps w handle while keeping right edge fixed', () => {
    expect(resizeGeometry('rect', box, 'w', { x: 195, y: 0 })).toEqual({
      x: 292,
      y: 100,
      w: 8,
      h: 100,
    });
  });

  it('clamps corner handles while keeping opposite corner fixed', () => {
    expect(resizeGeometry('rect', box, 'nw', { x: 195, y: 95 })).toEqual({
      x: 292,
      y: 192,
      w: 8,
      h: 8,
    });
  });

  it('clamps n handle while keeping bottom edge fixed', () => {
    expect(resizeGeometry('rect', box, 'n', { x: 0, y: 100 })).toEqual({
      x: 100,
      y: 192,
      w: 200,
      h: 8,
    });
  });

  it('keeps the aspect ratio on corner handles when asked', () => {
    expect(resizeGeometry('rect', box, 'se', { x: 100, y: 0 }, true)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 150,
    });
  });

  it('ignores keepAspect on edge handles', () => {
    expect(resizeGeometry('rect', box, 'e', { x: 100, y: 0 }, true)).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 100,
    });
  });

  it('ignores line handles on boxes', () => {
    expect(resizeGeometry('rect', box, 'end', { x: 5, y: 5 })).toEqual(box);
  });
});

describe('resizeGeometry — lines', () => {
  const line = { x: 0, y: 0, w: 100, h: 50 };

  it('moves one endpoint and keeps the other', () => {
    expect(resizeGeometry('line', line, 'end', { x: 10, y: -10 })).toEqual({
      x: 0,
      y: 0,
      w: 110,
      h: 40,
    });
    expect(resizeGeometry('line', line, 'start', { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      w: 90,
      h: 40,
    });
  });

  it('ignores box handles on lines', () => {
    expect(resizeGeometry('line', line, 'se', { x: 5, y: 5 })).toEqual(line);
  });
});

describe('handles and bounds', () => {
  it('shapeBounds normalizes signed line vectors', () => {
    expect(shapeBounds({ type: 'line', x: 100, y: 100, w: -50, h: 20 })).toEqual({
      x: 50,
      y: 100,
      w: 50,
      h: 20,
    });
    expect(shapeBounds({ type: 'rect', ...box })).toEqual(box);
  });

  it('handlesFor returns 8 box handles or 2 line endpoints', () => {
    expect(handlesFor('rect')).toEqual(BOX_HANDLES);
    expect(handlesFor('line')).toEqual(['start', 'end']);
  });

  it('handlePoint places handles on the bounds', () => {
    const r = { type: 'rect' as const, ...box };
    expect(handlePoint(r, 'nw')).toEqual({ x: 100, y: 100 });
    expect(handlePoint(r, 'n')).toEqual({ x: 200, y: 100 });
    expect(handlePoint(r, 'e')).toEqual({ x: 300, y: 150 });
    expect(handlePoint(r, 'sw')).toEqual({ x: 100, y: 200 });
    const l = { type: 'line' as const, x: 10, y: 20, w: -5, h: 30 };
    expect(handlePoint(l, 'start')).toEqual({ x: 10, y: 20 });
    expect(handlePoint(l, 'end')).toEqual({ x: 5, y: 50 });
  });

  it('isHandle recognizes only known handles', () => {
    expect(isHandle('se')).toBe(true);
    expect(isHandle('start')).toBe(true);
    expect(isHandle('middle')).toBe(false);
    expect(isHandle(null)).toBe(false);
  });
});

describe('marquee hit-testing', () => {
  it('rectsIntersect counts touching edges', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('shapesInRect returns the sorted ids of intersecting shapes, lines by their bounds', () => {
    const shapes = {
      b: shape('b', { x: 50, y: 50, w: 20, h: 20 }),
      a: shape('a', { x: 0, y: 0, w: 20, h: 20 }),
      far: shape('far', { x: 500, y: 500, w: 20, h: 20 }),
      l: shape('l', { type: 'line', x: 90, y: 90, w: -10, h: -10 }),
    };
    expect(shapesInRect(shapes, { x: 10, y: 10, w: 75, h: 75 })).toEqual(['a', 'b', 'l']);
  });
});

describe('frame minimum size', () => {
  it('FRAME_MIN_H is the title band plus a column header', () => {
    expect(FRAME_MIN_H).toBe(FRAME_TITLE_H + COLUMN_HEADER_H);
    expect(minSize('frame')).toEqual({ w: MIN_SIZE, h: FRAME_MIN_H });
    expect(minSize('sticky')).toEqual({ w: MIN_SIZE, h: MIN_SIZE });
  });

  it('a frame never resizes shorter than FRAME_MIN_H; other shapes keep MIN_SIZE', () => {
    const f = { x: 0, y: 0, w: 400, h: 300 };
    expect(resizeGeometry('frame', f, 's', { x: 0, y: -290 })).toEqual({
      x: 0,
      y: 0,
      w: 400,
      h: 64,
    });
    expect(resizeGeometry('frame', f, 'n', { x: 0, y: 280 })).toEqual({
      x: 0,
      y: 236,
      w: 400,
      h: 64,
    });
    // Same delta as the frame case above, but MIN_SIZE (8) is far smaller than FRAME_MIN_H:
    // 300 - 290 = 10 is already >= MIN_SIZE, so a plain rect isn't clamped at all here.
    expect(resizeGeometry('rect', f, 's', { x: 0, y: -290 })).toEqual({
      x: 0,
      y: 0,
      w: 400,
      h: 10,
    });
  });
});
