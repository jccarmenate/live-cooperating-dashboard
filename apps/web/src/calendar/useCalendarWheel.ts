import { type RefObject, useEffect } from 'react';
import type { CalendarController } from './calendarController';

/** Wheel distance (px) that moves one week: one notch of a mouse wheel. */
const WEEK_PX = 100;
/** A pause this long (ms) forgets a partial step. */
const RESET_MS = 250;
/** One wheel event moves at most this many weeks (a fast flick of a free-spinning wheel). */
const MAX_WEEKS = 3;

export interface WheelState {
  acc: number;
  at: number;
}

export const newWheel = (): WheelState => ({ acc: 0, at: Number.NEGATIVE_INFINITY });

/**
 * Weeks to move for a wheel delta (px, down positive) at time `now` (ms). Small trackpad deltas
 * add up to whole weeks; a pause or a change of direction starts over.
 */
export function wheelWeeks(w: WheelState, dy: number, now: number): number {
  if (now - w.at > RESET_MS || Math.sign(dy) !== Math.sign(w.acc)) w.acc = 0;
  w.at = now;
  w.acc += dy;
  const weeks = Math.trunc(w.acc / WEEK_PX);
  if (weeks === 0) return 0;
  if (Math.abs(weeks) > MAX_WEEKS) {
    w.acc = 0;
    return Math.sign(weeks) * MAX_WEEKS;
  }
  w.acc -= weeks * WEEK_PX;
  return weeks;
}

/** Wheel deltas in pixels, whatever unit the device reports them in. */
function pixels(e: WheelEvent, delta: number): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * window.innerHeight;
  return delta;
}

/**
 * The mouse wheel scrolls the calendar by weeks: the month grid rolls a row, the week view moves
 * a week. In the week view, Shift+wheel scrolls the hours. Ctrl+wheel (browser zoom), and the
 * wheel inside dialogs and the "+N more" list, are left alone.
 */
export function useCalendarWheel(ref: RefObject<HTMLElement | null>, ctl: CalendarController) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const state = newWheel();
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[role="dialog"], [data-testid="cal-day-popover"]')
      )
        return;
      const hours = el.querySelector<HTMLElement>('[data-week-scroller]');
      if (e.shiftKey && hours && ctl.ui.getState().view === 'week') {
        // Browsers turn Shift+wheel into a horizontal delta: use it for the hours.
        e.preventDefault();
        hours.scrollTop += pixels(e, e.deltaY || e.deltaX);
        return;
      }
      const dy = pixels(e, e.deltaY);
      if (dy === 0) return;
      e.preventDefault();
      const weeks = wheelWeeks(state, dy, e.timeStamp);
      if (weeks !== 0) ctl.scrollWeeks(weeks);
    };
    // Non-passive, so preventDefault can stop the week grid's own scrolling.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, ctl]);
}
