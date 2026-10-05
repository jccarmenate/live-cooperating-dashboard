import {
  type AlgorithmKind,
  type AlgorithmResult,
  allowedFor,
  applyCommand,
  type BoardAccess,
  type Camera,
  CLIP_PREFIX,
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
  EVENT_COLORS,
  fitBounds,
  type GraphDraft,
  getRoots,
  graphPlan,
  type Identity,
  initialSheet,
  initialToolState,
  isAttached,
  isVoteOpen,
  LOCAL_ORIGIN,
  MAX_BOARD_TITLE,
  MAX_EVENT_TITLE,
  MAX_EVENTS,
  MAX_PAGE_TITLE,
  MAX_PASTE_BYTES,
  type NewConnector,
  type NewShape,
  orderBetween,
  PASTE_OFFSET,
  type PageType,
  type Point,
  type Preview,
  pageOf,
  parseClip,
  pastePlan,
  pasteUpdateSize,
  plainTextSticky,
  type Rect,
  type Routing,
  readCalendar,
  readGraph,
  runAlgorithm as runGraphAlgorithm,
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
  type When,
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

/** The shape tools behind the toolbar's Shapes button. */
export type ShapeToolId = 'rect' | 'ellipse' | 'line';
const isShapeTool = (tool: string): tool is ShapeToolId =>
  tool === 'rect' || tool === 'ellipse' || tool === 'line';

export interface BoardUiState {
  tool: ToolState;
  /** The last shape tool picked (flyout or key): the Shapes button shows it. */
  lastShape: ShapeToolId;
  preview: Preview | null;
  /** Local-only geometry for shapes being dragged/resized, rendered every frame. */
  overlay: Record<string, Rect> | null;
  editingId: string | null;
  editingColumn: { frameId: string; columnId: string } | null;
  /** Connector whose label is being edited. */
  editingConnector: string | null;
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
  /** The toolbar's Graph menu is open. */
  graphMenu: boolean;
  /** The New graph dialog is open. */
  graphDialog: boolean;
  /** The graph algorithms panel is open. */
  algorithmsPanel: boolean;
  /** The last algorithm's result, shown as a local overlay (never written to the document). */
  graphResult: AlgorithmResult | null;
  /** Node names as they were when `graphResult` was computed (the result text uses them). */
  graphNames: Record<string, string>;
  /** The document finished its first sync. */
  synced: boolean;
  /** The sticky whose "Add to calendar" dialog is open. */
  addToCalendar: string | null;
  /** Touch stand-in for Shift: presses add to (or toggle in) the selection. */
  multiSelect: boolean;
  /** Whether this user has a step to undo or redo (the undo and redo buttons). */
  canUndo: boolean;
  canRedo: boolean;
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
  /** Switches to `pageId`, selects the shape and centres it; false when either is missing. */
  revealShape(pageId: string, shapeId: string): boolean;
  /** The document finished its first sync: fit the content once if nothing set the camera. */
  markSynced(): void;
  applyText(id: string, diff: TextDiff): void;
  stopEditing(): void;
  renameColumn(frameId: string, columnId: string, title: string): void;
  stopEditingColumn(): void;
  /** Opens (id) or closes (null) the inline label editor of a connector. */
  editConnectorLabel(id: string | null): void;
  /**
   * Sets or clears (empty) a connector's label as one undo step, and closes the editor.
   * Mid-gesture it commits nothing and leaves the editor open.
   */
  setConnectorLabel(id: string, label: string): void;
  undo(): void;
  redo(): void;
  /** Applies commands as one undo step (LOCAL origin); false (nothing applied) mid-gesture. */
  commit(...commands: Command[]): boolean;
  /** Applies a command with the SESSION origin (never undoable). */
  commitSession(command: Command): void;
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
  setMultiSelect(on: boolean): void;
  /** The toolbar's Graph menu. */
  setGraphMenu(open: boolean): void;
  /** The New graph dialog (opening it closes the menu). */
  setGraphDialog(open: boolean): void;
  /** Lays out a graph around the viewport centre and creates it (one undo step, selected); false if refused. */
  createGraph(draft: GraphDraft): boolean;
  /** The Algorithms panel (it and the comments panel exclude each other). */
  setAlgorithmsPanel(open: boolean): void;
  /** Runs an algorithm on the selection (or the whole page) and shows its result as a local overlay. */
  runAlgorithm(kind: AlgorithmKind, start?: string, end?: string): AlgorithmResult;
  clearGraphResult(): void;
  /** Opens (a sticky's id) or closes (null) the "Add to calendar" dialog. */
  setAddToCalendar(id: string | null): void;
  /**
   * Creates an event linked to a sticky on the active page, on the calendar page `pageId` (null:
   * a new calendar page), as one undo step (the new page itself is not undoable). Returns the
   * calendar page id, or null when nothing was created.
   */
  addStickyToCalendar(input: {
    pageId: string | null;
    shapeId: string;
    title: string;
    when: When;
  }): string | null;
  destroy(): void;
}

/** No algorithm result shown (the overlay and its name snapshot go together). */
const noGraphResult = (): Pick<BoardUiState, 'graphResult' | 'graphNames'> => ({
  graphResult: null,
  graphNames: {},
});

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
  /** What the board lets this user change right now (default: edit). */
  access?: () => BoardAccess;
}): BoardController {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? Date.now;
  const serverNow = opts.serverNow ?? Date.now;
  const activePage = () => opts.docStore.getState().activePage;
  const stored = opts.cameraStorage?.load(activePage()) ?? null;
  const ui = createStore<BoardUiState>(() => ({
    tool: initialToolState(),
    lastShape: 'rect',
    preview: null,
    overlay: null,
    editingId: null,
    editingColumn: null,
    editingConnector: null,
    camera: stored ?? { x: 0, y: 0, zoom: 1 },
    viewport: null,
    pointer: null,
    spaceHeld: false,
    composer: null,
    openThread: null,
    commentsPanel: false,
    menu: null,
    help: false,
    graphMenu: false,
    graphDialog: false,
    algorithmsPanel: false,
    ...noGraphResult(),
    synced: false,
    addToCalendar: null,
    multiSelect: false,
    canUndo: false,
    canRedo: false,
  }));
  const undoStack = createUndo(opts.doc, { captureTimeout: UNDO_CAPTURE_TIMEOUT });
  const stopUndoWatch = undoStack.onChange(() => {
    const canUndo = undoStack.canUndo();
    const canRedo = undoStack.canRedo();
    const s = ui.getState();
    if (s.canUndo !== canUndo || s.canRedo !== canRedo) ui.setState({ canUndo, canRedo });
  });

  const access = opts.access ?? ((): BoardAccess => 'edit');
  /**
   * A command the server would refuse is not applied at all: it would stay in this user's own
   * copy and never reach the others. For a viewer that is every command; on a full board,
   * every command that is not a pure deletion.
   */
  const apply = (command: Command, origin: string) => {
    if (allowedFor(access(), command)) applyCommand(opts.doc, command, origin);
  };
  const commit = (command: Command) => apply(command, LOCAL_ORIGIN);
  const throttledCommit = throttle(commit, 50);
  const commitSession = (command: Command) => apply(command, SESSION_ORIGIN);
  // Page commands touch untracked roots, except DeletePage, which also deletes the page's
  // shapes: on SESSION_ORIGIN a page delete never becomes an undo step that resurrects
  // shapes on a tombstoned page.
  const commitPage = (command: Command) => apply(command, SESSION_ORIGIN);

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
    // Undoing a deletion (or redoing a creation) writes content, which only an editor on a
    // board that takes edits may do.
    if (access() !== 'edit') return;
    if (ui.getState().tool.mode !== 'idle') return;
    throttledCommit.cancel();
    if (ui.getState().editingId) stopEditing();
    if (ui.getState().editingColumn) ui.setState({ editingColumn: null });
    ui.setState({ overlay: null, preview: null });
    const done = direction === 'undo' ? undoStack.undo() : undoStack.redo();
    if (!done) return;
    // A step that changed only calendar events is off-screen anywhere but a calendar page
    // (e.g. "Add to calendar…" from a sticky): say what it was.
    const { pages } = opts.docStore.getState();
    const offPage =
      undoStack.lastOnlyCalendars() &&
      pages.find((p) => p.id === activePage())?.type !== 'calendar';
    const word = direction === 'undo' ? 'Undone' : 'Redone';
    opts.notify?.(offPage ? `${word} (calendar event)` : word);
  };

  // The initial fit happens once: after the first sync, once the canvas is measured, and
  // only if no camera was restored and the user has not moved it yet. It is not saved.
  let fitPending = stored === null;
  let synced = false;
  /** A shape to centre on once the canvas is measured (revealShape before any viewport). */
  let pendingCentre: Point | null = null;
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

  /** Keeps the zoom and centres the viewport on a world point (nothing before it is measured). */
  const centreOn = (p: Point) => {
    const v = ui.getState().viewport;
    if (!v) return;
    setCamera(centredOn(ui.getState().camera, p, v.w, v.h));
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
  /**
   * Several commands as exactly one undo step and one transaction (peers get one update, and
   * observers such as the sheet evaluator run once); only between gestures (never splits one).
   */
  const commitStep = (...commands: Command[]): boolean => {
    if (commands.length === 0 || !idle()) return false;
    throttledCommit.cancel();
    undoStack.stopCapturing();
    // Each commit's own transact nests into this one.
    opts.doc.transact(() => {
      for (const c of commands) commit(c);
    }, LOCAL_ORIGIN);
    undoStack.stopCapturing();
    return true;
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
  /**
   * Creates a paste plan on the active page, selected, as one undo step. A plan whose single
   * update would exceed the sync server's message limit is refused with a notice.
   */
  const place = (plan: { shapes: NewShape[]; connectors: NewConnector[] }): boolean => {
    if (plan.shapes.length === 0 && plan.connectors.length === 0) return false;
    const pageId = activePage();
    const onPage = {
      shapes: plan.shapes.map((s) => ({ ...s, pageId })),
      connectors: plan.connectors.map((c) => ({ ...c, pageId })),
    };
    if (pasteUpdateSize(onPage) > MAX_PASTE_BYTES) {
      opts.notify?.('Too much to paste at once');
      return false;
    }
    commitStep({ type: 'PasteItems', ...onPage });
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

  /** Appends a page of `type` after the last one (SESSION origin, never undoable). */
  const createPage = (type: PageType): string => {
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
      ...(type === 'sheet' ? { sheet: initialSheet() } : {}),
    });
    return id;
  };

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
      pendingCentre = null;
      const stored = opts.cameraStorage?.load(doc.activePage) ?? null;
      fitPending = stored === null;
      ui.setState({
        tool: { mode: 'idle', tool: ui.getState().tool.tool, selection: [] },
        preview: null,
        overlay: null,
        editingId: null,
        editingColumn: null,
        editingConnector: null,
        composer: null,
        openThread: null,
        menu: null,
        graphMenu: false,
        graphDialog: false,
        addToCalendar: null,
        ...noGraphResult(),
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
    const { editingConnector } = ui.getState();
    if (editingConnector && !doc.connectors[editingConnector])
      ui.setState({ editingConnector: null });
    // The Add to calendar dialog closes when its sticky is deleted.
    const { addToCalendar } = ui.getState();
    if (addToCalendar && !doc.shapes[addToCalendar]) ui.setState({ addToCalendar: null });
  });

  const dispatch = (event: ToolEvent) => {
    // A user who draws before the first sync arrives has already started a gesture on
    // the canvas: the initial fit must not yank the camera out from under them later.
    if (event.type === 'pointerDown') fitPending = false;
    // A canvas press closes any open thread popover or composer (the comment tool reopens one).
    if (event.type === 'pointerDown') ui.setState({ openThread: null, composer: null });
    // Escape at rest clears the algorithm overlay; a cancel mid-gesture only ends the gesture.
    if (event.type === 'cancel' && ui.getState().tool.mode === 'idle' && ui.getState().graphResult)
      ui.setState(noGraphResult());
    const { state, effects } = step(ui.getState().tool, event, {
      shapes: opts.docStore.getState().shapes,
      connectors: opts.docStore.getState().connectors,
      userId: opts.user.id,
      userName: opts.user.name,
      newId,
      now,
    });
    ui.setState(isShapeTool(state.tool) ? { tool: state, lastShape: state.tool } : { tool: state });
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
      if (pendingCentre) {
        const c = pendingCentre;
        pendingCentre = null;
        centreOn(c);
      }
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
    centerOn: centreOn,
    revealShape(pageId, shapeId) {
      // Checked before switching: a missing page or shape leaves the user where they are.
      const { pages, allShapes } = opts.docStore.getState();
      const target = allShapes[shapeId];
      if (!pages.some((p) => p.id === pageId) || !target || pageOf(target) !== pageId) {
        return false;
      }
      opts.setPage(pageId);
      // The page switch resets the selection and camera synchronously; select after it.
      const shape = opts.docStore.getState().shapes[shapeId];
      if (!shape) return false;
      setSelection([shapeId]);
      const centre = { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
      if (ui.getState().viewport) centreOn(centre);
      else pendingCentre = centre;
      return true;
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
    editConnectorLabel(id) {
      ui.setState({ editingConnector: id });
    },
    setConnectorLabel(id, label) {
      // Mid-gesture nothing is committed: the editor stays open so the edit is not lost.
      if (commitStep({ type: 'SetConnectorLabel', id, label })) {
        ui.setState({ editingConnector: null });
      }
    },
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    commit: commitStep,
    commitSession,
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
      const open = !ui.getState().commentsPanel;
      // Opening Comments closes the Algorithms panel, and with it the result overlay.
      ui.setState(
        open
          ? { commentsPanel: true, algorithmsPanel: false, ...noGraphResult() }
          : { commentsPanel: false },
      );
    },
    setPage(id) {
      opts.setPage(id);
    },
    createPage,
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
      // selected frames, and the connectors the copy took (never one it dropped) that were
      // selected or are attached to a cut shape.
      const ids = new Set<string>();
      for (const id of selectionNow()) {
        if (!unlocked(id)) continue;
        ids.add(id);
        if (shapes[id]?.type !== 'frame') continue;
        for (const child of childrenOf(shapes, id)) if (unlocked(child)) ids.add(child);
      }
      const picked = new Set(selectionNow());
      for (const c of payload.connectors) {
        const ends = [c.from, c.to].filter(isAttached);
        if (picked.has(c.id) || ends.some((e) => ids.has(e.shapeId))) ids.add(c.id);
      }
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
      // A Relay clip that fails to parse is not text to paste.
      if (!payload && text.startsWith(CLIP_PREFIX)) return false;
      if (payload) {
        if (at) return place(pastePlan(payload, ctx, { at }));
        const next = repeat.text === text ? { text, n: repeat.n + 1 } : { text, n: 1 };
        const placed = place(pastePlan(payload, ctx, { offset: PASTE_OFFSET * next.n }));
        if (placed) repeat = next;
        return placed;
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
    setMultiSelect(on) {
      ui.setState({ multiSelect: on });
    },
    setGraphMenu(open) {
      ui.setState({ graphMenu: open });
    },
    setGraphDialog(open) {
      ui.setState({ graphDialog: open, graphMenu: false });
    },
    createGraph(draft) {
      if (ui.getState().tool.mode !== 'idle') return false;
      const centre = screenToWorld(ui.getState().camera, viewportCentre());
      const created = place(
        graphPlan(draft, centre, { newId, userId: opts.user.id, userName: opts.user.name, now }),
      );
      if (created) ui.setState({ graphDialog: false });
      return created;
    },
    setAlgorithmsPanel(open) {
      // Closing the panel also removes its result overlay.
      ui.setState(
        open
          ? { algorithmsPanel: true, commentsPanel: false }
          : { algorithmsPanel: false, ...noGraphResult() },
      );
    },
    runAlgorithm(kind, start, end) {
      // The projected shapes and connectors are the active page's only.
      const { shapes, connectors } = opts.docStore.getState();
      let result: AlgorithmResult;
      let graphNames: Record<string, string> = {};
      try {
        const graph = readGraph(ui.getState().tool.selection, shapes, connectors);
        graphNames = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]));
        result = runGraphAlgorithm(graph, kind, start, end);
      } catch (e) {
        // The recursive DFS can overflow the stack on a page of thousands of chained shapes.
        if (e instanceof RangeError) {
          result = { kind: 'error', message: 'The graph is too large for this algorithm' };
        } else {
          console.error(e);
          result = { kind: 'error', message: 'Could not run the algorithm' };
        }
      }
      ui.setState({ graphResult: result, graphNames });
      return result;
    },
    clearGraphResult() {
      ui.setState(noGraphResult());
    },
    setAddToCalendar(id) {
      ui.setState({ addToCalendar: id });
    },
    addStickyToCalendar(input) {
      const shape = opts.docStore.getState().shapes[input.shapeId];
      // Checked before a new page is made: mid-gesture nothing would be committed to it.
      if (shape?.type !== 'sticky' || !idle()) return null;
      const pageId = input.pageId ?? createPage('calendar');
      const cal = readCalendar(getRoots(opts.doc).calendars.get(pageId));
      if (!cal) {
        opts.notify?.('That calendar no longer exists');
        return null;
      }
      if (cal.events.length >= MAX_EVENTS) {
        opts.notify?.('This calendar is full (500 events)');
        return null;
      }
      const done = commitStep({
        type: 'CreateEvent',
        pageId,
        id: newId(),
        fields: {
          title: input.title.trim().slice(0, MAX_EVENT_TITLE) || 'Untitled',
          color: EVENT_COLORS[0] as string,
          when: input.when,
          link: { pageId: activePage(), shapeId: input.shapeId },
          createdBy: opts.user.id,
          createdAt: now(),
        },
      });
      if (!done) return null;
      const title =
        opts.docStore.getState().pages.find((p) => p.id === pageId)?.title ?? 'Calendar';
      opts.notify?.(`Added to ${title}`);
      ui.setState({ addToCalendar: null });
      return pageId;
    },
    destroy() {
      throttledCommit.cancel();
      unsubscribe();
      stopUndoWatch();
      undoStack.destroy();
    },
  };
}
