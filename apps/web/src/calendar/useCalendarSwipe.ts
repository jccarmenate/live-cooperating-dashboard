import { type RefObject, useEffect } from 'react';
import type { CalendarController } from './calendarController';

/**
 * Weeks a vertical swipe has travelled: one per grid row, a swipe up (the finger moving to a
 * smaller y) showing later weeks, as content scrolled by a finger would.
 */
export function swipeWeeks(startY: number, y: number, rowPx: number): number {
  return rowPx > 0 ? Math.trunc((startY - y) / rowPx) : 0;
}

/**
 * Touch counterpart of the month view's mouse wheel: a vertical swipe on the 6-week grid rolls
 * it a week per row. Swipes that start on an event (a drag) or in the "+N more" list are left
 * alone. The grid is `touch-none` on touch screens, so the browser never takes the swipe.
 */
export function useCalendarSwipe(ref: RefObject<HTMLElement | null>, ctl: CalendarController) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let swipe: { pointerId: number; y: number; applied: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('[data-testid="cal-event"], [data-testid="cal-day-popover"]')) return;
      swipe = { pointerId: e.pointerId, y: e.clientY, applied: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (swipe?.pointerId !== e.pointerId) return;
      const n = swipeWeeks(swipe.y, e.clientY, el.clientHeight / 6) - swipe.applied;
      if (n === 0) return;
      swipe.applied += n;
      ctl.scrollWeeks(n);
    };
    const onEnd = (e: PointerEvent) => {
      if (swipe?.pointerId === e.pointerId) swipe = null;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
    };
  }, [ref, ctl]);
}
