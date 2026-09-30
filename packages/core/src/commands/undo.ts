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
 * The root type `type` hangs from, following Yjs's internal `_item.parent` links (Yjs has no
 * public accessor). Anything unexpected ends the walk, so it never throws on a shape it does
 * not know; a cycle or a very deep chain gives null.
 */
function rootOf(type: unknown): unknown {
  let t = type;
  for (let depth = 0; depth < 1000; depth++) {
    const parent = (t as { _item?: { parent?: unknown } | null } | null | undefined)?._item?.parent;
    if (!parent || typeof parent !== 'object') return t;
    t = parent;
  }
  return null;
}

/**
 * Whether every type `types()` lists lies under `root` (at least one). It only labels an undo
 * toast, so it fails soft: if Yjs internals change and anything throws, the answer is false.
 */
export function onlyUnder(types: () => Iterable<unknown>, root: unknown): boolean {
  try {
    const list = [...types()];
    return list.length > 0 && list.every((t) => rootOf(t) === root);
  } catch {
    return false;
  }
}

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
  let onlyCalendars = false;
  manager.on('stack-item-popped', (e) => {
    onlyCalendars = onlyUnder(() => e.changedParentTypes.keys(), calendars);
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
