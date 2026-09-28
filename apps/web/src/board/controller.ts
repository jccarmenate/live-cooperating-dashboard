import {
  applyCommand,
  type Camera,
  type ClipPayload,
  type Command,
  type CommentAnchor,
  centerOn as centredOn,
  childrenOf,
  contentBounds,
  copyPayload,
  createUndo,
  DEFAULT_SIZE,
  type Effect,
  fitBounds,
  type Identity,
  initialToolState,
  isVoteOpen,
  LOCAL_ORIGIN,
  MAX_BOARD_TITLE,
  MAX_PAGE_TITLE,
  type NewConnector,
  type NewShape,
  orderBetween,
  PASTE_OFFSET,
  type PageType,
  type Point,
  type Preview,
  parseClip,
  pastePlan,
  plainTextSticky,
  type Rect,
  type Routing,
  SESSION_ORIGIN,
  type StylePatch,
  screenToWorld,
  serializeClip,
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

/** An open canvas context menu. */
export interface CanvasMenuState {
  /** Client coordinates where it opens. */
  screen: Point;
  /** The world point that was right-clicked. */
  world: Point;
  /** Shape under the pointer, if any. */
  hitId: string | null;
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
  menu: CanvasMenuState | null;
  /** The keyboard shortcuts dialog is open. */
  help: boolean;
  /** The document finished its first sync. */
  synced: boolean;
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
  /** Replaces the selection (only between gestures) and switches to the select tool. */
  select(ids: string[]): void;
  /** Selects every shape and connector on the active page. */
  selectAll(): void;
  /** Opens the canvas menu; a hit outside the selection becomes the selection, empty canvas clears it. */
  openMenu(at: {
    screen: Point;
    world: Point;
    hitId: string | null;
    connectorId: string | null;
  }): void;
  closeMenu(): void;
  /** Serialises the selection as a Relay clip and remembers it; null when nothing is copyable. */
  copySelection(): string | null;
  /**
   * Copies, then deletes exactly what was cut, minus locked shapes (one undo step).
   * Null mid-gesture or when nothing is copyable.
   */
  cutSelection(): string | null;
  /** The last clip this controller copied (in-app clipboard fallback). */
  lastCopied(): string | null;
  /**
   * Pastes a Relay clip (centred on `at`, or stepped +24 px per repeat) or plain text as a
   * sticky, selected, as one undo step. Returns whether anything was pasted.
   */
  pasteText(text: string, at?: Point): boolean;
  /** Copies the selection at +24 px without touching the clipboard. */
  duplicate(): void;
  setZ(where: 'front' | 'back'): void;
  /** Restyles the selected unlocked shapes. */
  setStyle(patch: StylePatch): void;
  /** Locks the selected shapes, or unlocks them when all are already locked. */
  toggleLock(): void;
  setHead(head: 'arrow' | 'none'): void;
  setRouting(routing: Routing): void;
  /** Creates a shape at a world point as if the tool were clicked there. */
  createAt(type: 'sticky' | 'rect' | 'frame', p: Point): void;
  /** Opens the comment composer at a world point, anchored to `hitId` when given. */
  commentAt(p: Point, hitId: string | null): void;
  /** Fits the active page's content into the viewport. */
  zoomToFit(): void;
  setHelp(open: boolean): void;
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
  /** Shows a transient notice (toasts in the app). */
  notify?: (message: string) => void;
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
    menu: null,
    help: false,
    synced: false,
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
    const done = direction === 'undo' ? undoStack.undo() : undoStack.redo();
    if (done) opts.notify?.(direction === 'undo' ? 'Undone' : 'Redone');
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

  /** Replaces the selection; only between gestures. Selecting switches to the select tool. */
  const setSelection = (ids: string[]) => {
    if (ui.getState().tool.mode !== 'idle') return;
    ui.setState({ tool: { mode: 'idle', tool: 'select', selection: ids } });
  };
  const selectionNow = () => ui.getState().tool.selection;
  const idle = () => ui.getState().tool.mode === 'idle';
  /** Several commands as exactly one undo step; only between gestures (never splits one). */
  const commitStep = (...commands: Command[]) => {
    if (commands.length === 0 || !idle()) return;
    throttledCommit.cancel();
    undoStack.stopCapturing();
    for (const c of commands) commit(c);
    undoStack.stopCapturing();
  };
  const pasteContext = () => ({
    shapes: opts.docStore.getState().shapes,
    newId,
    userId: opts.user.id,
    userName: opts.user.name,
    now,
  });
  const pointerOrCentre = (): Point =>
    ui.getState().pointer ?? screenToWorld(ui.getState().camera, viewportCentre());
  /** Creates a paste plan on the active page, selected, as one undo step. */
  const place = (plan: { shapes: NewShape[]; connectors: NewConnector[] }): boolean => {
    if (plan.shapes.length === 0 && plan.connectors.length === 0) return false;
    const pageId = activePage();
    commitStep({
      type: 'PasteItems',
      shapes: plan.shapes.map((s) => ({ ...s, pageId })),
      connectors: plan.connectors.map((c) => ({ ...c, pageId })),
    });
    setSelection([...plan.shapes.map((s) => s.id), ...plan.connectors.map((c) => c.id)]);
    return true;
  };
  // The in-app clipboard (fallback when the system clipboard cannot be read) and how many
  // times in a row it was pasted, so repeated pastes step down and right.
  let clip: string | null = null;
  let repeat = { text: '', n: 0 };
  // Pages this user deleted: losing the active page to one of them needs no notice.
  const deletedHere = new Set<string>();
  /** Copies the selection into the in-app clipboard; returns what was copied. */
  const copy = (): ClipPayload | null => {
    const { shapes, connectors } = opts.docStore.getState();
    const payload = copyPayload(selectionNow(), shapes, connectors);
    if (!payload) return null;
    clip = serializeClip(payload);
    repeat = { text: clip, n: 0 };
    return payload;
  };
  const copySelection = (): string | null => (copy() ? clip : null);

  const unsubscribe = opts.docStore.subscribe((doc, prev) => {
    // A page change (local, or a remote fallback when the active page is deleted) starts
    // fresh: no gesture, editor or popover carries over, undo cannot reach the old page,
    // and the camera is that page's stored one (or a fit once the canvas allows it).
    if (doc.activePage !== prev.activePage) {
      const wasDeleted =
        prev.pages.some((p) => p.id === prev.activePage) &&
        !doc.pages.some((p) => p.id === prev.activePage);
      if (wasDeleted && !deletedHere.has(prev.activePage)) {
        opts.notify?.('The page you were on was deleted');
      }
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
        menu: null,
        camera: stored ?? { x: 0, y: 0, zoom: 1 },
      });
      tryFit();
    }
    // Close the editor if the edited shape is deleted or locked (locally, remotely or by undo).
    const { editingId, editingColumn } = ui.getState();
    if (editingId && (!doc.shapes[editingId] || doc.shapes[editingId]?.locked)) stopEditing();
    if (
      editingColumn &&
      (doc.shapes[editingColumn.frameId]?.type !== 'frame' ||
        doc.shapes[editingColumn.frameId]?.locked)
    ) {
      ui.setState({ editingColumn: null });
    }
  });

  const dispatch = (event: ToolEvent) => {
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
  };

  return {
    ui,
    dispatch,
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
      ui.setState({ synced: true });
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
      const label = type === 'board' ? 'Board' : type === 'sheet' ? 'Sheet' : 'Calendar';
      const taken = new Set(pages.map((p) => p.title));
      let n = pages.filter((p) => p.type === type).length + 1;
      while (taken.has(`${label} ${n}`)) n++;
      commitPage({
        type: 'CreatePage',
        page: {
          id,
          type,
          title: `${label} ${n}`.slice(0, MAX_PAGE_TITLE),
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
      deletedHere.add(id);
      commitPage({ type: 'DeletePage', id });
      return true;
    },
    renameBoard(title) {
      const text = title.trim().slice(0, MAX_BOARD_TITLE);
      if (text) commitPage({ type: 'RenameBoard', title: text });
    },
    select: setSelection,
    selectAll() {
      const { order, connectorOrder } = opts.docStore.getState();
      setSelection([...order, ...connectorOrder]);
    },
    openMenu(at) {
      const { tool } = ui.getState();
      if (tool.mode !== 'idle') return;
      const target = at.hitId ?? at.connectorId;
      if (!target) setSelection([]);
      else if (!tool.selection.includes(target)) setSelection([target]);
      ui.setState({ menu: { screen: at.screen, world: at.world, hitId: at.hitId } });
    },
    closeMenu() {
      if (ui.getState().menu) ui.setState({ menu: null });
    },
    copySelection,
    cutSelection() {
      if (!idle()) return null;
      const payload = copy();
      if (!payload || clip === null) return null;
      const { shapes } = opts.docStore.getState();
      const unlocked = (id: string) => {
        const s = shapes[id];
        return !!s && !s.locked;
      };
      // Exactly what was cut: unlocked selected shapes, the unlocked children of unlocked
      // selected frames, and the connectors the copy took (never one it dropped).
      const ids = new Set<string>();
      for (const id of selectionNow()) {
        if (!unlocked(id)) continue;
        ids.add(id);
        if (shapes[id]?.type !== 'frame') continue;
        for (const child of childrenOf(shapes, id)) if (unlocked(child)) ids.add(child);
      }
      for (const c of payload.connectors) ids.add(c.id);
      if (ids.size > 0) {
        commitStep({ type: 'DeleteShapes', ids: [...ids] });
        setSelection(selectionNow().filter((id) => !ids.has(id)));
      }
      return clip;
    },
    lastCopied: () => clip,
    pasteText(text, at) {
      if (ui.getState().tool.mode !== 'idle') return false;
      const ctx = pasteContext();
      const payload = parseClip(text);
      if (payload) {
        if (at) return place(pastePlan(payload, ctx, { at }));
        repeat = repeat.text === text ? { text, n: repeat.n + 1 } : { text, n: 1 };
        return place(pastePlan(payload, ctx, { offset: PASTE_OFFSET * repeat.n }));
      }
      const body = text.trim();
      if (!body) return false;
      return place({
        shapes: [plainTextSticky(body, at ?? pointerOrCentre(), ctx)],
        connectors: [],
      });
    },
    duplicate() {
      if (ui.getState().tool.mode !== 'idle') return;
      const { shapes, connectors } = opts.docStore.getState();
      const payload = copyPayload(selectionNow(), shapes, connectors);
      if (payload) place(pastePlan(payload, pasteContext(), { offset: PASTE_OFFSET }));
    },
    setZ(where) {
      const ids = selectionNow();
      if (ids.length > 0) commitStep({ type: 'SetZ', ids, where });
    },
    setStyle(patch) {
      const { shapes } = opts.docStore.getState();
      const ids = selectionNow().filter((id) => shapes[id] && !shapes[id]?.locked);
      if (ids.length > 0) commitStep({ type: 'SetStyle', ids, patch });
    },
    toggleLock() {
      const { shapes } = opts.docStore.getState();
      const targets = selectionNow().filter((id) => shapes[id]);
      if (targets.length === 0) return;
      const locked = !targets.every((id) => shapes[id]?.locked);
      commitStep({ type: 'SetLocked', ids: targets, locked });
    },
    setHead(head) {
      const { connectors } = opts.docStore.getState();
      commitStep(
        ...selectionNow()
          .filter((id) => connectors[id])
          .map((id): Command => ({ type: 'SetHead', id, head })),
      );
    },
    setRouting(routing) {
      const { connectors } = opts.docStore.getState();
      commitStep(
        ...selectionNow()
          .filter((id) => connectors[id])
          .map((id): Command => ({ type: 'SetRouting', id, routing })),
      );
    },
    createAt(type, p) {
      if (ui.getState().tool.mode !== 'idle') return;
      const size = DEFAULT_SIZE[type];
      // Click-created stickies centre on the press; drawn tools put their corner there.
      const world = type === 'sticky' ? p : { x: p.x - size.w / 2, y: p.y - size.h / 2 };
      const info = { world, shift: false, hitId: null };
      dispatch({ type: 'setTool', tool: type });
      dispatch({ type: 'pointerDown', p: info });
      if (ui.getState().tool.mode === 'drawing') dispatch({ type: 'pointerUp', p: info });
    },
    commentAt(p, hitId) {
      const s = hitId ? opts.docStore.getState().shapes[hitId] : undefined;
      const anchor: CommentAnchor = s
        ? { shapeId: s.id, dx: p.x - s.x, dy: p.y - s.y }
        : { x: p.x, y: p.y };
      ui.setState({ composer: { anchor, at: p }, openThread: null });
    },
    zoomToFit() {
      const v = ui.getState().viewport;
      const bounds = contentBounds(opts.docStore.getState().shapes);
      if (v && bounds) setCamera(fitBounds(bounds, v.w, v.h));
    },
    setHelp(open) {
      ui.setState({ help: open });
    },
    destroy() {
      throttledCommit.cancel();
      unsubscribe();
      undoStack.destroy();
    },
  };
}
