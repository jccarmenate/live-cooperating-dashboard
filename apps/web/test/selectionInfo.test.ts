import { type Connector, DEFAULT_STYLE, type Shape } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { barPosition, selectionInfo } from '../src/ui/selectionInfo';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 'a0',
  style: DEFAULT_STYLE.sticky,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
  ...extra,
});
const connector: Connector = {
  id: 'k1',
  from: { x: 300, y: 300 },
  to: { x: 400, y: 350 },
  routing: 'straight',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

describe('selectionInfo', () => {
  it('reports common style values and mixed ones as null', () => {
    const shapes = {
      a: shape('a'),
      b: shape('b', { x: 200, style: { ...DEFAULT_STYLE.sticky, fill: '#fff', size: 'l' } }),
    };
    const info = selectionInfo(['a', 'b'], shapes, {});
    expect(info.fill).toBeNull();
    expect(info.stroke).toBe(DEFAULT_STYLE.sticky.stroke);
    expect(info.size).toBeNull();
    expect(info.textual).toBe(true);
    expect(info.bounds).toEqual({ x: 0, y: 0, w: 300, h: 100 });
  });

  it('style values come from the unlocked shapes; allLocked only when every shape is locked', () => {
    const shapes = {
      a: shape('a', { locked: true, style: { ...DEFAULT_STYLE.sticky, fill: '#000' } }),
      b: shape('b'),
    };
    const mixed = selectionInfo(['a', 'b'], shapes, {});
    expect(mixed.allLocked).toBe(false);
    expect(mixed.fill).toBe(DEFAULT_STYLE.sticky.fill);
    expect(selectionInfo(['a'], shapes, {}).allLocked).toBe(true);
  });

  it('includes connectors: routing, head and path bounds', () => {
    const info = selectionInfo(['k1'], {}, { k1: connector });
    expect(info.routing).toBe('straight');
    expect(info.head).toBe('arrow');
    expect(info.bounds).toEqual({ x: 300, y: 300, w: 100, h: 50 });
  });

  it('is empty for an empty selection', () => {
    expect(selectionInfo([], {}, {}).bounds).toBeNull();
  });
});

describe('barPosition', () => {
  const viewport = { w: 1000, h: 800 };
  const bar = { w: 300, h: 40 };

  it('sits centred above the target', () => {
    expect(barPosition({ x: 400, y: 300, w: 200, h: 100 }, bar, viewport)).toEqual({
      left: 350,
      top: 248,
    });
  });

  it('goes below when there is no room above, and stays inside the viewport', () => {
    expect(barPosition({ x: -100, y: 10, w: 50, h: 50 }, bar, viewport)).toEqual({
      left: 8,
      top: 96,
    });
    expect(barPosition({ x: 950, y: 790, w: 100, h: 100 }, bar, viewport).left).toBe(692);
  });

  it('keeps clear of the toolbar on the left', () => {
    expect(barPosition({ x: 0, y: 300, w: 100, h: 100 }, bar, viewport, 70).left).toBe(78);
    // Still inside the viewport on the right when the target is far right.
    expect(barPosition({ x: 950, y: 300, w: 100, h: 100 }, bar, viewport, 70).left).toBe(692);
  });
});
