import { dayNumber, formatDate, fromDayNumber, type Occurrence, parseDate } from '@relay/core';
import { useRef } from 'react';
import type { CalendarController, OccRef } from './calendarController';
import { occurrenceDays } from './layout';

/** Pointer travel (px) before a press on an event counts as a drag rather than a click. */
export const DRAG_THRESHOLD = 4;

/**
 * Where a day-drag puts an occurrence: its first day moved by the days between the day it was
 * grabbed on and the day it was dropped on (a multi-day bar grabbed in its middle keeps its
 * offset under the pointer). Null when nothing moves or a day is unknown.
 */
export function dropDate(
  firstDay: string,
  grabbedDate: string | null,
  droppedDate: string | null,
): string | null {
  const first = parseDate(firstDay);
  const from = parseDate(grabbedDate ?? '');
  const to = parseDate(droppedDate ?? '');
  if (!first || !from || !to) return null;
  const delta = dayNumber(to) - dayNumber(from);
  return delta === 0 ? null : formatDate(fromDayNumber(dayNumber(first) + delta));
}

/**
 * The day under a point. Bars are not inside a day cell and stay put during a drag, so the
 * topmost element may have no day: the elements below it are looked through.
 */
export function dateAt(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const date = el.closest<HTMLElement>('[data-date]')?.dataset.date;
    if (date) return date;
  }
  return null;
}

interface DayDrag {
  ref: OccRef;
  pointerId: number;
  /** The occurrence's first day in the viewer's zone. */
  first: string;
  grabbed: string | null;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * Pointer gestures on a day-level event (month chips and bars, week all-day bars): a click
 * selects; a drag onto another day moves it (see `dropDate`). A cancelled pointer or a lost
 * capture drops the gesture, so a later, unrelated release never commits it.
 */
export function useEventDrag(ctl: CalendarController, canEdit: boolean) {
  const drag = useRef<DayDrag | null>(null);
  // A finger opens the selected event with a second tap (iOS fires no reliable dblclick), so
  // the browser's own dblclick after a finger is ignored.
  const lastPointer = useRef('mouse');
  const mine = (e: React.PointerEvent) => drag.current?.pointerId === e.pointerId;
  const onPointerDown = (o: Occurrence) => (e: React.PointerEvent) => {
    lastPointer.current = e.pointerType;
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = {
      ref: { eventId: o.eventId, key: o.key },
      pointerId: e.pointerId,
      first: formatDate(fromDayNumber(occurrenceDays(o, ctl.zone).first)),
      grabbed: dateAt(e.clientX, e.clientY),
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && mine(e) && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD)
      d.moved = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !mine(e)) return;
    drag.current = null;
    if (!d.moved) {
      const sel = ctl.ui.getState().selected;
      const again = sel?.eventId === d.ref.eventId && sel.key === d.ref.key;
      if (e.pointerType === 'touch' && again) ctl.openEditor(d.ref);
      else ctl.select(d.ref);
      return;
    }
    if (!canEdit) return;
    const date = dropDate(d.first, d.grabbed, dateAt(e.clientX, e.clientY));
    if (date) ctl.move(d.ref, { date });
  };
  const onCancel = (e: React.PointerEvent) => {
    if (mine(e)) drag.current = null;
  };
  const onDoubleClick = (o: Occurrence) => () => {
    if (lastPointer.current !== 'touch') ctl.openEditor({ eventId: o.eventId, key: o.key });
  };
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onCancel,
    onLostPointerCapture: onCancel,
    onDoubleClick,
  };
}
