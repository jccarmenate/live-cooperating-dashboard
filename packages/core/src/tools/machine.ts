import type { Command, NewShape } from '../commands/types';
import { rectFromPoints } from '../geometry/rect';
import { type Handle, MIN_SIZE, resizeGeometry, shapesInRect } from '../geometry/shapes';
import { DEFAULT_SIZE, DEFAULT_STYLE } from '../schema/defaults';
import { type Point, type Rect, type Shape, type ShapeType, TEXT_TYPES } from '../schema/types';

export type ToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'text' | 'sticky' | 'code';
type DrawTool = 'rect' | 'ellipse' | 'line';
type ClickTool = 'text' | 'sticky' | 'code';

export interface PointerInfo {
  world: Point;
  shift: boolean;
  hitId: string | null;
  /** Resize handle under the pointer, if any (handles belong to the current selection). */
  handle?: Handle;
}

export type ToolEvent =
  | { type: 'pointerDown'; p: PointerInfo }
  | { type: 'pointerMove'; p: PointerInfo }
  | { type: 'pointerUp'; p: PointerInfo }
  | { type: 'doubleClick'; p: PointerInfo }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'deleteSelection' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'cancel' };

type IdleState = { mode: 'idle'; tool: ToolId; selection: string[] };
type DraggingState = {
  mode: 'dragging';
  tool: 'select';
  selection: string[];
  origin: Point;
  starts: Record<string, Rect>;
  moved: boolean;
};
type ResizingState = {
  mode: 'resizing';
  tool: 'select';
  selection: string[];
  id: string;
  shapeType: ShapeType;
  handle: Handle;
  start: Rect;
  origin: Point;
  moved: boolean;
};
type DrawingState = {
  mode: 'drawing';
  tool: DrawTool;
  selection: string[];
  origin: Point;
  current: Point;
};
type MarqueeState = {
  mode: 'marquee';
  tool: 'select';
  selection: string[];
  /** Selection the marquee started from (non-empty only with Shift). */
  base: string[];
  origin: Point;
  moved: boolean;
};

export type ToolState = IdleState | DraggingState | ResizingState | DrawingState | MarqueeState;

export type PreviewKind = 'rect' | 'ellipse' | 'line' | 'marquee';
/** For `line`, `rect` is the signed vector from the start point. */
export interface Preview {
  kind: PreviewKind;
  rect: Rect;
}

export type Effect =
  | { type: 'command'; command: Command; throttle: boolean }
  | { type: 'preview'; preview: Preview | null }
  /** Local-only geometry rendered every frame while commits to the doc are throttled. */
  | { type: 'overlay'; rects: Record<string, Rect> | null }
  | { type: 'editText'; id: string }
  | { type: 'endGesture' };

export interface ToolContext {
  shapes: Readonly<Record<string, Shape>>;
  userId: string;
  userName: string;
  newId: () => string;
  now: () => number;
}

export interface StepResult {
  state: ToolState;
  effects: Effect[];
}

/** World-space distance a pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;
/** Smaller drawn shapes are treated as a click and get the default size. */
export const MIN_DRAW = 4;

export const initialToolState = (): ToolState => ({ mode: 'idle', tool: 'select', selection: [] });

const idle = (tool: ToolId, selection: string[]): IdleState => ({ mode: 'idle', tool, selection });
const none = (state: ToolState): StepResult => ({ state, effects: [] });
const command = (c: Command, throttle = false): Effect => ({
  type: 'command',
  command: c,
  throttle,
});
const overlay = (rects: Record<string, Rect> | null): Effect => ({ type: 'overlay', rects });
const preview = (p: Preview | null): Effect => ({ type: 'preview', preview: p });

const geometryOf = (s: Shape): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });

function newShape(ctx: ToolContext, type: DrawTool | ClickTool, rect: Rect): NewShape {
  return {
    id: ctx.newId(),
    type,
    ...rect,
    style: DEFAULT_STYLE[type],
    text: '',
    createdBy: ctx.userId,
    authorName: ctx.userName,
    createdAt: ctx.now(),
  };
}

const pastThreshold = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_THRESHOLD;

function movedRects(state: DraggingState, p: Point): Record<string, Rect> {
  const dx = p.x - state.origin.x;
  const dy = p.y - state.origin.y;
  const rects: Record<string, Rect> = {};
  for (const [id, s] of Object.entries(state.starts))
    rects[id] = { ...s, x: s.x + dx, y: s.y + dy };
  return rects;
}

const moveCommand = (rects: Record<string, Rect>): Command => ({
  type: 'MoveShapes',
  moves: Object.entries(rects).map(([id, r]) => ({ id, x: r.x, y: r.y })),
});

const resizeCommand = (id: string, r: Rect): Command => ({
  type: 'ResizeShapes',
  rects: [{ id, ...r }],
});

function resized(state: ResizingState, p: PointerInfo): Rect {
  const delta = { x: p.world.x - state.origin.x, y: p.world.y - state.origin.y };
  return resizeGeometry(state.shapeType, state.start, state.handle, delta, p.shift);
}

/** Lines keep the signed start→end vector; boxes are normalized. */
function drawnRect(tool: DrawTool, origin: Point, p: Point): Rect {
  if (tool === 'line') return { x: origin.x, y: origin.y, w: p.x - origin.x, h: p.y - origin.y };
  return rectFromPoints(origin, p);
}

function marqueeSelection(state: MarqueeState, p: Point, ctx: ToolContext): string[] {
  const hits = shapesInRect(ctx.shapes, rectFromPoints(state.origin, p));
  return [...state.base, ...hits.filter((id) => !state.base.includes(id))];
}

function pointerDownIdle(state: IdleState, p: PointerInfo, ctx: ToolContext): StepResult {
  switch (state.tool) {
    case 'select': {
      const only = state.selection.length === 1 ? state.selection[0] : undefined;
      const target = only ? ctx.shapes[only] : undefined;
      if (p.handle && only && target) {
        return none({
          mode: 'resizing',
          tool: 'select',
          selection: state.selection,
          id: only,
          shapeType: target.type,
          handle: p.handle,
          start: geometryOf(target),
          origin: p.world,
          moved: false,
        });
      }
      const hit = p.hitId && ctx.shapes[p.hitId] ? p.hitId : null;
      if (!hit) {
        const base = p.shift ? state.selection : [];
        return none({
          mode: 'marquee',
          tool: 'select',
          selection: base,
          base,
          origin: p.world,
          moved: false,
        });
      }
      let selection: string[];
      if (p.shift) {
        selection = state.selection.includes(hit)
          ? state.selection.filter((id) => id !== hit)
          : [...state.selection, hit];
      } else {
        selection = state.selection.includes(hit) ? state.selection : [hit];
      }
      if (!selection.includes(hit)) return none(idle('select', selection));
      const starts: Record<string, Rect> = {};
      for (const id of selection) {
        const s = ctx.shapes[id];
        if (s) starts[id] = geometryOf(s);
      }
      return none({
        mode: 'dragging',
        tool: 'select',
        selection,
        origin: p.world,
        starts,
        moved: false,
      });
    }
    case 'rect':
    case 'ellipse':
    case 'line':
      return {
        state: {
          mode: 'drawing',
          tool: state.tool,
          selection: [],
          origin: p.world,
          current: p.world,
        },
        effects: [preview({ kind: state.tool, rect: drawnRect(state.tool, p.world, p.world) })],
      };
    case 'sticky':
    case 'text':
    case 'code': {
      const size = DEFAULT_SIZE[state.tool];
      const shape = newShape(ctx, state.tool, {
        x: p.world.x - size.w / 2,
        y: p.world.y - size.h / 2,
        ...size,
      });
      return {
        state: idle('select', [shape.id]),
        effects: [
          command({ type: 'CreateShape', shape }),
          { type: 'endGesture' },
          { type: 'editText', id: shape.id },
        ],
      };
    }
  }
}

function stepIdle(state: IdleState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'setTool':
      return none(idle(event.tool, event.tool === 'select' ? state.selection : []));
    case 'deleteSelection':
      if (state.selection.length === 0) return none(state);
      return {
        state: idle(state.tool, []),
        effects: [command({ type: 'DeleteShapes', ids: state.selection }), { type: 'endGesture' }],
      };
    case 'nudge': {
      const moves = state.selection.flatMap((id) => {
        const s = ctx.shapes[id];
        return s ? [{ id, x: s.x + event.dx, y: s.y + event.dy }] : [];
      });
      if (moves.length === 0) return none(state);
      return {
        state,
        effects: [command({ type: 'MoveShapes', moves }), { type: 'endGesture' }],
      };
    }
    case 'doubleClick': {
      const shape = event.p.hitId ? ctx.shapes[event.p.hitId] : undefined;
      if (!shape || !TEXT_TYPES.has(shape.type)) return none(state);
      return { state: idle('select', [shape.id]), effects: [{ type: 'editText', id: shape.id }] };
    }
    case 'pointerDown':
      return pointerDownIdle(state, event.p, ctx);
    default:
      return none(state);
  }
}

function stepDragging(state: DraggingState, event: ToolEvent): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(state);
      const rects = movedRects(state, event.p.world);
      return {
        state: { ...state, moved: true },
        effects: [overlay(rects), command(moveCommand(rects), true)],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      const next = idle('select', state.selection);
      if (!moved) return none(next);
      return {
        state: next,
        effects: [
          command(moveCommand(movedRects(state, event.p.world))),
          overlay(null),
          { type: 'endGesture' },
        ],
      };
    }
    case 'cancel': {
      const next = idle('select', state.selection);
      if (!state.moved) return none(next);
      return {
        state: next,
        effects: [
          command(moveCommand(movedRects(state, state.origin))),
          overlay(null),
          { type: 'endGesture' },
        ],
      };
    }
    default:
      return none(state);
  }
}

function stepResizing(state: ResizingState, event: ToolEvent): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(state);
      const r = resized(state, event.p);
      return {
        state: { ...state, moved: true },
        effects: [overlay({ [state.id]: r }), command(resizeCommand(state.id, r), true)],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      const next = idle('select', state.selection);
      if (!moved) return none(next);
      return {
        state: next,
        effects: [
          command(resizeCommand(state.id, resized(state, event.p))),
          overlay(null),
          { type: 'endGesture' },
        ],
      };
    }
    case 'cancel': {
      const next = idle('select', state.selection);
      if (!state.moved) return none(next);
      return {
        state: next,
        effects: [
          command(resizeCommand(state.id, state.start)),
          overlay(null),
          { type: 'endGesture' },
        ],
      };
    }
    default:
      return none(state);
  }
}

function stepDrawing(state: DrawingState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'pointerMove':
      return {
        state: { ...state, current: event.p.world },
        effects: [
          preview({ kind: state.tool, rect: drawnRect(state.tool, state.origin, event.p.world) }),
        ],
      };
    case 'pointerUp': {
      let rect = drawnRect(state.tool, state.origin, event.p.world);
      if (state.tool === 'line') {
        if (Math.hypot(rect.w, rect.h) < MIN_DRAW) {
          rect = { x: state.origin.x, y: state.origin.y, ...DEFAULT_SIZE.line };
        }
      } else if (rect.w < MIN_DRAW && rect.h < MIN_DRAW) {
        rect = { x: state.origin.x, y: state.origin.y, ...DEFAULT_SIZE[state.tool] };
      } else {
        rect = { ...rect, w: Math.max(rect.w, MIN_SIZE), h: Math.max(rect.h, MIN_SIZE) };
      }
      const shape = newShape(ctx, state.tool, rect);
      return {
        state: idle('select', [shape.id]),
        effects: [preview(null), command({ type: 'CreateShape', shape }), { type: 'endGesture' }],
      };
    }
    case 'cancel':
      return { state: idle(state.tool, []), effects: [preview(null)] };
    default:
      return none(state);
  }
}

function stepMarquee(state: MarqueeState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (event.type) {
    case 'pointerMove': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(state);
      return {
        state: { ...state, moved: true, selection: marqueeSelection(state, event.p.world, ctx) },
        effects: [preview({ kind: 'marquee', rect: rectFromPoints(state.origin, event.p.world) })],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      if (!moved) return none(idle('select', state.base));
      return {
        state: idle('select', marqueeSelection(state, event.p.world, ctx)),
        effects: [preview(null)],
      };
    }
    case 'cancel':
      return { state: idle('select', state.base), effects: [preview(null)] };
    default:
      return none(state);
  }
}

/** Pure tool reducer: (state, event) → (state, effects). */
export function step(state: ToolState, event: ToolEvent, ctx: ToolContext): StepResult {
  switch (state.mode) {
    case 'idle':
      return stepIdle(state, event, ctx);
    case 'dragging':
      return stepDragging(state, event);
    case 'resizing':
      return stepResizing(state, event);
    case 'drawing':
      return stepDrawing(state, event, ctx);
    case 'marquee':
      return stepMarquee(state, event, ctx);
  }
}
