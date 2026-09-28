import {
  applyCommand,
  type Camera,
  type Command,
  type CommentAnchor,
  centerOn as centredOn,
  contentBounds,
  createUndo,
  type Effect,
  fitBounds,
  type Identity,
  initialToolState,
  isVoteOpen,
  LOCAL_ORIGIN,
  MAX_BOARD_TITLE,
  MAX_PAGE_TITLE,
  orderBetween,
  type PageType,
  type Point,
  type Preview,
  type Rect,
  SESSION_ORIGIN,
  step,
  type TextDiff,
  type ToolEvent,
  type ToolState,
  throttle,
  VOTES_PER_USER,
  voteKey,
  voteTallies,
  zoomAt,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ActivityState } from '../store/activityStore';
import type { DocState } from '../store/docStore';

/** Where the camera is remembered between visits (per room and page); failures just mean no restore. */
export interface CameraStorage {
  load(pageId: string): Camera | null;
  save(pageId: string, camera: Camera): void;
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
  /** Open comment composer (comment tool click). */
  composer: { anchor: CommentAnchor; at: Point } | null;
  /** Thread whose popover is open. */
  openThread: string | null;
  commentsPanel: boolean;
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
  startVote(minutes: number): void;
  endVote(): void;
  /** Casts or retracts the local user's vote on a sticky while a vote is open (cap enforced). */
  toggleVote(shapeId: string): void;
  /** Posts the composer's comment (trimmed; empty cancels). */
  addComment(body: string): void;
  cancelComposer(): void;
  replyComment(threadId: string, body: string): void;
  resolveComment(threadId: string, resolved: boolean): void;
  openThread(id: string | null): void;
  toggleCommentsPanel(): void;
  /** Switches the active page (an unknown or deleted one falls back to the first visible page). */
  setPage(id: string): void;
  /** Appends a page of `type` after the last one; returns the new id. */
  createPage(type: PageType): string;
  /** Renames a page (trimmed; empty is ignored). */
  renamePage(id: string, title: string): void;
  /** Moves a page to `toIndex` among the visible pages. */
  movePage(id: string, toIndex: number): void;
  /**
   * Deletes a page and everything on it; never the last visible page (nor one that is not visible).
   * Returns whether it deleted.
   */
  deletePage(id: string): boolean;
  /** Renames the board (trimmed; empty is ignored). */
  renameBoard(title: string): void;
  destroy(): void;
}

/** Undo steps are delimited explicitly (gesture end, text-session end), not by time. */
const UNDO_CAPTURE_TIMEOUT = 60_000;

export function createBoardController(opts: {
  doc: Y.Doc;
  docStore: StoreApi<DocState>;
  /** Asks the doc store to project another page. */
  setPage: (id: string) => void;
  activity: StoreApi<ActivityState>;
  user: Identity;
  newId?: () => string;
  now?: () => number;
  serverNow?: () => number;
  cameraStorage?: CameraStorage;
}): BoardController {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  const serverNow = opts.serverNow ?? Date.now;
  const activePage = () => opts.docStore.getState().activePage;
  const stored = opts.cameraStorage?.load(activePage()) ?? null;
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
    composer: null,
    openThread: null,
    commentsPanel: false,
  }));
  const undoStack = createUndo(opts.doc, { captureTimeout: UNDO_CAPTURE_TIMEOUT });

  const commit = (command: Command) => applyCommand(opts.doc, command, LOCAL_ORIGIN);
  const throttledCommit = throttle(commit, 50);
  const commitSession = (command: Command) => applyCommand(opts.doc, command, SESSION_ORIGIN);
  // Page commands touch untracked roots, except DeletePage, which also deletes the page's
  // shapes: on SESSION_ORIGIN a page delete never becomes an undo step that resurrects
  // shapes on a tombstoned page.
  const commitPage = (command: Command) => applyCommand(opts.doc, command, SESSION_ORIGIN);

  /** New shapes and connectors land on the active page. */
  const withPage = (c: Command): Command => {
    const pageId = activePage();
    if (c.type === 'CreateShape') return { ...c, shape: { ...c.shape, pageId } };
    if (c.type === 'Connect') return { ...c, connector: { ...c.connector, pageId } };
    return c;
  };

  const run = (effects: Effect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'command':
          if (effect.throttle) {
            throttledCommit(withPage(effect.command));
          } else {
            throttledCommit.cancel();
            commit(withPage(effect.command));
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
        case 'compose':
          ui.setState({ composer: { anchor: effect.anchor, at: effect.at } });
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
    opts.cameraStorage?.save(activePage(), camera);
  };

  const viewportCentre = (): Point => {
    const v = ui.getState().viewport;
    return v ? { x: v.w / 2, y: v.h / 2 } : { x: 0, y: 0 };
  };

  const unsubscribe = opts.docStore.subscribe((doc, prev) => {
    // A page change (local, or a remote fallback when the active page is deleted) starts
    // fresh: no gesture, editor or popover carries over, undo cannot reach the old page,
    // and the camera is that page's stored one (or a fit once the canvas allows it).
    if (doc.activePage !== prev.activePage) {
      throttledCommit.cancel();
      undoStack.clear();
      const stored = opts.cameraStorage?.load(doc.activePage) ?? null;
      fitPending = stored === null;
      ui.setState({
        tool: { mode: 'idle', tool: ui.getState().tool.tool, selection: [] },
        preview: null,
        overlay: null,
        editingId: null,
        editingColumn: null,
        composer: null,
        openThread: null,
        camera: stored ?? { x: 0, y: 0, zoom: 1 },
      });
      tryFit();
    }
    // Close the editor if the edited shape is deleted (locally, remotely or by undo).
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
      // A canvas press closes any open thread popover or composer (the comment tool reopens one).
      if (event.type === 'pointerDown') ui.setState({ openThread: null, composer: null });
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
    startVote(minutes) {
      commitSession({
        type: 'StartVote',
        endsAt: serverNow() + minutes * 60_000,
        maxPerUser: VOTES_PER_USER,
        startedBy: opts.user.id,
      });
    },
    endVote() {
      commitSession({ type: 'EndVote' });
    },
    toggleVote(shapeId) {
      const { vote, voteKeys } = opts.activity.getState();
      if (!vote || !isVoteOpen(vote, serverNow())) return;
      // The vote is room-wide: the sticky and the cap count across every visible page.
      const shapes = opts.docStore.getState().allShapes;
      if (shapes[shapeId]?.type !== 'sticky') return;
      if (voteKeys.includes(voteKey(shapeId, opts.user.id))) {
        commitSession({ type: 'RetractVote', shapeId, userId: opts.user.id });
        return;
      }
      const mine = voteTallies(voteKeys, shapes, vote.maxPerUser).byUser[opts.user.id]?.length ?? 0;
      if (mine >= vote.maxPerUser) return;
      commitSession({ type: 'CastVote', shapeId, userId: opts.user.id });
    },
    addComment(body) {
      const composer = ui.getState().composer;
      const text = body.trim();
      ui.setState({ composer: null });
      if (!composer || !text) return;
      const id = newId();
      commitSession({
        type: 'AddComment',
        id,
        pageId: activePage(),
        anchor: composer.anchor,
        createdBy: opts.user.id,
        createdAt: now(),
        entry: {
          id: newId(),
          authorId: opts.user.id,
          author: opts.user.name,
          body: text,
          ts: now(),
        },
      });
      ui.setState({ openThread: id });
    },
    cancelComposer() {
      ui.setState({ composer: null });
    },
    replyComment(threadId, body) {
      const text = body.trim();
      if (!text) return;
      commitSession({
        type: 'ReplyComment',
        commentId: threadId,
        entry: {
          id: newId(),
          authorId: opts.user.id,
          author: opts.user.name,
          body: text,
          ts: now(),
        },
      });
    },
    resolveComment(threadId, resolved) {
      commitSession({ type: 'ResolveComment', id: threadId, resolved });
    },
    openThread(id) {
      ui.setState({ openThread: id });
    },
    toggleCommentsPanel() {
      ui.setState({ commentsPanel: !ui.getState().commentsPanel });
    },
    setPage(id) {
      opts.setPage(id);
    },
    createPage(type) {
      const pages = opts.docStore.getState().pages;
      const id = newId();
      const sameType = pages.filter((p) => p.type === type).length;
      const label = type === 'board' ? 'Board' : type === 'sheet' ? 'Sheet' : 'Calendar';
      commitPage({
        type: 'CreatePage',
        page: {
          id,
          type,
          title: `${label} ${sameType + 1}`.slice(0, MAX_PAGE_TITLE),
          order: orderBetween(pages.at(-1)?.order ?? null, null),
          createdBy: opts.user.id,
          createdAt: now(),
        },
      });
      return id;
    },
    renamePage(id, title) {
      const text = title.trim().slice(0, MAX_PAGE_TITLE);
      if (text) commitPage({ type: 'RenamePage', id, title: text });
    },
    movePage(id, toIndex) {
      const others = opts.docStore.getState().pages.filter((p) => p.id !== id);
      const i = Math.max(0, Math.min(toIndex, others.length));
      commitPage({
        type: 'MovePage',
        id,
        order: orderBetween(others[i - 1]?.order ?? null, others[i]?.order ?? null),
      });
    },
    deletePage(id) {
      const pages = opts.docStore.getState().pages;
      if (pages.length <= 1 || !pages.some((p) => p.id === id)) return false;
      commitPage({ type: 'DeletePage', id });
      return true;
    },
    renameBoard(title) {
      const text = title.trim().slice(0, MAX_BOARD_TITLE);
      if (text) commitPage({ type: 'RenameBoard', title: text });
    },
    destroy() {
      throttledCommit.cancel();
      unsubscribe();
      undoStack.destroy();
    },
  };
}
