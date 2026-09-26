import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZE,
  DEFAULT_STYLE,
  type Effect,
  type Handle,
  initialToolState,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolId,
  type ToolState,
} from '../src';

const rectShape: Shape = {
  id: 'r1',
  type: 'rect',
  x: 100,
  y: 100,
  w: 160,
  h: 96,
  z: 'a0',
  style: DEFAULT_STYLE.rect,
  text: '',
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 0,
};
const farShape: Shape = { ...rectShape, id: 'r2', x: 400, y: 400 };

function ctx(shapes: Record<string, Shape> = { r1: rectShape }): ToolContext {
  let n = 0;
  return {
    shapes,
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => `new${++n}`,
    now: () => 1000,
  };
}

const at = (
  x: number,
  y: number,
  hitId: string | null = null,
  shift = false,
  handle?: Handle,
): PointerInfo => ({ world: { x, y }, shift, hitId, ...(handle ? { handle } : {}) });

const idle = (tool: ToolId, selection: string[]): ToolState => ({ mode: 'idle', tool, selection });

const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('select tool — click and drag', () => {
  it('clicking empty canvas clears the selection', () => {
    const c = ctx();
    const down = step(idle('select', ['r1']), { type: 'pointerDown', p: at(0, 0) }, c);
    expect(down.state.mode).toBe('marquee');
    const up = step(down.state, { type: 'pointerUp', p: at(1, 1) }, c);
    expect(up.state).toEqual(idle('select', []));
    expect(up.effects).toEqual([]);
  });

  it('shift-clicking empty canvas keeps the selection', () => {
    const c = ctx();
    const down = step(idle('select', ['r1']), { type: 'pointerDown', p: at(0, 0, null, true) }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(0, 0, null, true) }, c);
    expect(up.state).toEqual(idle('select', ['r1']));
  });

  it('clicking a shape selects it and starts a drag', () => {
    const r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, ctx());
    expect(r.state.mode).toBe('dragging');
    expect(r.state.selection).toEqual(['r1']);
  });

  it('shift-click toggles membership', () => {
    const c = ctx({ r1: rectShape, r2: farShape });
    const added = step(idle('select', ['r1']), { type: 'pointerDown', p: at(0, 0, 'r2', true) }, c);
    expect(added.state.selection).toEqual(['r1', 'r2']);
    const removed = step(
      idle('select', ['r1', 'r2']),
      { type: 'pointerDown', p: at(0, 0, 'r2', true) },
      c,
    );
    expect(removed.state).toEqual(idle('select', ['r1']));
  });

  it('dragging shows a local overlay every move, throttles commits, and lands exactly', () => {
    const c = ctx();
    let r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    r = step(r.state, { type: 'pointerMove', p: at(121, 120) }, c);
    expect(r.effects).toEqual([]); // below the drag threshold
    r = step(r.state, { type: 'pointerMove', p: at(130, 125) }, c);
    expect(r.effects).toEqual([
      { type: 'overlay', rects: { r1: { x: 110, y: 105, w: 160, h: 96 } } },
      {
        type: 'command',
        command: { type: 'MoveShapes', moves: [{ id: 'r1', x: 110, y: 105 }] },
        throttle: true,
      },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(140, 130) }, c);
    expect(r.state).toEqual(idle('select', ['r1']));
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'MoveShapes', moves: [{ id: 'r1', x: 120, y: 110 }] },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('a click without movement emits nothing', () => {
    const c = ctx();
    const down = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(121, 121) }, c);
    expect(up.effects).toEqual([]);
  });

  it('cancel during a drag restores the original positions and clears the overlay', () => {
    const c = ctx();
    let r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    r = step(r.state, { type: 'pointerMove', p: at(200, 200) }, c);
    r = step(r.state, { type: 'cancel' }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 'r1', x: 100, y: 100 }] },
    ]);
    expect(r.effects).toContainEqual({ type: 'overlay', rects: null });
    expect(r.state.mode).toBe('idle');
  });

  it('deleteSelection deletes and clears', () => {
    const r = step(idle('select', ['r1']), { type: 'deleteSelection' }, ctx());
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['r1'] }]);
    expect(r.state.selection).toEqual([]);
  });

  it('double-click on a text-capable shape opens the editor', () => {
    const r = step(initialToolState(), { type: 'doubleClick', p: at(0, 0, 'r1') }, ctx());
    expect(r.effects).toEqual([{ type: 'editText', id: 'r1' }]);
    expect(r.state.selection).toEqual(['r1']);
  });
});

describe('select tool — marquee', () => {
  const c = () => ctx({ r1: rectShape, r2: farShape });

  it('selects intersecting shapes live and previews the marquee', () => {
    let r = step(initialToolState(), { type: 'pointerDown', p: at(90, 90) }, c());
    r = step(r.state, { type: 'pointerMove', p: at(150, 150) }, c());
    expect(r.state.selection).toEqual(['r1']);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'marquee', rect: { x: 90, y: 90, w: 60, h: 60 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(150, 150) }, c());
    expect(r.state).toEqual(idle('select', ['r1']));
    expect(r.effects).toEqual([{ type: 'preview', preview: null }]);
  });

  it('shift-marquee adds to the existing selection', () => {
    let r = step(idle('select', ['r2']), { type: 'pointerDown', p: at(90, 90, null, true) }, c());
    r = step(r.state, { type: 'pointerMove', p: at(150, 150, null, true) }, c());
    r = step(r.state, { type: 'pointerUp', p: at(150, 150, null, true) }, c());
    expect(r.state.selection).toEqual(['r2', 'r1']);
  });

  it('cancel restores the selection the marquee started from', () => {
    let r = step(idle('select', ['r2']), { type: 'pointerDown', p: at(90, 90, null, true) }, c());
    r = step(r.state, { type: 'pointerMove', p: at(150, 150, null, true) }, c());
    r = step(r.state, { type: 'cancel' }, c());
    expect(r.state).toEqual(idle('select', ['r2']));
    expect(r.effects).toEqual([{ type: 'preview', preview: null }]);
  });
});

describe('select tool — resize', () => {
  const se = (x: number, y: number, shift = false) => at(x, y, null, shift, 'se');

  it('resizes from a handle with an overlay, throttled commits and a final commit', () => {
    const c = ctx();
    let r = step(idle('select', ['r1']), { type: 'pointerDown', p: se(260, 196) }, c);
    expect(r.state.mode).toBe('resizing');
    r = step(r.state, { type: 'pointerMove', p: se(280, 206) }, c);
    expect(r.effects).toEqual([
      { type: 'overlay', rects: { r1: { x: 100, y: 100, w: 180, h: 106 } } },
      {
        type: 'command',
        command: { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 180, h: 106 }] },
        throttle: true,
      },
    ]);
    r = step(r.state, { type: 'pointerUp', p: se(290, 216) }, c);
    expect(r.state).toEqual(idle('select', ['r1']));
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 190, h: 116 }] },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('shift keeps the aspect ratio', () => {
    const c = ctx();
    let r = step(idle('select', ['r1']), { type: 'pointerDown', p: se(260, 196) }, c);
    r = step(r.state, { type: 'pointerUp', p: se(340, 196, true) }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 240, h: 144 }] },
    ]);
  });

  it('cancel restores the start geometry', () => {
    const c = ctx();
    let r = step(idle('select', ['r1']), { type: 'pointerDown', p: se(260, 196) }, c);
    r = step(r.state, { type: 'pointerMove', p: se(300, 250) }, c);
    r = step(r.state, { type: 'cancel' }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'ResizeShapes', rects: [{ id: 'r1', x: 100, y: 100, w: 160, h: 96 }] },
    ]);
    expect(r.state.mode).toBe('idle');
  });

  it('ignores handles unless exactly one shape is selected', () => {
    const c = ctx({ r1: rectShape, r2: farShape });
    const r = step(idle('select', ['r1', 'r2']), { type: 'pointerDown', p: se(260, 196) }, c);
    expect(r.state.mode).toBe('marquee');
  });
});

describe('nudge', () => {
  it('moves the selection by the delta as one gesture', () => {
    const r = step(idle('select', ['r1']), { type: 'nudge', dx: 10, dy: -1 }, ctx());
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 'r1', x: 110, y: 99 }] },
    ]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
    expect(r.state).toEqual(idle('select', ['r1']));
  });

  it('does nothing without a selection', () => {
    expect(step(initialToolState(), { type: 'nudge', dx: 1, dy: 0 }, ctx()).effects).toEqual([]);
  });
});

describe('creation tools', () => {
  it('sticky creates a centered sticky, selects it and opens the editor', () => {
    const r = step(idle('sticky', []), { type: 'pointerDown', p: at(500, 400) }, ctx());
    expect(commands(r.effects)).toEqual([
      {
        type: 'CreateShape',
        shape: {
          id: 'new1',
          type: 'sticky',
          x: 410,
          y: 330,
          w: 180,
          h: 140,
          style: DEFAULT_STYLE.sticky,
          text: '',
          createdBy: 'u1',
          authorName: 'Brisk Otter',
          createdAt: 1000,
        },
      },
    ]);
    expect(r.effects).toContainEqual({ type: 'editText', id: 'new1' });
    expect(r.state).toEqual(idle('select', ['new1']));
  });

  it('code creates a centered code block and opens the editor', () => {
    const r = step(idle('code', []), { type: 'pointerDown', p: at(500, 400) }, ctx());
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'code', x: 360, y: 330, w: 280, h: 140, style: DEFAULT_STYLE.code },
    });
    expect(r.effects).toContainEqual({ type: 'editText', id: 'new1' });
  });

  it('rect tool draws with a rect preview and creates on release', () => {
    const c = ctx();
    let r = step(idle('rect', []), { type: 'pointerDown', p: at(10, 10) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, 40) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'rect', rect: { x: 10, y: 10, w: 50, h: 30 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(60, 40) }, c);
    expect(r.effects[0]).toEqual({ type: 'preview', preview: null });
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'rect', x: 10, y: 10, w: 50, h: 30 },
    });
    expect(r.state).toEqual(idle('select', ['new1']));
  });

  it('a click with a drawing tool creates the default size', () => {
    for (const tool of ['rect', 'ellipse'] as const) {
      const c = ctx();
      const down = step(idle(tool, []), { type: 'pointerDown', p: at(10, 10) }, c);
      const up = step(down.state, { type: 'pointerUp', p: at(11, 11) }, c);
      expect(commands(up.effects)[0]).toMatchObject({
        shape: { type: tool, x: 10, y: 10, ...DEFAULT_SIZE[tool] },
      });
    }
  });

  it('ellipse tool previews an ellipse', () => {
    const c = ctx();
    let r = step(idle('ellipse', []), { type: 'pointerDown', p: at(10, 10) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, 40) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'ellipse', rect: { x: 10, y: 10, w: 50, h: 30 } } },
    ]);
  });

  it('line tool keeps the signed start→end vector', () => {
    const c = ctx();
    let r = step(idle('line', []), { type: 'pointerDown', p: at(10, 10) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, -20) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'line', rect: { x: 10, y: 10, w: 50, h: -30 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(60, -20) }, c);
    expect(commands(r.effects)[0]).toMatchObject({
      shape: { type: 'line', x: 10, y: 10, w: 50, h: -30 },
    });
  });

  it('a click with the line tool creates a default horizontal line', () => {
    const c = ctx();
    const down = step(idle('line', []), { type: 'pointerDown', p: at(10, 10) }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(11, 10) }, c);
    expect(commands(up.effects)[0]).toMatchObject({
      shape: { type: 'line', x: 10, y: 10, w: DEFAULT_SIZE.line.w, h: 0 },
    });
  });

  it('setTool clears the selection unless switching to select', () => {
    const s = idle('select', ['r1']);
    expect(step(s, { type: 'setTool', tool: 'ellipse' }, ctx()).state.selection).toEqual([]);
    expect(step(s, { type: 'setTool', tool: 'select' }, ctx()).state.selection).toEqual(['r1']);
  });
});
