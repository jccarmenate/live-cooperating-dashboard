import * as Y from 'yjs';
import { getRoots } from '../schema/doc';
import { AI_ORIGIN, LOCAL_ORIGIN } from './origins';

export interface Undo {
  undo(): boolean;
  redo(): boolean;
  /** Ends the current undo step; the next local change starts a new one. */
  stopCapturing(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Whether the last undo or redo changed calendar events and nothing else. */
  lastOnlyCalendars(): boolean;
  onChange(cb: () => void): () => void;
  /** Empties the undo and redo stacks. */
  clear(): void;
  destroy(): void;
}

const STACK_EVENTS = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const;

/**
 * Per-user undo: only transactions with this client's LOCAL or AI origin are
 * captured, so undo never reverts what a remote peer did. Undo/redo are
 * applied as ordinary Yjs transactions and sync to peers like any edit.
 */
export function createUndo(doc: Y.Doc, opts: { captureTimeout?: number } = {}): Undo {
  const { shapes, connectors, sheets, calendars } = getRoots(doc);
  const manager = new Y.UndoManager([shapes, connectors, sheets, calendars], {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN, AI_ORIGIN]),
    captureTimeout: opts.captureTimeout ?? 500,
  });
  type Node = { _item: Y.Item | null };
  const rootOf = (type: Node): Node => {
    let t = type;
    while (t._item) t = t._item.parent as Node;
    return t;
  };
  let onlyCalendars = false;
  manager.on('stack-item-popped', (e) => {
    const types = [...e.changedParentTypes.keys()];
    onlyCalendars = types.length > 0 && types.every((t) => rootOf(t) === calendars);
  });
  return {
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    stopCapturing: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    lastOnlyCalendars: () => onlyCalendars,
    onChange(cb) {
      for (const event of STACK_EVENTS) manager.on(event, cb);
      return () => {
        for (const event of STACK_EVENTS) manager.off(event, cb);
      };
    },
    clear: () => manager.clear(),
    destroy: () => manager.destroy(),
  };
}
