import { describe, expect, it } from 'vitest';
import { clampBox, threadPlacement } from '../src/render/popover';

describe('clampBox', () => {
  const board = { w: 375, h: 600 };

  it('keeps a box where it wants to be when it fits', () => {
    expect(clampBox({ x: 40, y: 50 }, { w: 256, h: 80 }, board)).toEqual({ x: 40, y: 50 });
  });

  it('pulls a box back inside the board, 8px from each edge', () => {
    expect(clampBox({ x: 367, y: 580 }, { w: 256, h: 80 }, board)).toEqual({ x: 111, y: 512 });
    expect(clampBox({ x: -20, y: -5 }, { w: 256, h: 80 }, board)).toEqual({ x: 8, y: 8 });
  });
});

describe('threadPlacement', () => {
  it('opens below a pin with more room below, with the room left there', () => {
    expect(threadPlacement(100, 28, 600)).toEqual({ above: false, room: 600 - 132 - 8 });
  });

  it('opens above a pin with more room above', () => {
    expect(threadPlacement(400, 28, 600)).toEqual({ above: true, room: 400 - 4 - 8 });
  });

  it('picks the roomier side for a pin near the middle of a short board', () => {
    // A landscape phone: 276px of board, the pin just above the middle.
    expect(threadPlacement(138, 28, 276)).toEqual({ above: true, room: 126 });
  });
});
