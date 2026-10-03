import type { Rect } from '@relay/core';

/** Space kept between a revealed box and the edge of the visible area (px). */
const MARGIN = 16;

/** The move along one axis that puts [start, start + size] inside [lo, hi]; the start wins. */
function axis(start: number, size: number, lo: number, hi: number): number {
  if (start < lo || size > hi - lo) return lo - start;
  if (start + size > hi) return hi - (start + size);
  return 0;
}

/**
 * The pan (screen px) that brings `box` inside `visible`, a margin away from its edges. A box
 * larger than the room shows its top-left corner. Used to keep the text being edited above the
 * on-screen keyboard.
 */
export function revealPan(box: Rect, visible: Rect): { dx: number; dy: number } {
  return {
    dx: axis(box.x, box.w, visible.x + MARGIN, visible.x + visible.w - MARGIN),
    dy: axis(box.y, box.h, visible.y + MARGIN, visible.y + visible.h - MARGIN),
  };
}
