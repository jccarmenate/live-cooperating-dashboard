import type { ToolId } from '@relay/core';
import { useEffect } from 'react';
import type { BoardController } from '../board/controller';

const TOOL_KEYS: Record<string, ToolId> = { v: 'select', r: 'rect', t: 'text', s: 'sticky' };

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export function useShortcuts(controller: BoardController) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) {
        controller.dispatch({ type: 'setTool', tool });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        controller.dispatch({ type: 'deleteSelection' });
      } else if (e.key === 'Escape') {
        controller.dispatch({ type: 'cancel' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
}
