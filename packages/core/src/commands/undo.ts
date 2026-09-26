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
  onChange(cb: () => void): () => void;
  destroy(): void;
}

const STACK_EVENTS = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const;

/**
 * Per-user undo: only transactions with this client's LOCAL or AI origin are
 * captured, so undo never reverts what a remote peer did. Undo/redo are
 * applied as ordinary Yjs transactions and sync to peers like any edit.
 */
export function createUndo(doc: Y.Doc, opts: { captureTimeout?: number } = {}): Undo {
  const { shapes, connectors } = getRoots(doc);
  const manager = new Y.UndoManager([shapes, connectors], {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN, AI_ORIGIN]),
    captureTimeout: opts.captureTimeout ?? 500,
  });
  return {
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    stopCapturing: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    onChange(cb) {
      for (const event of STACK_EVENTS) manager.on(event, cb);
      return () => {
        for (const event of STACK_EVENTS) manager.off(event, cb);
      };
    },
    destroy: () => manager.destroy(),
  };
}
