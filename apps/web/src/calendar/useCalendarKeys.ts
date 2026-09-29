import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from '../ui/typing';
import type { CalendarController } from './calendarController';

export type CalendarKeyAction =
  | 'today'
  | 'month'
  | 'week'
  | 'prev'
  | 'next'
  | 'new'
  | 'open'
  | 'delete'
  | 'deselect'
  | 'undo'
  | 'redo';

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** The calendar action a key press means, or null. */
export function calendarKey(e: KeyLike): CalendarKeyAction | null {
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (k === 'y') return 'redo';
    return null;
  }
  if (e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowRight':
      return 'next';
    case 'Enter':
      return 'open';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
      return 'deselect';
  }
  switch (e.key.toLowerCase()) {
    case 't':
      return 'today';
    case 'm':
      return 'month';
    case 'w':
      return 'week';
    case 'n':
      return 'new';
  }
  return null;
}

/** Focus is on a control whose own keys (Enter, arrows) must keep their native meaning. */
const onControl = (t: EventTarget | null) =>
  t instanceof Element &&
  t.closest('button, select, a[href], [role="menuitem"], [role="dialog"]') !== null;

/** Calendar shortcuts on a calendar page (dialogs stop their own keys). */
export function useCalendarKeys(session: BoardSession, ctl: CalendarController) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || onControl(e.target)) return;
      const { editor, question, selected } = ctl.ui.getState();
      if (editor || question) return;
      const action = calendarKey(e);
      if (!action) return;
      const canEdit = session.conn.clock.getState().role === 'edit';
      e.preventDefault();
      switch (action) {
        case 'today':
          return ctl.today();
        case 'month':
          return ctl.setView('month');
        case 'week':
          return ctl.setView('week');
        case 'prev':
          return ctl.step(-1);
        case 'next':
          return ctl.step(1);
        case 'new':
          return ctl.newEvent();
        case 'open':
          if (selected) ctl.openEditor(selected);
          return;
        case 'delete':
          if (selected && canEdit) ctl.remove(selected);
          return;
        case 'deselect':
          return ctl.select(null);
        case 'undo':
          if (canEdit) session.controller.undo();
          return;
        case 'redo':
          if (canEdit) session.controller.redo();
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, ctl]);
}
