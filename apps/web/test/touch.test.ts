import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, heldUntilLift, isDoubleTap, moved, TAP_SLOP } from '../src/render/touch';

describe('touch gestures', () => {
  it('counts a finger as still within the tap slop', () => {
    expect(moved({ x: 0, y: 0 }, { x: TAP_SLOP, y: 0 })).toBe(false);
    expect(moved({ x: 0, y: 0 }, { x: 8, y: 8 })).toBe(true);
  });

  it('spots a double tap: close in time and space, after a first tap', () => {
    const first = { x: 100, y: 100, t: 1000 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { x: 110, y: 95, t: 1200 })).toBe(true);
    expect(isDoubleTap(first, { x: 100, y: 100, t: 1000 + DOUBLE_TAP_MS + 1 })).toBe(false);
    expect(isDoubleTap(first, { x: 160, y: 100, t: 1100 })).toBe(false);
  });

  it('holds single-press tools until the finger lifts, and lets drag tools start at once', () => {
    for (const tool of ['sticky', 'text', 'code', 'comment'] as const) {
      expect(heldUntilLift(tool)).toBe(true);
    }
    for (const tool of ['select', 'rect', 'connector', 'frame'] as const) {
      expect(heldUntilLift(tool)).toBe(false);
    }
  });
});
