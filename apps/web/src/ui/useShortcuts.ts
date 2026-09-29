import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { onBoardPage } from './pageKind';
import { gateByRole, keyDownAction, keyUpAction, type ShortcutAction } from './shortcuts';
import { isTyping } from './typing';

export function useShortcuts(session: BoardSession) {
  useEffect(() => {
    const { controller, conn } = session;
    const run = (action: ShortcutAction | null, e: KeyboardEvent) => {
      if (!action) return;
      switch (action.type) {
        case 'undo':
          e.preventDefault();
          controller.undo();
          break;
        case 'redo':
          e.preventDefault();
          controller.redo();
          break;
        case 'space':
          // Holding Space must not scroll the page or press a focused button.
          if (action.held) e.preventDefault();
          controller.setSpaceHeld(action.held);
          break;
        case 'dispatch':
          if (action.preventDefault) e.preventDefault();
          controller.dispatch(action.event);
          break;
        case 'duplicate':
          e.preventDefault();
          controller.duplicate();
          break;
        case 'selectAll':
          e.preventDefault();
          controller.selectAll();
          break;
        case 'z':
          controller.setZ(action.where);
          break;
        case 'zoomToFit':
          controller.zoomToFit();
          break;
        case 'help':
          e.preventDefault();
          controller.setHelp(true);
          break;
        case 'graphMenu':
          e.preventDefault();
          controller.setGraphMenu(!controller.ui.getState().graphMenu);
          break;
      }
    };
    // The role is read at keydown time, so a late `hello` (or a role change) applies immediately.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!onBoardPage(session)) return;
      run(gateByRole(keyDownAction(e, isTyping(e.target)), conn.clock.getState().role), e);
    };
    const onKeyUp = (e: KeyboardEvent) => run(keyUpAction(e), e);
    const onBlur = () => controller.setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [session]);
}
