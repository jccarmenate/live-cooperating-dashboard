import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CLIP_PREFIX,
  type ClipPayload,
  type Connector,
  copyPayload,
  DEFAULT_STYLE,
  MAX_PASTE_BYTES,
  MAX_PASTE_SHAPES,
  type NewShape,
  type PasteContext,
  parseClip,
  parseShape,
  pastePlan,
  pasteUpdateSize,
  plainTextSticky,
  readShape,
  type Shape,
  serializeClip,
} from '../src';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 'a0',
  style: DEFAULT_STYLE.sticky,
  text: id,
  createdBy: 'u9',
  authorName: 'Old Author',
  createdAt: 5,
  ...extra,
});
const frame = shape('f1', {
  type: 'frame',
  w: 600,
  h: 400,
  z: 'a1',
  style: DEFAULT_STYLE.frame,
  columns: [{ id: 'c1', title: 'A' }],
});
const link = (id: string, from: string, to: string | { x: number; y: number }): Connector => ({
  id,
  from: { shapeId: from, anchor: 'auto' },
  to: typeof to === 'string' ? { shapeId: to, anchor: 'auto' } : to,
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u9',
});
const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.id, i]));

function pasteCtx(pageShapes: Shape[] = []): PasteContext {
  let n = 0;
  return {
    shapes: byId(pageShapes),
    newId: () => `n${++n}`,
    userId: 'u1',
    userName: 'Brisk Otter',
    now: () => 1000,
  };
}

describe('copyPayload', () => {
  it('copies a frame with its children and the connectors among copied shapes, in z order', () => {
    const child = shape('s1', { z: 'a2', parentId: 'f1', columnId: 'c1', pageId: 'p2' });
    const outside = shape('s2', { z: 'a3' });
    const p = copyPayload(
      ['f1'],
      byId([frame, child, outside]),
      byId([link('k1', 's1', 'f1'), link('k2', 's1', 's2')]),
    );
    expect(p?.shapes.map((s) => s.id)).toEqual(['f1', 's1']);
    expect(p?.shapes[1]).not.toHaveProperty('z');
    expect(p?.shapes[1]).not.toHaveProperty('pageId');
    expect(p?.connectors.map((c) => c.id)).toEqual(['k1']);
  });

  it('copies a selected connector with a free end, but not one attached outside the copy', () => {
    const p = copyPayload(
      ['s1', 'k1', 'k2'],
      byId([shape('s1'), shape('s2')]),
      byId([link('k1', 's1', { x: 5, y: 5 }), link('k2', 's1', 's2')]),
    );
    expect(p?.connectors.map((c) => c.id)).toEqual(['k1']);
  });

  it('returns null when nothing is copyable', () => {
    expect(copyPayload([], {}, {})).toBeNull();
    expect(copyPayload(['ghost'], {}, {})).toBeNull();
  });
});

describe('clip text', () => {
  const payload: ClipPayload = {
    shapes: [{ ...shape('s1') }].map(({ z: _z, ...rest }) => rest),
    connectors: [],
  };

  it('round-trips through serializeClip and parseClip', () => {
    const text = serializeClip(payload);
    expect(text.startsWith(CLIP_PREFIX)).toBe(true);
    expect(parseClip(text)).toEqual(payload);
  });

  it('rejects text that is not a Relay clip', () => {
    expect(parseClip('hello')).toBeNull();
    expect(parseClip(`${CLIP_PREFIX}{not json`)).toBeNull();
    expect(parseClip(`${CLIP_PREFIX}[]`)).toBeNull();
    expect(parseClip(`${CLIP_PREFIX}{"shapes":[{"id":"x","type":"blob"}]}`)).toBeNull();
  });

  it('drops invalid and duplicate items, caps shapes, drops connectors to missing shapes', () => {
    const many = Array.from({ length: MAX_PASTE_SHAPES + 5 }, (_, i) => ({
      ...shape(`s${i}`),
    }));
    const text = `${CLIP_PREFIX}${JSON.stringify({
      shapes: [many[0], many[0], { id: 5 }, ...many.slice(1)],
      connectors: [link('k1', 's0', 's1'), link('k2', 's0', 'missing'), { id: 'bad' }],
    })}`;
    const p = parseClip(text);
    expect(p?.shapes.length).toBeLessThanOrEqual(MAX_PASTE_SHAPES);
    expect(new Set(p?.shapes.map((s) => s.id)).size).toBe(p?.shapes.length);
    expect(p?.connectors.map((c) => c.id)).toEqual(['k1']);
  });
});

describe('parseShape', () => {
  it('reads text from plain JSON only for text-bearing types', () => {
    expect(parseShape({ ...shape('s1'), text: 'hey' })?.text).toBe('hey');
    expect(parseShape({ ...shape('l1', { type: 'line' }), text: 'no' })?.text).toBeUndefined();
  });

  it('rejects non-objects and missing ids', () => {
    expect(parseShape([])).toBeNull();
    expect(parseShape({ type: 'sticky' })).toBeNull();
  });

  it('a stored Y.Map still ignores a plain string text', () => {
    const doc = new Y.Doc();
    const m = doc.getMap<unknown>('probe');
    m.set('type', 'sticky');
    m.set('text', 'plain');
    expect(readShape('x', m)?.text).toBeUndefined();
  });
});

describe('pastePlan', () => {
  // z order: frame a1, child a2, orphan a3.
  const child = shape('s1', { x: 20, y: 60, z: 'a2', parentId: 'f1', columnId: 'c1' });
  const orphan = shape('s2', { x: 700, y: 0, z: 'a3', parentId: 'gone', columnId: 'c9' });
  const payload = copyPayload(
    ['f1', 's2', 'k1'],
    byId([frame, child, orphan]),
    byId([link('k1', 's1', { x: 10, y: 10 })]),
  ) as ClipPayload;

  it('assigns new ids, remaps parents and ends, offsets and takes the paster as creator', () => {
    const plan = pastePlan(payload, pasteCtx(), { offset: 24 });
    const [f, c, o] = plan.shapes;
    expect(plan.shapes.map((s) => s.id)).toEqual(['n1', 'n2', 'n3']);
    expect(f).toMatchObject({ x: 24, y: 24, columns: [{ id: 'c1', title: 'A' }] });
    expect(c).toMatchObject({ x: 44, y: 84, parentId: 'n1', columnId: 'c1' });
    expect(o?.parentId).toBeUndefined();
    expect(o?.columnId).toBeUndefined();
    expect(c).toMatchObject({ createdBy: 'u1', authorName: 'Brisk Otter', createdAt: 1000 });
    expect(plan.connectors).toEqual([
      {
        id: 'n4',
        from: { shapeId: 'n2', anchor: 'auto' },
        to: { x: 34, y: 34 },
        routing: 'straight',
        head: 'arrow',
        createdBy: 'u1',
      },
    ]);
  });

  it('centres the pasted bounds on a point', () => {
    const one = copyPayload(['s1'], byId([shape('s1')]), {}) as ClipPayload;
    const plan = pastePlan(one, pasteCtx(), { at: { x: 500, y: 500 } });
    expect(plan.shapes[0]).toMatchObject({ x: 450, y: 450 });
  });

  it('drops a pasted top-level shape into the page frame under its centre', () => {
    const one = copyPayload(['s1'], byId([shape('s1')]), {}) as ClipPayload;
    const plan = pastePlan(one, pasteCtx([frame]), { at: { x: 100, y: 100 } });
    expect(plan.shapes[0]).toMatchObject({ parentId: 'f1', columnId: 'c1' });
  });
});

describe('plainTextSticky', () => {
  it('centres a sticky on the point and caps the text', () => {
    const s = plainTextSticky('x'.repeat(5000), { x: 300, y: 300 }, pasteCtx());
    expect(s).toMatchObject({ type: 'sticky', x: 210, y: 230, w: 180, h: 140 });
    expect(s.text?.length).toBe(2000);
  });

  it('never ends the capped text on a lone high surrogate', () => {
    const split = plainTextSticky(`${'x'.repeat(1999)}\u{1F600}tail`, { x: 0, y: 0 }, pasteCtx());
    expect(split.text).toBe('x'.repeat(1999));
    const whole = plainTextSticky(`${'x'.repeat(1998)}\u{1F600}tail`, { x: 0, y: 0 }, pasteCtx());
    expect(whole.text).toBe(`${'x'.repeat(1998)}\u{1F600}`);
  });
});

describe('pasteUpdateSize', () => {
  const stickies = (n: number, text: string): NewShape[] =>
    Array.from({ length: n }, (_, i) => {
      const { z: _z, ...rest } = shape(`s${i}`, { x: i * 10, text });
      return rest;
    });

  it('keeps a small paste under the byte budget', () => {
    const size = pasteUpdateSize({ shapes: stickies(3, 'hi'), connectors: [] });
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(MAX_PASTE_BYTES);
  });

  it('puts 500 stickies with 400-char texts over the byte budget', () => {
    const size = pasteUpdateSize({ shapes: stickies(500, 'y'.repeat(400)), connectors: [] });
    expect(size).toBeGreaterThan(MAX_PASTE_BYTES);
  });
});
