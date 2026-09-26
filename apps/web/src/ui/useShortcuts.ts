import type { ToolId } from '@relay/core';
import { useEffect } from 'react';
import type { BoardController } from '../board/controller';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  s: 'sticky',
  c: 'code',
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  );
}

export function useShortcuts(controller: BoardController) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          controller.undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          controller.redo();
        }
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool) {
        controller.dispatch({ type: 'setTool', tool });
        return;
      }
      const nudge = NUDGE[e.key];
      if (nudge) {
        e.preventDefault();
        const stepSize = e.shiftKey ? 10 : 1;
        controller.dispatch({ type: 'nudge', dx: nudge[0] * stepSize, dy: nudge[1] * stepSize });
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
