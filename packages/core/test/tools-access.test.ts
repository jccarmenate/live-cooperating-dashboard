import { describe, expect, it } from 'vitest';
import {
  type BoardAccess,
  type Connector,
  DEFAULT_STYLE,
  type Effect,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolEvent,
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
const a: Shape = { ...base, id: 'a' };
const b: Shape = { ...base, id: 'b', x: 400 };
const note: Shape = { ...base, id: 'n', type: 'sticky', x: 700, style: DEFAULT_STYLE.sticky };
const frame: Shape = {
  ...base,
  id: 'f',
  type: 'frame',
  x: 0,
  y: 300,
  w: 720,
  h: 440,
  z: 'a0',
  style: DEFAULT_STYLE.frame,
  columns: [{ id: 'c1', title: 'A' }],
};
const link: Connector = {
  id: 'k',
  from: { shapeId: 'a', anchor: 'auto' },
  to: { shapeId: 'b', anchor: 'auto' },
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

function ctx(access: BoardAccess): ToolContext {
  return {
    shapes: Object.fromEntries([a, b, note, frame].map((s) => [s.id, s])),
    connectors: { k: link },
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => 'new',
    now: () => 0,
    access,
  };
}
const idle = (selection: string[], tool: ToolState['tool'] = 'select'): ToolState =>
  ({ mode: 'idle', tool, selection }) as ToolState;
const at = (x: number, y: number, hitId: string | null, extra: Partial<PointerInfo> = {}) => ({
  world: { x, y },
  shift: false,
  hitId,
  ...extra,
});
const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

/** Runs events in order and collects every effect. */
function run(state: ToolState, events: ToolEvent[], access: BoardAccess) {
  const effects: Effect[] = [];
  let s = state;
  for (const event of events) {
    const r = step(s, event, ctx(access));
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

describe.each<BoardAccess>(['read-only', 'delete-only'])(
  'tool machine with %s access',
  (access) => {
    it('a press on a shape selects it and a drag moves nothing', () => {
      const r = run(
        idle([]),
        [
          { type: 'pointerDown', p: at(120, 120, 'a') },
          { type: 'pointerMove', p: at(300, 300, null) },
          { type: 'pointerUp', p: at(300, 300, null) },
        ],
        access,
      );
      expect(r.state).toEqual(idle(['a']));
      expect(r.effects).toEqual([]);
    });

    it('Shift adds to the selection and takes from it; a connector selects too', () => {
      const add = step(
        idle(['a']),
        { type: 'pointerDown', p: at(420, 120, 'b', { shift: true }) },
        ctx(access),
      );
      expect(add.state).toEqual(idle(['a', 'b']));
      const take = step(
        idle(['a', 'b']),
        { type: 'pointerDown', p: at(420, 120, 'b', { shift: true }) },
        ctx(access),
      );
      expect(take.state).toEqual(idle(['a']));
      const edge = step(
        idle([]),
        { type: 'pointerDown', p: at(300, 150, null, { connectorId: 'k' }) },
        ctx(access),
      );
      expect(edge.state).toEqual(idle(['k']));
    });

    it('a press on a resize handle does not resize', () => {
      const r = run(
        idle(['a']),
        [
          { type: 'pointerDown', p: at(260, 196, 'a', { handle: 'se' }) },
          { type: 'pointerMove', p: at(400, 400, null) },
          { type: 'pointerUp', p: at(400, 400, null) },
        ],
        access,
      );
      expect(r.state).toEqual(idle(['a']));
      expect(commands(r.effects)).toEqual([]);
    });

    it('a drag on empty canvas is still a marquee', () => {
      const r = run(
        idle([]),
        [
          { type: 'pointerDown', p: at(50, 50, null) },
          { type: 'pointerMove', p: at(600, 250, null) },
          { type: 'pointerUp', p: at(600, 250, null) },
        ],
        access,
      );
      expect(r.state).toEqual(idle(['a', 'b']));
      expect(commands(r.effects)).toEqual([]);
    });

    it('no tool but select exists: a drawing tool draws nothing and a click tool creates nothing', () => {
      const picked = step(idle([]), { type: 'setTool', tool: 'rect' }, ctx(access));
      expect(picked.state).toEqual(idle([]));
      for (const tool of ['rect', 'sticky', 'connector', 'frame'] as const) {
        const r = run(
          idle([], tool),
          [
            { type: 'pointerDown', p: at(900, 50, null) },
            { type: 'pointerMove', p: at(1000, 150, null) },
            { type: 'pointerUp', p: at(1000, 150, null) },
          ],
          access,
        );
        expect(r.state).toEqual(idle([]));
        expect(commands(r.effects)).toEqual([]);
        expect(r.effects.some((e) => e.type === 'editText')).toBe(false);
      }
    });

    it('a double-click edits neither text nor a column title', () => {
      const text = step(idle([]), { type: 'doubleClick', p: at(720, 120, 'n') }, ctx(access));
      expect(text.effects).toEqual([]);
      const column = step(
        idle([]),
        { type: 'doubleClick', p: at(20, 350, 'f', { column: { frameId: 'f', columnId: 'c1' } }) },
        ctx(access),
      );
      expect(column.effects).toEqual([]);
    });

    it('nudging and routing change nothing', () => {
      expect(step(idle(['a']), { type: 'nudge', dx: 10, dy: 0 }, ctx(access)).effects).toEqual([]);
      expect(step(idle(['k']), { type: 'toggleRouting' }, ctx(access)).effects).toEqual([]);
    });

    it('a gesture under way when the board stopped being editable is dropped', () => {
      const dragging: ToolState = {
        mode: 'dragging',
        tool: 'select',
        selection: ['a'],
        origin: { x: 120, y: 120 },
        starts: { a: { x: 100, y: 100, w: 160, h: 96 } },
        moved: true,
      };
      const r = step(dragging, { type: 'pointerMove', p: at(300, 300, null) }, ctx(access));
      expect(r.state).toEqual(idle(['a']));
      expect(r.effects).toEqual([
        { type: 'overlay', rects: null },
        { type: 'preview', preview: null },
      ]);
    });
  },
);

describe('deleting by access', () => {
  it('read-only deletes nothing', () => {
    const r = step(idle(['a', 'k']), { type: 'deleteSelection' }, ctx('read-only'));
    expect(r.state).toEqual(idle(['a', 'k']));
    expect(r.effects).toEqual([]);
  });

  it('delete-only deletes the selection as an editor would', () => {
    const r = step(idle(['a', 'k']), { type: 'deleteSelection' }, ctx('delete-only'));
    expect(r.state).toEqual(idle([]));
    expect(commands(r.effects)).toEqual([{ type: 'DeleteShapes', ids: ['a', 'k'] }]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('edit access is the machine as it always was', () => {
    const down = step(idle([]), { type: 'pointerDown', p: at(120, 120, 'a') }, ctx('edit'));
    expect(down.state.mode).toBe('dragging');
  });
});
