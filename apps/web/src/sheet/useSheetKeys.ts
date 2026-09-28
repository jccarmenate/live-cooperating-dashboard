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

/**
 * The character a key types into a cell, or null for shortcuts and non-printable keys. AltGr
 * (reported as Ctrl+Alt on Windows) and Option on macOS type characters such as `@` or `€`;
 * other Ctrl, Cmd and Alt combinations do not.
 */
export function typedChar(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>,
  mac: boolean,
): string | null {
  if (e.key.length !== 1 || e.metaKey) return null;
  if (e.altKey) return e.ctrlKey !== mac ? e.key : null;
  return e.ctrlKey ? null : e.key;
}

/** Grid keys on a sheet page (the formula bar and cell editor handle their own keys). */
export function useSheetKeys(session: BoardSession, ctl: SheetController | null) {
  useEffect(() => {
    if (!ctl) return;
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || isControl(e.target) || ctl.ui.getState().editing) return;
      const char = typedChar(e, mac);
      if (e.altKey && char === null) return;
      // Escape on the grid itself lets keyboard users move on (Tab moves between cells).
      if (
        e.key === 'Escape' &&
        e.target instanceof HTMLElement &&
        e.target.hasAttribute('data-sheet-grid')
      ) {
        e.target.blur();
        return;
      }
      const canEdit = session.conn.clock.getState().role === 'edit';
      if ((e.ctrlKey || e.metaKey) && char === null) {
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
      } else if (char !== null) {
        e.preventDefault();
        ctl.startEdit(char);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, ctl]);
}
