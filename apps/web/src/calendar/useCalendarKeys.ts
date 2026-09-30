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

/** Dialogs stop their own keys. */
export const DIALOG_SELECTOR = '[role="dialog"]';
/** Selects and menus use arrows, Enter and Space to pick. */
export const LIST_SELECTOR =
  'select, [role="menu"], [role="menuitem"], [role="listbox"], [role="option"]';
/** Buttons and links use Enter and Space to activate. */
export const BUTTON_SELECTOR = 'button, a[href]';

const PICK_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ']);
const PRESS_KEYS = new Set(['Enter', ' ']);

/**
 * Whether a key keeps its native meaning on the focused element. A header button clicked a
 * moment ago keeps focus, so only its own keys (Enter, Space) are left to it: letters, arrows,
 * Delete, Escape and Ctrl+Z still reach the calendar.
 */
export function keyLeftToFocus(
  target: { closest(selector: string): unknown } | null,
  key: string,
): boolean {
  if (!target) return false;
  if (target.closest(DIALOG_SELECTOR)) return true;
  if (target.closest(LIST_SELECTOR)) return PICK_KEYS.has(key);
  if (target.closest(BUTTON_SELECTOR)) return PRESS_KEYS.has(key);
  return false;
}

/** Calendar shortcuts on a calendar page (dialogs stop their own keys). */
export function useCalendarKeys(session: BoardSession, ctl: CalendarController) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (keyLeftToFocus(e.target instanceof Element ? e.target : null, e.key)) return;
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
