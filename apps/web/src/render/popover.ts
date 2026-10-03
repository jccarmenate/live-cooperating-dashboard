import type { Point } from '@relay/core';

/** Space kept between a popover and the board's edges (px). */
const MARGIN = 8;
/** Gap between a comment pin and its thread (px). */
const PIN_GAP = 4;

/** Where a `size` box that wants its top-left at `at` goes to stay inside `board` (px). */
export function clampBox(
  at: Point,
  size: { w: number; h: number },
  board: { w: number; h: number },
): Point {
  return {
    x: Math.max(MARGIN, Math.min(at.x, board.w - size.w - MARGIN)),
    y: Math.max(MARGIN, Math.min(at.y, board.h - size.h - MARGIN)),
  };
}

/**
 * Where a comment thread opens from its pin (top `pinTop`, `pinH` tall, board px): on the side
 * with more room, below on a tie, and the height it has there.
 */
export function threadPlacement(pinTop: number, pinH: number, boardH: number) {
  const roomAbove = pinTop - PIN_GAP - MARGIN;
  const roomBelow = boardH - (pinTop + pinH + PIN_GAP) - MARGIN;
  const above = roomAbove > roomBelow;
  return { above, room: above ? roomAbove : roomBelow };
}
