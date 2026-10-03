import type { Point, ToolId } from '@relay/core';

/** Movement (px) under which a touch still counts as a tap or a press. */
export const TAP_SLOP = 10;
/** Holding a finger this long (ms) opens the context menu. */
export const LONG_PRESS_MS = 500;
/** Two taps this close in time (ms) and space (px) are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;

export interface Tap {
  x: number;
  y: number;
  /** Event time, ms. */
  t: number;
}

export const moved = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) > TAP_SLOP;

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  return (
    next.t - prev.t <= DOUBLE_TAP_MS &&
    Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX
  );
}

const SINGLE_PRESS: ReadonlySet<ToolId> = new Set(['sticky', 'text', 'code', 'comment']);

/**
 * Tools that act the moment a pointer goes down. For a finger they wait until it lifts, so the
 * first finger of a pinch or a long press never drops a sticky on the board.
 */
export const heldUntilLift = (tool: ToolId): boolean => SINGLE_PRESS.has(tool);

/** A resize handle's own size, and the finger-sized area it answers to on touch screens (px). */
export const HANDLE_PX = 9;
const HANDLE_HIT_PX = 26;

/**
 * The touch hit area of a resize handle (screen px) on a shape whose shorter side (for a line,
 * its length) is `extent` screen px. Finger-sized, but never more than a third of the shape, so
 * a small or zoomed-out shape keeps a middle to drag it by.
 */
export function handleHitPx(extent: number): number {
  return Math.min(HANDLE_HIT_PX, Math.max(HANDLE_PX, extent / 3));
}
