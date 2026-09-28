import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from '../ui/typing';
import type { SheetController } from './sheetController';

const ARROWS: Partial<Record<string, [number, number]>> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Focus is on an interactive control: its keys (Tab, Enter, arrows) keep their native meaning. */
function isControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, select, a[href], [role="menuitem"], [role="tab"], [role="option"]') !==
      null
  );
}

/** Grid keys on a sheet page (the formula bar and cell editor handle their own keys). */
export function useSheetKeys(session: BoardSession, ctl: SheetController | null) {
  useEffect(() => {
    if (!ctl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || isControl(e.target) || e.altKey || ctl.ui.getState().editing)
        return;
      const canEdit = session.conn.clock.getState().role === 'edit';
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'a') {
          e.preventDefault();
          ctl.selectAll();
        } else if (!canEdit) {
          return;
        } else if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) session.controller.redo();
          else session.controller.undo();
        } else if (k === 'y') {
          e.preventDefault();
          session.controller.redo();
        } else if (k === 'b') {
          e.preventDefault();
          ctl.toggleBold();
        } else if (k === 'd') {
          e.preventDefault();
          ctl.fillDown();
        }
        return;
      }
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        ctl.move(arrow[0], arrow[1], e.shiftKey);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        ctl.move(0, e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        ctl.move(e.shiftKey ? -1 : 1, 0);
        return;
      }
      if (!canEdit) return;
      if (e.key === 'F2') {
        e.preventDefault();
        ctl.startEdit();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        ctl.clear();
      } else if (e.key.length === 1) {
        e.preventDefault();
        ctl.startEdit(e.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, ctl]);
}
