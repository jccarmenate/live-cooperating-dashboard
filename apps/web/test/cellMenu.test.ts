import { describe, expect, it } from 'vitest';
import { cellMenu, insideRange } from '../src/sheet/cellMenu';

const actions = { cut() {}, copy() {}, paste() {}, clear() {} };

describe('cellMenu', () => {
  it('gives editors cut, copy, paste and clear', () => {
    expect(cellMenu(true, actions).map((i) => i.label)).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Clear contents',
    ]);
  });

  it('gives viewers only copy', () => {
    expect(cellMenu(false, actions).map((i) => i.label)).toEqual(['Copy']);
  });
});

describe('insideRange', () => {
  const range = { r0: 1, r1: 3, c0: 0, c1: 2 };

  it('tells whether a cell lies in the selection', () => {
    expect(insideRange(range, { r0: 2, r1: 2, c0: 1, c1: 1 })).toBe(true);
    expect(insideRange(range, { r0: 3, r1: 3, c0: 2, c1: 2 })).toBe(true);
    expect(insideRange(range, { r0: 4, r1: 4, c0: 1, c1: 1 })).toBe(false);
    expect(insideRange(range, { r0: 2, r1: 2, c0: 3, c1: 3 })).toBe(false);
  });

  it('is false without a selection or a cell', () => {
    expect(insideRange(null, { r0: 0, r1: 0, c0: 0, c1: 0 })).toBe(false);
    expect(insideRange(range, null)).toBe(false);
  });
});
