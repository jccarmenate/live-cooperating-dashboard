import { describe, expect, it } from 'vitest';
import { revealPan } from '../src/render/reveal';

const visible = { x: 0, y: 0, w: 375, h: 300 };

describe('revealPan', () => {
  it('leaves a box that is already in view where it is', () => {
    expect(revealPan({ x: 40, y: 40, w: 180, h: 140 }, visible)).toEqual({ dx: 0, dy: 0 });
  });

  it('pans up just enough to clear the bottom edge, with a margin', () => {
    // The box ends at 640; the room ends at 300 - 16.
    expect(revealPan({ x: 40, y: 500, w: 180, h: 140 }, visible)).toEqual({ dx: 0, dy: -356 });
  });

  it('pans a box back from beyond the left and top edges', () => {
    expect(revealPan({ x: -50, y: -20, w: 180, h: 140 }, visible)).toEqual({ dx: 66, dy: 36 });
  });

  it('shows the top-left of a box larger than the room', () => {
    expect(revealPan({ x: 100, y: 200, w: 600, h: 500 }, visible)).toEqual({ dx: -84, dy: -184 });
  });

  it('measures from where the visible area starts', () => {
    const lower = { x: 0, y: 120, w: 375, h: 300 };
    expect(revealPan({ x: 40, y: 60, w: 180, h: 140 }, lower)).toEqual({ dx: 0, dy: 76 });
  });
});
