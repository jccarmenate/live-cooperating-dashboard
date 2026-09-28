import { describe, expect, it } from 'vitest';
import { shiftA1, shiftStored, toDisplay, toStored } from '../src';

const grid = { rows: ['r1', 'r2', 'r3'], cols: ['c1', 'c2'] };

describe('stored form', () => {
  it('leaves non-formulas and syntax errors alone', () => {
    expect(toStored('A1+1', grid)).toBe('A1+1');
    expect(toStored('="open', grid)).toBe('="open');
    expect(toDisplay('plain', grid)).toBe('plain');
  });

  it('translates A1 references to ids and back, keeping text and $ markers', () => {
    const stored = toStored('=sum(A1:$B$3) + a2*2', grid);
    expect(stored).toBe('=sum([r1.c1]:[$r3.$c2]) + [r2.c1]*2');
    expect(toDisplay(stored, grid)).toBe('=sum(A1:$B$3) + A2*2');
  });

  it('stores out-of-range references as #REF!', () => {
    expect(toStored('=C1+A9+A0', grid)).toBe('=#REF!+#REF!+#REF!');
  });

  it('shows the current position after a reorder and #REF! after a delete', () => {
    const stored = toStored('=A1+B2', grid);
    expect(toDisplay(stored, { rows: ['r0', 'r1', 'r2'], cols: ['c1', 'c2'] })).toBe('=A2+B3');
    expect(toDisplay(stored, { rows: ['r2', 'r3'], cols: ['c1', 'c2'] })).toBe('=#REF!+B1');
  });

  it('shifts relative parts only; shifting off the grid is #REF!', () => {
    const stored = '=[r1.c1]+[$r1.c1]+[r1.$c1]+[$r1.$c1]';
    expect(toDisplay(shiftStored(stored, 1, 1, grid), grid)).toBe('=B2+B$1+$A2+$A$1');
    expect(shiftStored('=[r1.c1]', -1, 0, grid)).toBe('=#REF!');
    expect(shiftStored('=[gone.c1]', 1, 0, grid)).toBe('=#REF!');
    expect(shiftStored('text', 1, 1, grid)).toBe('text');
  });

  it('shifts A1 formulas by relative parts only; off the grid is #REF!', () => {
    expect(shiftA1('=A1+$B$2+B$1+$A2', 1, 1)).toBe('=B2+$B$2+C$1+$A3');
    expect(shiftA1('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftA1('text', 1, 1)).toBe('text');
  });
});
