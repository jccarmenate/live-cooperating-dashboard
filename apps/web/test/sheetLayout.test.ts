import { describe, expect, it } from 'vitest';
import {
  addressOf,
  colOffsets,
  HEADER_H,
  indexAt,
  OVERSCAN,
  ROW_H,
  ROW_HEADER_W,
  rangeBox,
  visibleRows,
} from '../src/sheet/layout';

describe('sheet layout', () => {
  it('computes column offsets and hit-tests them', () => {
    const offsets = colOffsets([{ width: 100 }, { width: 50 }, { width: 120 }]);
    expect(offsets).toEqual([0, 100, 150, 270]);
    expect(indexAt(offsets, ROW_HEADER_W + 99)).toBe(0);
    expect(indexAt(offsets, ROW_HEADER_W + 100)).toBe(1);
    expect(indexAt(offsets, ROW_HEADER_W + 400)).toBe(-1);
    expect(indexAt(offsets, 10)).toBe(-1);
  });

  it('renders only visible rows plus overscan', () => {
    expect(visibleRows(0, 280, 500)).toEqual({ start: 0, end: 10 + OVERSCAN });
    expect(visibleRows(ROW_H * 100, 280, 500)).toEqual({
      start: 100 - OVERSCAN,
      end: 110 + OVERSCAN,
    });
    expect(visibleRows(ROW_H * 495, 280, 500)).toEqual({ start: 495 - OVERSCAN, end: 500 });
  });

  it('boxes a range in content coordinates', () => {
    const offsets = colOffsets([{ width: 100 }, { width: 50 }]);
    expect(rangeBox({ r0: 1, r1: 2, c0: 1, c1: 1 }, offsets)).toEqual({
      left: ROW_HEADER_W + 100,
      top: HEADER_H + ROW_H,
      width: 50,
      height: ROW_H * 2,
    });
  });

  it('addresses cells in the current order', () => {
    const sheet = {
      rows: [
        { id: 'r1', order: 'a0' },
        { id: 'r2', order: 'a1' },
      ],
      cols: [
        { id: 'c1', order: 'a0', width: 120 },
        { id: 'c2', order: 'a1', width: 120 },
      ],
      cells: {},
    };
    expect(addressOf(sheet, { row: 'r2', col: 'c2' })).toBe('B2');
    expect(addressOf(sheet, { row: 'x', col: 'c2' })).toBe('');
  });
});
