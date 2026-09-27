import { describe, expect, it } from 'vitest';
import {
  anchorPoint,
  arrowGeometry,
  arrowHead,
  clipToOutline,
  connectorPath,
  elbowPath,
  facingSide,
  isAttached,
  type ShapeLookup,
} from '../src';

const A = { type: 'rect' as const, x: 0, y: 0, w: 100, h: 50 }; // centre (50, 25)
const B = { type: 'rect' as const, x: 300, y: 200, w: 100, h: 50 }; // centre (350, 225)
const shapes: ShapeLookup = { a: A, b: B };
const at = (shapeId: string) => ({ shapeId, anchor: 'auto' as const });

describe('anchors', () => {
  it('anchorPoint returns edge midpoints', () => {
    expect(anchorPoint(A, 'n')).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(A, 's')).toEqual({ x: 50, y: 50 });
    expect(anchorPoint(A, 'e')).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(A, 'w')).toEqual({ x: 0, y: 25 });
  });

  it('facingSide picks the dominant axis, ties go horizontal', () => {
    expect(facingSide(A, { x: 350, y: 225 })).toBe('e');
    expect(facingSide(A, { x: 60, y: 500 })).toBe('s');
    expect(facingSide(A, { x: -100, y: 25 })).toBe('w');
    expect(facingSide(A, { x: 50, y: -300 })).toBe('n');
    expect(facingSide(A, { x: 150, y: 125 })).toBe('e');
  });

  it('isAttached distinguishes shape ends from free points', () => {
    expect(isAttached(at('a'))).toBe(true);
    expect(isAttached({ x: 1, y: 2 })).toBe(false);
  });
});

describe('clipToOutline', () => {
  it('clips to the rectangle border along the centre line', () => {
    expect(clipToOutline(A, { x: 350, y: 225 })).toEqual({ x: 87.5, y: 50 });
  });

  it('clips to the ellipse curve', () => {
    const e = { type: 'ellipse' as const, x: 0, y: 0, w: 200, h: 100 };
    expect(clipToOutline(e, { x: 300, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(clipToOutline(e, { x: 100, y: 250 })).toEqual({ x: 100, y: 100 });
  });

  it('returns the centre when the target is the centre', () => {
    expect(clipToOutline(A, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });
});

describe('connectorPath', () => {
  it('straight auto connectors run between the two outlines', () => {
    expect(connectorPath({ from: at('a'), to: at('b'), routing: 'straight' }, shapes)).toEqual([
      { x: 87.5, y: 50 },
      { x: 312.5, y: 200 },
    ]);
  });

  it('elbow auto connectors leave from facing sides with a mid-x bend', () => {
    expect(connectorPath({ from: at('a'), to: at('b'), routing: 'elbow' }, shapes)).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ]);
  });

  it('respects fixed anchors (vertical start, horizontal end → one bend)', () => {
    const c = {
      from: { shapeId: 'a', anchor: 's' as const },
      to: { shapeId: 'b', anchor: 'w' as const },
      routing: 'elbow' as const,
    };
    expect(connectorPath(c, shapes)).toEqual([
      { x: 50, y: 50 },
      { x: 50, y: 225 },
      { x: 300, y: 225 },
    ]);
  });

  it('supports free endpoints', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 50 };
    expect(connectorPath({ from, to, routing: 'straight' }, {})).toEqual([from, to]);
    expect(connectorPath({ from, to, routing: 'elbow' }, {})).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('returns null when an attached shape no longer exists', () => {
    expect(
      connectorPath({ from: at('a'), to: at('gone'), routing: 'straight' }, shapes),
    ).toBeNull();
  });

  it('handles coinciding anchors (mixed horizontal/vertical) with 2-point path', () => {
    // Repro case: anchors at (100, 50)
    const A2 = { type: 'rect' as const, x: 0, y: 0, w: 100, h: 100 };
    const B2 = { type: 'rect' as const, x: 50, y: 50, w: 100, h: 0 };
    const shapes2 = { a: A2, b: B2 };
    const path = connectorPath(
      {
        from: { shapeId: 'a', anchor: 'e' as const },
        to: { shapeId: 'b', anchor: 'n' as const },
        routing: 'elbow' as const,
      },
      shapes2,
    );
    expect(path).toEqual([
      { x: 100, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(path?.length).toBe(2);
  });

  it('handles zero-size shape with all finite coordinates', () => {
    const zeroSize = { type: 'rect' as const, x: 10, y: 10, w: 0, h: 0 };
    const shapesWithZero = { a: A, zero: zeroSize };
    const path = connectorPath(
      {
        from: { shapeId: 'a', anchor: 'auto' as const },
        to: { shapeId: 'zero', anchor: 'auto' as const },
        routing: 'straight' as const,
      },
      shapesWithZero,
    );
    expect(path).not.toBeNull();
    expect(path?.length).toBe(2);
    expect(path?.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('handles line shape with negative vector', () => {
    const negLine = { type: 'line' as const, x: 400, y: 100, w: -100, h: 50 };
    const shapesWithLine = { a: A, line: negLine };
    const path = connectorPath(
      {
        from: { shapeId: 'a', anchor: 'auto' as const },
        to: { shapeId: 'line', anchor: 'auto' as const },
        routing: 'straight' as const,
      },
      shapesWithLine,
    );
    expect(path).not.toBeNull();
    expect(path?.length).toBe(2);
    expect(path?.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('elbowPath and arrowHead', () => {
  it('vertical-to-vertical uses a mid-y bend and drops duplicate points', () => {
    expect(elbowPath({ x: 0, y: 0 }, 's', { x: 0, y: 100 }, 'n')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(elbowPath({ x: 0, y: 0 }, 's', { x: 40, y: 100 }, 'n')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 100 },
    ]);
  });

  it('arrowHead builds a triangle pointing at the tip', () => {
    expect(arrowHead({ x: 100, y: 0 }, { x: 0, y: 0 }, 10)).toEqual([
      { x: 100, y: 0 },
      { x: 90, y: 5 },
      { x: 90, y: -5 },
    ]);
    expect(arrowHead({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('arrowGeometry', () => {
  it('ends the stroke at the arrowhead base', () => {
    expect(
      arrowGeometry([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual({
      stroke: [
        { x: 0, y: 0 },
        { x: 88, y: 0 },
      ],
      head: [
        { x: 100, y: 0 },
        { x: 88, y: 6 },
        { x: 88, y: -6 },
      ],
    });
  });

  it('clamps the head to a short last segment', () => {
    const g = arrowGeometry([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 5, y: 50 },
    ]);
    expect(g.head).toEqual([
      { x: 5, y: 50 },
      { x: 0, y: 52.5 },
      { x: 0, y: 47.5 },
    ]);
    expect(g.stroke).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it('draws no head on a zero-length last segment', () => {
    const path = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(arrowGeometry(path)).toEqual({ stroke: path, head: null });
  });
});
