import {
  applyCommand,
  type Camera,
  type Command,
  centerOn as centredOn,
  contentBounds,
  createUndo,
  type Effect,
  fitBounds,
  type Identity,
  initialToolState,
  LOCAL_ORIGIN,
  type Point,
  type Preview,
  type Rect,
  step,
  type TextDiff,
  type ToolEvent,
  type ToolState,
  throttle,
  zoomAt,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DocState } from '../store/docStore';

/** Where the camera is remembered between visits (per room); failures just mean no restore. */
export interface CameraStorage {
  load(): Camera | null;
  save(camera: Camera): void;
}

export interface BoardUiState {
  tool: ToolState;
  preview: Preview | null;
  /** Local-only geometry for shapes being dragged/resized, rendered every frame. */
  overlay: Record<string, Rect> | null;
  editingId: string | null;
  editingColumn: { frameId: string; columnId: string } | null;
  camera: Camera;
  /** Canvas size in screen pixels; null until the canvas has been measured. */
  viewport: { w: number; h: number } | null;
  /** World position of the local pointer over the canvas (coordinates readout). */
  pointer: Point | null;
  /** Space is held: a left-drag pans instead of using the tool. */
  spaceHeld: boolean;
}

export interface BoardController {
  ui: StoreApi<BoardUiState>;
  dispatch(event: ToolEvent): void;
  setCamera(camera: Camera): void;
  setViewportSize(w: number, h: number): void;
  setPointer(p: Point | null): void;
  setSpaceHeld(held: boolean): void;
  /** Multiplies the zoom, keeping `anchor` (screen px; default: viewport centre) fixed. */
  zoomBy(factor: number, anchor?: Point): void;
  /** Back to 100% around the viewport centre. */
  resetZoom(): void;
  /** Keeps the zoom and centres the viewport on a world point. */
  centerOn(p: Point): void;
  /** The document finished its first sync: fit the content once if nothing set the camera. */
  markSynced(): void;
  applyText(id: string, diff: TextDiff): void;
  stopEditing(): void;
  renameColumn(frameId: string, columnId: string, title: string): void;
  stopEditingColumn(): void;
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
  cameraStorage?: CameraStorage;
}): BoardController {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  const stored = opts.cameraStorage?.load() ?? null;
  const ui = createStore<BoardUiState>(() => ({
    tool: initialToolState(),
    preview: null,
    overlay: null,
    editingId: null,
    editingColumn: null,
    camera: stored ?? { x: 0, y: 0, zoom: 1 },
    viewport: null,
    pointer: null,
    spaceHeld: false,
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
        case 'editColumn':
          ui.setState({ editingColumn: { frameId: effect.frameId, columnId: effect.columnId } });
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
    if (ui.getState().editingColumn) ui.setState({ editingColumn: null });
    ui.setState({ overlay: null, preview: null });
    if (direction === 'undo') undoStack.undo();
    else undoStack.redo();
  };

  // The initial fit happens once: after the first sync, once the canvas is measured, and
  // only if no camera was restored and the user has not moved it yet. It is not saved.
  let fitPending = stored === null;
  let synced = false;
  const tryFit = () => {
    const { viewport } = ui.getState();
    if (!fitPending || !synced || !viewport) return;
    fitPending = false;
    const bounds = contentBounds(opts.docStore.getState().shapes);
    if (bounds) ui.setState({ camera: fitBounds(bounds, viewport.w, viewport.h) });
  };

  const setCamera = (camera: Camera) => {
    fitPending = false;
    ui.setState({ camera });
    opts.cameraStorage?.save(camera);
  };

  const viewportCentre = (): Point => {
    const v = ui.getState().viewport;
    return v ? { x: v.w / 2, y: v.h / 2 } : { x: 0, y: 0 };
  };

  // Close the editor if the edited shape is deleted (locally, remotely or by undo).
  const unsubscribe = opts.docStore.subscribe((doc) => {
    const { editingId, editingColumn } = ui.getState();
    if (editingId && !doc.shapes[editingId]) stopEditing();
    if (editingColumn && doc.shapes[editingColumn.frameId]?.type !== 'frame') {
      ui.setState({ editingColumn: null });
    }
  });

  return {
    ui,
    dispatch(event) {
      // A user who draws before the first sync arrives has already started a gesture on
      // the canvas: the initial fit must not yank the camera out from under them later.
      if (event.type === 'pointerDown') fitPending = false;
      const { state, effects } = step(ui.getState().tool, event, {
        shapes: opts.docStore.getState().shapes,
        connectors: opts.docStore.getState().connectors,
        userId: opts.user.id,
        userName: opts.user.name,
        newId,
        now,
      });
      ui.setState({ tool: state });
      run(effects);
    },
    setCamera,
    setViewportSize(w, h) {
      const v = ui.getState().viewport;
      if (v && v.w === w && v.h === h) return;
      ui.setState({ viewport: { w, h } });
      tryFit();
    },
    setPointer(p) {
      ui.setState({ pointer: p });
    },
    setSpaceHeld(held) {
      if (ui.getState().spaceHeld !== held) ui.setState({ spaceHeld: held });
    },
    zoomBy(factor, anchor) {
      const cam = ui.getState().camera;
      setCamera(zoomAt(cam, anchor ?? viewportCentre(), cam.zoom * factor));
    },
    resetZoom() {
      setCamera(zoomAt(ui.getState().camera, viewportCentre(), 1));
    },
    centerOn(p) {
      const v = ui.getState().viewport;
      if (!v) return;
      setCamera(centredOn(ui.getState().camera, p, v.w, v.h));
    },
    markSynced() {
      synced = true;
      tryFit();
    },
    applyText(id, diff) {
      commit({ type: 'SetText', id, ...diff });
    },
    stopEditing,
    renameColumn(frameId, columnId, title) {
      commit({ type: 'RenameColumn', frameId, columnId, title });
      ui.setState({ editingColumn: null });
      undoStack.stopCapturing();
    },
    stopEditingColumn() {
      ui.setState({ editingColumn: null });
    },
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    destroy() {
      throttledCommit.cancel();
      unsubscribe();
      undoStack.destroy();
    },
  };
}
