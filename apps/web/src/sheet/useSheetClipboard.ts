import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { mayEdit } from '../sync/clock';
import { isTyping } from '../ui/typing';
import type { SheetController } from './sheetController';

/** Ctrl/⌘+C, X and V on a sheet: tab-separated text, compatible with Excel and Google Sheets. */
export function useSheetClipboard(session: BoardSession, ctl: SheetController | null) {
  useEffect(() => {
    if (!ctl) return;
    const skip = (e: ClipboardEvent) =>
      !e.clipboardData ||
      isTyping(e.target) ||
      ctl.ui.getState().editing !== null ||
      (e.target instanceof Element && e.target.closest('[role="dialog"]') !== null) ||
      // Selected page text (a header, a toast) copies natively; a paste still goes to the grid.
      (e.type !== 'paste' && window.getSelection()?.isCollapsed === false);
    const canEdit = () => mayEdit(session.conn.clock.getState());
    const onCopy = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const text = ctl.copy();
      if (text === null) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      const text = ctl.cut();
      if (text === null) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      if (ctl.paste(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [session, ctl]);
}
