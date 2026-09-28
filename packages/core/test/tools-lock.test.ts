import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  type Effect,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolState,
} from '../src';

const base: Omit<Shape, 'id'> = {
  type: 'rect',
  x: 100,
  y: 100,
  w: 160,
  h: 96,
  z: 'a1',
  style: DEFAULT_STYLE.rect,
  text: '',
  createdBy: 'u1',
  authorName: 'Brisk Otter',
  createdAt: 0,
};
const locked: Shape = { ...base, id: 'r1', locked: true };
const free: Shape = { ...base, id: 'r2', x: 400 };
const frame: Shape = {
  ...base,
  id: 'f1',
  type: 'frame',
  x: 0,
  y: 0,
  w: 720,
  h: 440,
  z: 'a0',
  style: DEFAULT_STYLE.frame,
  columns: [{ id: 'c1', title: 'A' }],
};

function ctx(shapes: Shape[]): ToolContext {
  return {
    shapes: Object.fromEntries(shapes.map((s) => [s.id, s])),
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => 'new',
    now: () => 0,
  };
}
const idle = (selection: string[]): ToolState => ({ mode: 'idle', tool: 'select', selection });
const at = (x: number, y: number, hitId: string | null, extra: Partial<PointerInfo> = {}) => ({
  world: { x, y },
  shift: false,
  hitId,
  ...extra,
});
const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('tool machine lock rules', () => {
  it('pressing a locked shape selects it without starting a drag', () => {
    const r = step(idle([]), { type: 'pointerDown', p: at(120, 120, 'r1') }, ctx([locked]));
    expect(r.state).toEqual(idle(['r1']));
  });

  it('dragging a mixed selection moves only the unlocked shapes', () => {
    const c = ctx([locked, free]);
    const down = step(idle(['r1', 'r2']), { type: 'pointerDown', p: at(420, 120, 'r2') }, c);
    expect(down.state.mode).toBe('dragging');
    if (down.state.mode !== 'dragging') return;
    expect(Object.keys(down.state.starts)).toEqual(['r2']);
  });

  it('a resize handle on a locked shape is ignored', () => {
    const r = step(
      idle(['r1']),
      { type: 'pointerDown', p: at(260, 196, 'r1', { handle: 'se' }) },
      ctx([locked]),
    );
    expect(r.state.mode).not.toBe('resizing');
  });

  it('delete skips locked shapes and keeps them selected', () => {
    const r = step(idle(['r1', 'r2']), { type: 'deleteSelection' }, ctx([locked, free]));
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['r2'] }]);
    expect(r.state).toEqual(idle(['r1']));
  });

  it('delete of only locked shapes does nothing', () => {
    const r = step(idle(['r1']), { type: 'deleteSelection' }, ctx([locked]));
    expect(r.effects).toEqual([]);
  });

  it('nudge skips locked shapes', () => {
    const r = step(idle(['r1']), { type: 'nudge', dx: 1, dy: 0 }, ctx([locked]));
    expect(r.effects).toEqual([]);
  });

  it('double-click on a locked text-bearing shape does not open the editor', () => {
    const r = step(idle(['r1']), { type: 'doubleClick', p: at(120, 120, 'r1') }, ctx([locked]));
    expect(r.effects).toEqual([]);
  });

  it('double-click on a locked frame column does not edit the column', () => {
    const lockedFrame: Shape = { ...frame, locked: true };
    const r = step(
      idle([]),
      { type: 'doubleClick', p: at(10, 50, 'f1', { column: { frameId: 'f1', columnId: 'c1' } }) },
      ctx([lockedFrame]),
    );
    expect(r.effects).toEqual([]);
  });

  it('dragging a frame leaves its locked children in place', () => {
    const child: Shape = {
      ...base,
      id: 'k1',
      x: 20,
      y: 80,
      parentId: 'f1',
      columnId: 'c1',
      locked: true,
    };
    const c = ctx([frame, child]);
    const down = step(idle(['f1']), { type: 'pointerDown', p: at(10, 10, 'f1') }, c);
    expect(down.state.mode).toBe('dragging');
    if (down.state.mode !== 'dragging') return;
    expect(Object.keys(down.state.starts)).toEqual(['f1']);
  });
});
