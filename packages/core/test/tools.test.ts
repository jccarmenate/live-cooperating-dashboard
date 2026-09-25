import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  type Effect,
  initialToolState,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
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

const at = (x: number, y: number, hitId: string | null = null, shift = false): PointerInfo => ({
  world: { x, y },
  shift,
  hitId,
});

const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('select tool', () => {
  it('clicking empty canvas clears the selection', () => {
    const s: ToolState = { mode: 'idle', tool: 'select', selection: ['r1'] };
    const r = step(s, { type: 'pointerDown', p: at(0, 0) }, ctx());
    expect(r.state).toEqual({ mode: 'idle', tool: 'select', selection: [] });
  });

  it('clicking a shape selects it and starts a drag', () => {
    const r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, ctx());
    expect(r.state.mode).toBe('dragging');
    expect(r.state.selection).toEqual(['r1']);
  });

  it('shift-click toggles membership', () => {
    const c = ctx({ r1: rectShape, r2: { ...rectShape, id: 'r2' } });
    const s: ToolState = { mode: 'idle', tool: 'select', selection: ['r1'] };
    const added = step(s, { type: 'pointerDown', p: at(0, 0, 'r2', true) }, c);
    expect(added.state.selection).toEqual(['r1', 'r2']);
    const removed = step(
      { mode: 'idle', tool: 'select', selection: ['r1', 'r2'] },
      { type: 'pointerDown', p: at(0, 0, 'r2', true) },
      c,
    );
    expect(removed.state).toEqual({ mode: 'idle', tool: 'select', selection: ['r1'] });
  });

  it('dragging emits throttled moves, then a final move and endGesture', () => {
    const c = ctx();
    let r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    r = step(r.state, { type: 'pointerMove', p: at(121, 120) }, c);
    expect(r.effects).toEqual([]); // below threshold
    r = step(r.state, { type: 'pointerMove', p: at(130, 125) }, c);
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'MoveShapes', moves: [{ id: 'r1', x: 110, y: 105 }] },
        throttle: true,
      },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(140, 130) }, c);
    expect(r.state).toEqual({ mode: 'idle', tool: 'select', selection: ['r1'] });
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'MoveShapes', moves: [{ id: 'r1', x: 120, y: 110 }] },
        throttle: false,
      },
      { type: 'endGesture' },
    ]);
  });

  it('a click without movement emits nothing', () => {
    const c = ctx();
    const down = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    const up = step(down.state, { type: 'pointerUp', p: at(121, 121) }, c);
    expect(up.effects).toEqual([]);
  });

  it('cancel during a drag restores original positions', () => {
    const c = ctx();
    let r = step(initialToolState(), { type: 'pointerDown', p: at(120, 120, 'r1') }, c);
    r = step(r.state, { type: 'pointerMove', p: at(200, 200) }, c);
    r = step(r.state, { type: 'cancel' }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 'r1', x: 100, y: 100 }] },
    ]);
    expect(r.state.mode).toBe('idle');
  });

  it('deleteSelection deletes and clears', () => {
    const s: ToolState = { mode: 'idle', tool: 'select', selection: ['r1'] };
    const r = step(s, { type: 'deleteSelection' }, ctx());
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['r1'] }]);
    expect(r.state.selection).toEqual([]);
  });

  it('double-click on a text-capable shape opens the editor', () => {
    const r = step(initialToolState(), { type: 'doubleClick', p: at(0, 0, 'r1') }, ctx());
    expect(r.effects).toEqual([{ type: 'editText', id: 'r1' }]);
    expect(r.state.selection).toEqual(['r1']);
  });
});

describe('creation tools', () => {
  it('sticky creates a centered sticky, selects it and opens the editor', () => {
    const r = step(
      { mode: 'idle', tool: 'sticky', selection: [] },
      { type: 'pointerDown', p: at(500, 400) },
      ctx(),
    );
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
    expect(r.state).toEqual({ mode: 'idle', tool: 'select', selection: ['new1'] });
  });

  it('rect tool draws with a preview and creates on release', () => {
    const c = ctx();
    let r = step(
      { mode: 'idle', tool: 'rect', selection: [] },
      { type: 'pointerDown', p: at(10, 10) },
      c,
    );
    r = step(r.state, { type: 'pointerMove', p: at(60, 40) }, c);
    expect(r.effects).toEqual([{ type: 'preview', rect: { x: 10, y: 10, w: 50, h: 30 } }]);
    r = step(r.state, { type: 'pointerUp', p: at(60, 40) }, c);
    expect(r.effects[0]).toEqual({ type: 'preview', rect: null });
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'rect', x: 10, y: 10, w: 50, h: 30 },
    });
    expect(r.state).toEqual({ mode: 'idle', tool: 'select', selection: ['new1'] });
  });

  it('a click with the rect tool creates a default-sized rect', () => {
    const c = ctx();
    const down = step(
      { mode: 'idle', tool: 'rect', selection: [] },
      { type: 'pointerDown', p: at(10, 10) },
      c,
    );
    const up = step(down.state, { type: 'pointerUp', p: at(11, 11) }, c);
    expect(commands(up.effects)[0]).toMatchObject({
      shape: { x: 10, y: 10, w: 160, h: 96 },
    });
  });

  it('setTool clears the selection unless switching to select', () => {
    const s: ToolState = { mode: 'idle', tool: 'select', selection: ['r1'] };
    expect(step(s, { type: 'setTool', tool: 'rect' }, ctx()).state.selection).toEqual([]);
    expect(step(s, { type: 'setTool', tool: 'select' }, ctx()).state.selection).toEqual(['r1']);
  });
});
