import { useEffect } from 'react';
import type { BoardController } from '../board/controller';
import { keyDownAction, keyUpAction, type ShortcutAction } from './shortcuts';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export function useShortcuts(controller: BoardController) {
  useEffect(() => {
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
    const onKeyDown = (e: KeyboardEvent) => run(keyDownAction(e, isTyping(e.target)), e);
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
  }, [controller]);
}
