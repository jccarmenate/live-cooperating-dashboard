import type { Role, ToolEvent, ToolId } from '@relay/core';

/** The parts of a KeyboardEvent the shortcut table reads (plain objects in tests). */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Physical key (layout-independent), e.g. 'Digit1'. */
  code?: string;
}

export type ShortcutAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'space'; held: boolean }
  | { type: 'dispatch'; event: ToolEvent; preventDefault: boolean }
  | { type: 'duplicate' }
  | { type: 'selectAll' }
  | { type: 'z'; where: 'front' | 'back' }
  | { type: 'zoomToFit' }
  | { type: 'help' }
  | { type: 'graphMenu' };

export const TOOL_KEYS: Record<string, ToolId> = {
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
    if (key === 'd' && !e.shiftKey) return { type: 'duplicate' };
    if (key === 'a' && !e.shiftKey) return { type: 'selectAll' };
    return null;
  }
  if (e.key === ' ') return { type: 'space', held: true };
  if (e.key === '?') return { type: 'help' };
  if (key === 'g') return { type: 'graphMenu' };
  if (e.shiftKey && e.code === 'Digit1') return { type: 'zoomToFit' };
  if (e.key === ']') return { type: 'z', where: 'front' };
  if (e.key === '[') return { type: 'z', where: 'back' };
  // By physical key too: on AltGr layouts (e.g. Spanish) the characters need AltGr, which
  // arrives as Alt (dropped above), so the plain key where [ and ] sit on US keyboards works.
  if (e.code === 'BracketRight') return { type: 'z', where: 'front' };
  if (e.code === 'BracketLeft') return { type: 'z', where: 'back' };
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

/** Tool events that change the document. */
const MUTATING_EVENTS: ReadonlySet<ToolEvent['type']> = new Set([
  'deleteSelection',
  'nudge',
  'toggleRouting',
]);

/**
 * Drops shortcuts the role may not use: only editors change the document (delete, nudge,
 * routing, duplicate, restack, undo, redo) or pick the comment tool. The server drops a
 * viewer's updates anyway; this keeps the viewer's local doc and IndexedDB from forking.
 */
export function gateByRole(
  action: ShortcutAction | null,
  role: Role | null,
): ShortcutAction | null {
  if (!action || role === 'edit') return action;
  switch (action.type) {
    case 'duplicate':
    case 'z':
    case 'undo':
    case 'redo':
      return null;
    case 'dispatch': {
      const { event } = action;
      if (MUTATING_EVENTS.has(event.type)) return null;
      if (event.type === 'setTool' && event.tool === 'comment') return null;
      return action;
    }
    default:
      return action;
  }
}

/** Releasing Space always leaves pan mode, even if focus moved into an editor meanwhile. */
export function keyUpAction(e: KeyInput): ShortcutAction | null {
  return e.key === ' ' ? { type: 'space', held: false } : null;
}
