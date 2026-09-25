import type { Command, NewShape } from '../commands/types';
import { rectFromPoints } from '../geometry/rect';
import { DEFAULT_SIZE, DEFAULT_STYLE } from '../schema/defaults';
import { type Point, type Rect, type Shape, TEXT_TYPES } from '../schema/types';

export type ToolId = 'select' | 'rect' | 'text' | 'sticky';

export interface PointerInfo {
  world: Point;
  shift: boolean;
  hitId: string | null;
}

export type ToolEvent =
  | { type: 'pointerDown'; p: PointerInfo }
  | { type: 'pointerMove'; p: PointerInfo }
  | { type: 'pointerUp'; p: PointerInfo }
  | { type: 'doubleClick'; p: PointerInfo }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'deleteSelection' }
  | { type: 'cancel' };

type IdleState = { mode: 'idle'; tool: ToolId; selection: string[] };
type DraggingState = {
  mode: 'dragging';
  tool: 'select';
  selection: string[];
  origin: Point;
  starts: Record<string, Point>;
  moved: boolean;
};
type DrawingState = {
  mode: 'drawing';
  tool: 'rect';
  selection: string[];
  origin: Point;
  current: Point;
};

export type ToolState = IdleState | DraggingState | DrawingState;

export type Effect =
  | { type: 'command'; command: Command; throttle: boolean }
  | { type: 'preview'; rect: Rect | null }
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
/** Smaller drawn rects are treated as a click and get the default size. */
export const MIN_DRAW = 4;

export const initialToolState = (): ToolState => ({ mode: 'idle', tool: 'select', selection: [] });

const idle = (tool: ToolId, selection: string[]): IdleState => ({ mode: 'idle', tool, selection });
const none = (state: ToolState): StepResult => ({ state, effects: [] });
const command = (c: Command, throttle = false): Effect => ({
  type: 'command',
  command: c,
  throttle,
});

function newShape(ctx: ToolContext, type: 'rect' | 'sticky' | 'text', rect: Rect): NewShape {
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

function movesFor(state: DraggingState, p: Point) {
  const dx = p.x - state.origin.x;
  const dy = p.y - state.origin.y;
  return Object.entries(state.starts).map(([id, s]) => ({ id, x: s.x + dx, y: s.y + dy }));
}

const pastThreshold = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_THRESHOLD;

function pointerDownIdle(state: IdleState, p: PointerInfo, ctx: ToolContext): StepResult {
  switch (state.tool) {
    case 'select': {
      const hit = p.hitId && ctx.shapes[p.hitId] ? p.hitId : null;
      if (!hit) return none(idle('select', []));
      let selection: string[];
      if (p.shift) {
        selection = state.selection.includes(hit)
          ? state.selection.filter((id) => id !== hit)
          : [...state.selection, hit];
      } else {
        selection = state.selection.includes(hit) ? state.selection : [hit];
      }
      if (!selection.includes(hit)) return none(idle('select', selection));
      const starts: Record<string, Point> = {};
      for (const id of selection) {
        const s = ctx.shapes[id];
        if (s) starts[id] = { x: s.x, y: s.y };
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
      return {
        state: { mode: 'drawing', tool: 'rect', selection: [], origin: p.world, current: p.world },
        effects: [{ type: 'preview', rect: rectFromPoints(p.world, p.world) }],
      };
    case 'sticky':
    case 'text': {
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
      return {
        state: { ...state, moved: true },
        effects: [command({ type: 'MoveShapes', moves: movesFor(state, event.p.world) }, true)],
      };
    }
    case 'pointerUp': {
      const moved = state.moved || pastThreshold(state.origin, event.p.world);
      const next = idle('select', state.selection);
      if (!moved) return none(next);
      return {
        state: next,
        effects: [
          command({ type: 'MoveShapes', moves: movesFor(state, event.p.world) }),
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
          command({ type: 'MoveShapes', moves: movesFor(state, state.origin) }),
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
        effects: [{ type: 'preview', rect: rectFromPoints(state.origin, event.p.world) }],
      };
    case 'pointerUp': {
      let rect = rectFromPoints(state.origin, event.p.world);
      if (rect.w < MIN_DRAW || rect.h < MIN_DRAW) {
        rect = { x: state.origin.x, y: state.origin.y, ...DEFAULT_SIZE.rect };
      }
      const shape = newShape(ctx, 'rect', rect);
      return {
        state: idle('select', [shape.id]),
        effects: [
          { type: 'preview', rect: null },
          command({ type: 'CreateShape', shape }),
          { type: 'endGesture' },
        ],
      };
    }
    case 'cancel':
      return { state: idle('rect', []), effects: [{ type: 'preview', rect: null }] };
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
    case 'drawing':
      return stepDrawing(state, event, ctx);
  }
}
