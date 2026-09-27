import type { ToolEvent, ToolId } from '@relay/core';

/** The parts of a KeyboardEvent the shortcut table reads (plain objects in tests). */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type ShortcutAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'space'; held: boolean }
  | { type: 'dispatch'; event: ToolEvent; preventDefault: boolean };

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  s: 'sticky',
  c: 'code',
  a: 'connector',
  f: 'frame',
  m: 'comment',
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const dispatch = (event: ToolEvent, preventDefault = false): ShortcutAction => ({
  type: 'dispatch',
  event,
  preventDefault,
});

/** What a keydown means on the board; `typing` = focus is in an editable element. */
export function keyDownAction(e: KeyInput, typing: boolean): ShortcutAction | null {
  if (typing || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z' && !e.shiftKey) return { type: 'undo' };
    if ((key === 'z' && e.shiftKey) || key === 'y') return { type: 'redo' };
    return null;
  }
  if (e.key === ' ') return { type: 'space', held: true };
  if (key === 'e') return dispatch({ type: 'toggleRouting' });
  const tool = TOOL_KEYS[key];
  if (tool) return dispatch({ type: 'setTool', tool });
  const nudge = NUDGE[e.key];
  if (nudge) {
    const size = e.shiftKey ? 10 : 1;
    return dispatch({ type: 'nudge', dx: nudge[0] * size, dy: nudge[1] * size }, true);
  }
  if (e.key === 'Delete' || e.key === 'Backspace')
    return dispatch({ type: 'deleteSelection' }, true);
  if (e.key === 'Escape') return dispatch({ type: 'cancel' });
  return null;
}

/** Releasing Space always leaves pan mode, even if focus moved into an editor meanwhile. */
export function keyUpAction(e: KeyInput): ShortcutAction | null {
  return e.key === ' ' ? { type: 'space', held: false } : null;
}
