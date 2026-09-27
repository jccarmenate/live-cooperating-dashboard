import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { gateByRole, keyDownAction, keyUpAction, type ShortcutAction } from './shortcuts';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

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
      }
    };
    // The role is read at keydown time, so a late `hello` (or a role change) applies immediately.
    const onKeyDown = (e: KeyboardEvent) =>
      run(gateByRole(keyDownAction(e, isTyping(e.target)), conn.clock.getState().role), e);
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
