import {
  applyCommand,
  type Camera,
  type Command,
  createUndo,
  type Effect,
  type Identity,
  initialToolState,
  LOCAL_ORIGIN,
  type Preview,
  type Rect,
  step,
  type TextDiff,
  type ToolEvent,
  type ToolState,
  throttle,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DocState } from '../store/docStore';

export interface BoardUiState {
  tool: ToolState;
  preview: Preview | null;
  /** Local-only geometry for shapes being dragged/resized, rendered every frame. */
  overlay: Record<string, Rect> | null;
  editingId: string | null;
  camera: Camera;
}

export interface BoardController {
  ui: StoreApi<BoardUiState>;
  dispatch(event: ToolEvent): void;
  setCamera(camera: Camera): void;
  applyText(id: string, diff: TextDiff): void;
  stopEditing(): void;
  undo(): void;
  redo(): void;
  destroy(): void;
}

/** Undo steps are delimited explicitly (gesture end, text-session end), not by time. */
const UNDO_CAPTURE_TIMEOUT = 60_000;

export function createBoardController(opts: {
  doc: Y.Doc;
  docStore: StoreApi<DocState>;
  user: Identity;
  newId?: () => string;
  now?: () => number;
}): BoardController {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  const ui = createStore<BoardUiState>(() => ({
    tool: initialToolState(),
    preview: null,
    overlay: null,
    editingId: null,
    camera: { x: 0, y: 0, zoom: 1 },
  }));
  const undoStack = createUndo(opts.doc, { captureTimeout: UNDO_CAPTURE_TIMEOUT });

  const commit = (command: Command) => applyCommand(opts.doc, command, LOCAL_ORIGIN);
  const throttledCommit = throttle(commit, 50);

  const run = (effects: Effect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'command':
          if (effect.throttle) {
            throttledCommit(effect.command);
          } else {
            throttledCommit.cancel();
            commit(effect.command);
          }
          break;
        case 'preview':
          ui.setState({ preview: effect.preview });
          break;
        case 'overlay':
          ui.setState({ overlay: effect.rects });
          break;
        case 'editText':
          ui.setState({ editingId: effect.id });
          break;
        case 'endGesture':
          undoStack.stopCapturing();
          break;
      }
    }
  };

  const stopEditing = () => {
    ui.setState({ editingId: null });
    undoStack.stopCapturing();
  };

  const travel = (direction: 'undo' | 'redo') => {
    if (ui.getState().tool.mode !== 'idle') return;
    throttledCommit.cancel();
    if (ui.getState().editingId) stopEditing();
    ui.setState({ overlay: null, preview: null });
    if (direction === 'undo') undoStack.undo();
    else undoStack.redo();
  };

  // Close the editor if the edited shape is deleted (locally, remotely or by undo).
  const unsubscribe = opts.docStore.subscribe((doc) => {
    const { editingId } = ui.getState();
    if (editingId && !doc.shapes[editingId]) stopEditing();
  });

  return {
    ui,
    dispatch(event) {
      const { state, effects } = step(ui.getState().tool, event, {
        shapes: opts.docStore.getState().shapes,
        userId: opts.user.id,
        userName: opts.user.name,
        newId,
        now,
      });
      ui.setState({ tool: state });
      run(effects);
    },
    setCamera(camera) {
      ui.setState({ camera });
    },
    applyText(id, diff) {
      commit({ type: 'SetText', id, ...diff });
    },
    stopEditing,
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    destroy() {
      throttledCommit.cancel();
      unsubscribe();
      undoStack.destroy();
    },
  };
}
