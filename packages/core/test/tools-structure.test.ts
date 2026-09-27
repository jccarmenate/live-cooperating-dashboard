import { describe, expect, it } from 'vitest';
import {
  type Connector,
  DEFAULT_COLUMNS,
  DEFAULT_STYLE,
  type Effect,
  type PointerInfo,
  type Shape,
  step,
  type ToolContext,
  type ToolId,
  type ToolState,
} from '../src';

function shape(id: string, partial: Partial<Shape>): Shape {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    z: 'a1',
    style: DEFAULT_STYLE.rect,
    text: '',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 0,
    ...partial,
  };
}

const f1 = shape('f1', {
  type: 'frame',
  x: 0,
  y: 0,
  w: 600,
  h: 400,
  z: 'a0',
  style: DEFAULT_STYLE.frame,
  columns: [
    { id: 'c1', title: 'Went well' },
    { id: 'c2', title: 'To improve' },
    { id: 'c3', title: 'Actions' },
  ],
});
const s1 = shape('s1', {
  type: 'sticky',
  x: 20,
  y: 60,
  w: 160,
  h: 120,
  parentId: 'f1',
  columnId: 'c1',
});
const a = shape('a', { x: 1000, y: 0 }); // centre (1050, 25)
const b = shape('b', { x: 1300, y: 200 }); // centre (1350, 225)

const k1: Connector = {
  id: 'k1',
  from: { shapeId: 'a', anchor: 'auto' },
  to: { shapeId: 'b', anchor: 'auto' },
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

function ctx(): ToolContext {
  let n = 0;
  return {
    shapes: { f1, s1, a, b },
    connectors: { k1 },
    userId: 'u1',
    userName: 'Brisk Otter',
    newId: () => `new${++n}`,
    now: () => 1000,
  };
}

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
  world: { x, y },
  shift: false,
  hitId: null,
  ...extra,
});
const idle = (tool: ToolId, selection: string[]): ToolState => ({ mode: 'idle', tool, selection });
const commands = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'command' ? [e.command] : []));

describe('connector tool', () => {
  it('connects two shapes with a clipped preview while dragging', () => {
    const c = ctx();
    let r = step(
      idle('connector', []),
      { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) },
      c,
    );
    expect(r.state.mode).toBe('connecting');
    r = step(r.state, { type: 'pointerMove', p: at(1350, 225) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'line', rect: { x: 1087.5, y: 50, w: 262.5, h: 175 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(1350, 225, { hitId: 'b' }) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: null },
      {
        type: 'command',
        command: {
          type: 'Connect',
          connector: {
            id: 'new1',
            from: { shapeId: 'a', anchor: 'auto' },
            to: { shapeId: 'b', anchor: 'auto' },
            routing: 'straight',
            head: 'arrow',
            createdBy: 'u1',
          },
        },
        throttle: false,
      },
      { type: 'endGesture' },
    ]);
    expect(r.state).toEqual(idle('select', ['new1']));
  });

  it('leaves a free end when released on empty canvas', () => {
    const c = ctx();
    const down = step(
      idle('connector', []),
      { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) },
      c,
    );
    const up = step(down.state, { type: 'pointerUp', p: at(800, 500) }, c);
    expect(commands(up.effects)[0]).toMatchObject({
      type: 'Connect',
      connector: { from: { shapeId: 'a', anchor: 'auto' }, to: { x: 800, y: 500 } },
    });
  });

  it('creates nothing for a release on the start shape or a tiny free drag', () => {
    const c = ctx();
    const onSelf = step(
      step(idle('connector', []), { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) }, c)
        .state,
      { type: 'pointerUp', p: at(1060, 30, { hitId: 'a' }) },
      c,
    );
    expect(commands(onSelf.effects)).toEqual([]);
    expect(onSelf.state).toEqual(idle('connector', []));
    const tiny = step(
      step(idle('connector', []), { type: 'pointerDown', p: at(700, 700) }, c).state,
      { type: 'pointerUp', p: at(701, 700) },
      c,
    );
    expect(commands(tiny.effects)).toEqual([]);
  });

  it('creates nothing if the start shape was deleted mid-gesture', () => {
    const c = ctx();
    const down = step(
      idle('connector', []),
      { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) },
      c,
    );
    const gone: ToolContext = { ...c, shapes: { f1, s1, b } };
    const up = step(down.state, { type: 'pointerUp', p: at(1350, 225, { hitId: 'b' }) }, gone);
    expect(commands(up.effects)).toEqual([]);
    expect(up.state).toEqual(idle('connector', []));
  });

  it('a drag from a shape to a nearby free point still creates a connector', () => {
    const c = ctx();
    const down = step(
      idle('connector', []),
      { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) },
      c,
    );
    const up = step(down.state, { type: 'pointerUp', p: at(1055, 25) }, c);
    expect(commands(up.effects)[0]).toMatchObject({
      type: 'Connect',
      connector: { from: { shapeId: 'a', anchor: 'auto' }, to: { x: 1055, y: 25 } },
    });
  });

  it('cancel while connecting returns to the connector tool with no preview', () => {
    const c = ctx();
    const down = step(
      idle('connector', []),
      { type: 'pointerDown', p: at(1050, 25, { hitId: 'a' }) },
      c,
    );
    const r = step(down.state, { type: 'cancel' }, c);
    expect(r).toEqual({
      state: idle('connector', []),
      effects: [{ type: 'preview', preview: null }],
    });
  });
});

describe('connector selection and routing', () => {
  it('selects a connector without starting a drag or marquee', () => {
    const r = step(
      idle('select', []),
      { type: 'pointerDown', p: at(1200, 120, { connectorId: 'k1' }) },
      ctx(),
    );
    expect(r.state).toEqual(idle('select', ['k1']));
  });

  it('shift-click on a connector toggles it in and out of the selection', () => {
    const c = ctx();
    let r = step(
      idle('select', []),
      { type: 'pointerDown', p: at(1200, 120, { connectorId: 'k1', shift: true }) },
      c,
    );
    expect(r.state).toEqual(idle('select', ['k1']));
    r = step(
      r.state,
      { type: 'pointerDown', p: at(1200, 120, { connectorId: 'k1', shift: true }) },
      c,
    );
    expect(r.state).toEqual(idle('select', []));
  });

  it('ignores a connectorId that does not resolve to a live connector', () => {
    const r = step(
      idle('select', []),
      { type: 'pointerDown', p: at(50, 50, { connectorId: 'ghost' }) },
      ctx(),
    );
    expect(r.state.mode).toBe('marquee');
  });

  it('toggleRouting flips the selected connectors as one gesture', () => {
    const r = step(idle('select', ['k1', 'a']), { type: 'toggleRouting' }, ctx());
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'SetRouting', id: 'k1', routing: 'elbow' },
        throttle: false,
      },
      { type: 'endGesture' },
    ]);
  });

  it('toggleRouting does nothing when no selected id is a connector', () => {
    const r = step(idle('select', ['a', 'b']), { type: 'toggleRouting' }, ctx());
    expect(r.effects).toEqual([]);
  });
});

describe('frames', () => {
  it('the frame tool creates a frame with the default columns', () => {
    const c = ctx();
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(2000, 0) }, c);
    expect(r.effects).toEqual([
      { type: 'preview', preview: { kind: 'rect', rect: { x: 2000, y: 0, w: 0, h: 0 } } },
    ]);
    r = step(r.state, { type: 'pointerUp', p: at(2600, 400) }, c);
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: {
        id: 'new1',
        type: 'frame',
        x: 2000,
        y: 0,
        w: 600,
        h: 400,
        columns: DEFAULT_COLUMNS.map((title, i) => ({ id: `new${i + 2}`, title })),
      },
    });
  });

  it('new shapes created inside a frame column get that parent and column', () => {
    const r = step(idle('sticky', []), { type: 'pointerDown', p: at(300, 200) }, ctx());
    expect(commands(r.effects)[0]).toMatchObject({
      type: 'CreateShape',
      shape: { type: 'sticky', parentId: 'f1', columnId: 'c2' },
    });
  });

  it('dragging a frame moves its children without reparenting them', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(10, 10, { hitId: 'f1' }) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(60, 10) }, c);
    expect(r.effects[0]).toEqual({
      type: 'overlay',
      rects: { f1: { x: 50, y: 0, w: 600, h: 400 }, s1: { x: 70, y: 60, w: 160, h: 120 } },
    });
    r = step(r.state, { type: 'pointerUp', p: at(60, 10) }, c);
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: {
          type: 'MoveShapes',
          moves: [
            { id: 'f1', x: 50, y: 0 },
            { id: 's1', x: 70, y: 60 },
          ],
        },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('dragging a frame together with its pre-selected child does not reparent the child', () => {
    const c = ctx();
    let r = step(
      idle('select', ['f1', 's1']),
      { type: 'pointerDown', p: at(10, 10, { hitId: 'f1' }) },
      c,
    );
    r = step(r.state, { type: 'pointerMove', p: at(60, 10) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(60, 10) }, c);
    expect(commands(r.effects)).toEqual([
      {
        type: 'MoveShapes',
        moves: [
          { id: 'f1', x: 50, y: 0 },
          { id: 's1', x: 70, y: 60 },
        ],
      },
    ]);
  });

  it('dragging a frame onto another frame does not reparent it (frames never nest)', () => {
    const c0 = ctx();
    const f2 = shape('f2', {
      type: 'frame',
      x: 900,
      y: 0,
      w: 600,
      h: 400,
      z: 'a2',
      style: DEFAULT_STYLE.frame,
      columns: [{ id: 'd1', title: 'Notes' }],
    });
    const c: ToolContext = { ...c0, shapes: { ...c0.shapes, f2 } };
    let r = step(idle('select', []), { type: 'pointerDown', p: at(10, 10, { hitId: 'f1' }) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(910, 10) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(910, 10) }, c);
    // f1 itself is never adopted (frames never nest), but moving it onto f2's territory
    // exposes loose shapes a (centre 1050,25) and b (centre 1350,225) to f2, the topmost
    // frame now covering them: a's centre is in f2's title band, b's is in column d1.
    expect(commands(r.effects)).toEqual([
      {
        type: 'MoveShapes',
        moves: [
          { id: 'f1', x: 900, y: 0 },
          { id: 's1', x: 920, y: 60 },
        ],
      },
      {
        type: 'Reparent',
        moves: [
          { id: 'a', parentId: 'f2', columnId: null },
          { id: 'b', parentId: 'f2', columnId: 'd1' },
        ],
      },
    ]);
  });

  it('ignores a column whose frameId is not a live frame', () => {
    const r = step(
      idle('select', []),
      { type: 'doubleClick', p: at(10, 10, { column: { frameId: 'ghost', columnId: 'c1' } }) },
      ctx(),
    );
    expect(r).toEqual({ state: idle('select', []), effects: [] });
  });

  it('dropping a sticky into another column reparents it', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(100, 100, { hitId: 's1' }) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(300, 100) }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 's1', x: 220, y: 60 }] },
      { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c2' }] },
    ]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('dropping a sticky outside every frame unparents it', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(100, 100, { hitId: 's1' }) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(900, 700) }, c);
    expect(commands(r.effects)[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 's1', parentId: null, columnId: null }],
    });
  });

  it('a marquee selects a frame only when it is fully inside', () => {
    const c = ctx();
    let r = step(idle('select', []), { type: 'pointerDown', p: at(10, 50) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(190, 190) }, c);
    expect(r.state.selection).toEqual(['s1']);
    r = step(idle('select', []), { type: 'pointerDown', p: at(-10, -10) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(700, 500) }, c);
    expect(r.state.selection).toEqual(['f1', 's1']);
  });

  it('double-clicking a column header edits that column; the title band edits the frame title', () => {
    const header = step(
      idle('select', []),
      {
        type: 'doubleClick',
        p: at(250, 50, { hitId: 'f1', column: { frameId: 'f1', columnId: 'c2' } }),
      },
      ctx(),
    );
    expect(header.effects).toEqual([{ type: 'editColumn', frameId: 'f1', columnId: 'c2' }]);
    expect(header.state.selection).toEqual(['f1']);
    const title = step(
      idle('select', []),
      { type: 'doubleClick', p: at(250, 10, { hitId: 'f1' }) },
      ctx(),
    );
    expect(title.effects).toEqual([{ type: 'editText', id: 'f1' }]);
  });

  it('double-clicking an unknown columnId on a real frame does not emit editColumn', () => {
    const r = step(
      idle('select', []),
      {
        type: 'doubleClick',
        p: at(250, 50, { column: { frameId: 'f1', columnId: 'nope' } }),
      },
      ctx(),
    );
    expect(r.effects.some((e) => e.type === 'editColumn')).toBe(false);
  });

  it('nudging a frame moves its children too', () => {
    const r = step(idle('select', ['f1']), { type: 'nudge', dx: 1, dy: 0 }, ctx());
    expect(commands(r.effects)).toEqual([
      {
        type: 'MoveShapes',
        moves: [
          { id: 'f1', x: 1, y: 0 },
          { id: 's1', x: 21, y: 60 },
        ],
      },
    ]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('nudging a shape into another column reparents it', () => {
    const r = step(idle('select', ['s1']), { type: 'nudge', dx: 200, dy: 0 }, ctx());
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 's1', x: 220, y: 60 }] },
      { type: 'Reparent', moves: [{ id: 's1', parentId: 'f1', columnId: 'c2' }] },
    ]);
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });
});

describe('frame membership (adoption)', () => {
  // Centre (780, 120): outside f1 (x 0..600).
  const loose = shape('loose', { type: 'sticky', x: 700, y: 60, w: 160, h: 120 });

  function ctxWith(extra: Record<string, Shape>): ToolContext {
    let n = 0;
    return {
      shapes: { f1, s1, a, b, ...extra },
      connectors: { k1 },
      userId: 'u1',
      userName: 'Brisk Otter',
      newId: () => `new${++n}`,
      now: () => 1000,
    };
  }

  it('drawing a frame adopts the shapes whose centre it covers', () => {
    const c = ctxWith({ loose });
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(650, 0) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(1250, 400) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(1250, 400) }, c);
    // new1 is the frame; new2..new4 are its columns (650..850, 850..1050, 1050..1250).
    const cmds = commands(r.effects);
    expect(cmds.map((x) => x.type)).toEqual(['CreateShape', 'Reparent']);
    expect(cmds[1]).toEqual({
      type: 'Reparent',
      moves: [
        { id: 'a', parentId: 'new1', columnId: null }, // centre (1050, 25) is in the title band
        { id: 'loose', parentId: 'new1', columnId: 'new2' },
      ],
    });
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('dragging a frame over a loose shape adopts it into the column under its centre', () => {
    const c = ctxWith({ loose });
    let r = step(idle('select', []), { type: 'pointerDown', p: at(300, 10, { hitId: 'f1' }) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(600, 10) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(600, 10, { hitId: 'f1' }) }, c);
    // f1 now spans x 300..900: c1 300..500, c2 500..700, c3 700..900.
    expect(commands(r.effects)).toEqual([
      {
        type: 'MoveShapes',
        moves: [
          { id: 'f1', x: 300, y: 0 },
          { id: 's1', x: 320, y: 60 },
        ],
      },
      { type: 'Reparent', moves: [{ id: 'loose', parentId: 'f1', columnId: 'c3' }] },
    ]);
  });

  it('nudging a frame adopts the shapes it now covers', () => {
    const c = ctxWith({ loose });
    const r = step(idle('select', ['f1']), { type: 'nudge', dx: 200, dy: 0 }, c);
    expect(commands(r.effects)[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 'loose', parentId: 'f1', columnId: 'c3' }],
    });
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('resizing a frame releases uncovered children and re-columns the rest in one gesture', () => {
    const held = shape('held', {
      type: 'sticky',
      x: 420,
      y: 60,
      w: 160,
      h: 120,
      parentId: 'f1',
      columnId: 'c3',
    }); // centre (500, 120)
    const mid = shape('mid', {
      type: 'sticky',
      x: 270,
      y: 60,
      w: 160,
      h: 120,
      parentId: 'f1',
      columnId: 'c2',
    }); // centre (350, 120)
    const c = ctxWith({ held, mid });
    let r = step(
      idle('select', ['f1']),
      { type: 'pointerDown', p: at(600, 200, { handle: 'e' }) },
      c,
    );
    r = step(r.state, { type: 'pointerMove', p: at(450, 200) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(450, 200) }, c);
    // f1 is now 450 wide: c1 0..150 (s1 stays), c2 150..300, c3 300..450.
    expect(r.effects).toEqual([
      {
        type: 'command',
        command: { type: 'ResizeShapes', rects: [{ id: 'f1', x: 0, y: 0, w: 450, h: 400 }] },
        throttle: false,
      },
      {
        type: 'command',
        command: {
          type: 'Reparent',
          moves: [
            { id: 'held', parentId: null, columnId: null },
            { id: 'mid', parentId: 'f1', columnId: 'c3' },
          ],
        },
        throttle: false,
      },
      { type: 'overlay', rects: null },
      { type: 'endGesture' },
    ]);
  });

  it('resizing a shape across a column boundary moves it to that column', () => {
    const c = ctxWith({});
    let r = step(
      idle('select', ['s1']),
      { type: 'pointerDown', p: at(180, 120, { handle: 'e' }) },
      c,
    );
    r = step(r.state, { type: 'pointerMove', p: at(400, 120) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(400, 120) }, c);
    // s1 becomes x 20..400, centre 210, which is in c2 (200..400).
    expect(commands(r.effects)[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 's1', parentId: 'f1', columnId: 'c2' }],
    });
  });

  it('a frame drawn flat gets the minimum frame height', () => {
    const c = ctxWith({});
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(0, 500) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(300, 510) }, c);
    const create = commands(r.effects)[0];
    expect(create?.type === 'CreateShape' && create.shape.h).toBe(64);
  });

  it('a newly drawn frame takes a shape away from a lower frame it overlaps', () => {
    const c = ctx();
    // Drawn exactly over f1 (x 0..600, y 0..400): s1 (parented to f1, centre 100,120,
    // in c1) now falls inside the new frame's territory too.
    let r = step(idle('frame', []), { type: 'pointerDown', p: at(0, 0) }, c);
    r = step(r.state, { type: 'pointerMove', p: at(600, 400) }, c);
    r = step(r.state, { type: 'pointerUp', p: at(600, 400) }, c);
    // new1 is the frame; new2..new4 are its columns (x 0..200, 200..400, 400..600).
    // The new frame gets the top z (created with z '￿'), so dropTarget picks it
    // over f1 (z 'a0') for s1's centre (100, 120), which lands in column new2 (x 0..200).
    const cmds = commands(r.effects);
    expect(cmds.map((x) => x.type)).toEqual(['CreateShape', 'Reparent']);
    expect(cmds[1]).toEqual({
      type: 'Reparent',
      moves: [{ id: 's1', parentId: 'new1', columnId: 'new2' }],
    });
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });

  it('a moving frame does not take the children of a stationary higher-z frame', () => {
    const f2 = shape('f2', {
      type: 'frame',
      x: 900,
      y: 0,
      w: 600,
      h: 400,
      z: 'a2', // higher than f1's 'a0': f2 stays topmost wherever f1 moves.
      style: DEFAULT_STYLE.frame,
      columns: [{ id: 'd1', title: 'Notes' }],
    });
    const s2 = shape('s2', {
      type: 'sticky',
      x: 920,
      y: 60,
      w: 160,
      h: 120,
      parentId: 'f2',
      columnId: 'd1',
    }); // centre (1000, 120)
    const c: ToolContext = {
      shapes: { f1, f2, s2 },
      userId: 'u1',
      userName: 'Brisk Otter',
      newId: () => 'unused',
      now: () => 1000,
    };
    // Nudge f1 (no children here) from x 0..600 to x 900..1500: it now spatially
    // covers s2's centre (1000, 120), which used to be covered only by f2.
    const r = step(idle('select', ['f1']), { type: 'nudge', dx: 900, dy: 0 }, c);
    expect(commands(r.effects)).toEqual([
      { type: 'MoveShapes', moves: [{ id: 'f1', x: 900, y: 0 }] },
    ]);
    // dropTarget sorts by z descending, so f2 (z 'a2') is checked before f1 (z 'a0') and
    // still wins for (1000, 120) — target is unchanged (f2, d1), so no Reparent is emitted.
    expect(r.effects.at(-1)).toEqual({ type: 'endGesture' });
  });
});
