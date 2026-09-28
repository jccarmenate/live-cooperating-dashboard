import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from './typing';

/** Board shortcuts and clipboard handlers act only on board pages. */
const onBoardPage = (session: BoardSession): boolean => {
  const { activePage, pages } = session.doc.getState();
  return pages.find((p) => p.id === activePage)?.type === 'board';
};

/**
 * Ctrl/⌘+C, X and V on the board use the browser's clipboard events: they carry the data
 * without a permission prompt. Inputs, dialogs and a text selection keep native behaviour.
 */
export function useClipboard(session: BoardSession) {
  useEffect(() => {
    const { controller, conn } = session;
    const skip = (e: ClipboardEvent) => {
      if (!onBoardPage(session)) return true;
      if (!e.clipboardData || isTyping(e.target)) return true;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return true;
      const selected = window.getSelection();
      return e.type !== 'paste' && !!selected && !selected.isCollapsed;
    };
    const canEdit = () => conn.clock.getState().role === 'edit';
    const onCopy = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const text = controller.copySelection();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      const text = controller.cutSelection();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (skip(e) || !canEdit()) return;
      if (controller.pasteText(e.clipboardData?.getData('text/plain') ?? '')) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [session]);
}
