import { describe, expect, it } from 'vitest';
import {
  type CellValue,
  cellKey,
  evaluateSheet,
  literalValue,
  MAX_EVAL_DEPTH,
  type SheetSnapshot,
  toStored,
} from '../src';

const ROWS = ['r1', 'r2', 'r3', 'r4'];
const COLS = ['c1', 'c2', 'c3'];
const grid = { rows: ROWS, cols: COLS };

/** Builds a sheet from A1-addressed inputs, e.g. { A1: '4', B1: '=A1*2' }. */
function sheet(inputs: Record<string, string>): SheetSnapshot {
  const cells: SheetSnapshot['cells'] = {};
  for (const [addr, input] of Object.entries(inputs)) {
    const col = addr.charCodeAt(0) - 65;
    const row = Number(addr.slice(1)) - 1;
    cells[cellKey(ROWS[row] as string, COLS[col] as string)] = { src: toStored(input, grid) };
  }
  return {
    rows: ROWS.map((id, i) => ({ id, order: `a${i}` })),
    cols: COLS.map((id, i) => ({ id, order: `a${i}`, width: 120 })),
    cells,
  };
}
const valueAt = (inputs: Record<string, string>, addr: string): CellValue | undefined => {
  const col = addr.charCodeAt(0) - 65;
  const row = Number(addr.slice(1)) - 1;
  return evaluateSheet(sheet(inputs)).get(cellKey(ROWS[row] as string, COLS[col] as string));
};
const n = (v: number): CellValue => ({ t: 'num', v });
const e = (v: string): CellValue => ({ t: 'err', v }) as CellValue;

describe('literalValue', () => {
  it('reads numbers, booleans and text', () => {
    expect(literalValue('12')).toEqual(n(12));
    expect(literalValue(' -1.5e2 ')).toEqual(n(-150));
    expect(literalValue('true')).toEqual({ t: 'bool', v: true });
    expect(literalValue('12 apples')).toEqual({ t: 'str', v: '12 apples' });
    expect(literalValue('')).toEqual({ t: 'empty' });
  });
});

describe('evaluateSheet', () => {
  it('computes arithmetic with precedence, percent and references', () => {
    expect(valueAt({ A1: '4', B1: '=A1*2+1' }, 'B1')).toEqual(n(9));
    expect(valueAt({ A1: '=2^3^2' }, 'A1')).toEqual(n(512));
    expect(valueAt({ A1: '=-2^2' }, 'A1')).toEqual(n(4));
    expect(valueAt({ A1: '=50%*4' }, 'A1')).toEqual(n(2));
    expect(valueAt({ A1: '=B1+1' }, 'A1')).toEqual(n(1));
    expect(valueAt({ A1: '=B1' }, 'A1')).toEqual(n(0));
  });

  it('concatenates and compares', () => {
    expect(valueAt({ A1: 'a', B1: '=A1&1.5&TRUE' }, 'B1')).toEqual({ t: 'str', v: 'a1.5TRUE' });
    expect(valueAt({ A1: '="abc"="ABC"' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '=2<"a"' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '="a"<TRUE' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '=B1=0' }, 'A1')).toEqual({ t: 'bool', v: true });
    expect(valueAt({ A1: '=0.1+0.2&""' }, 'A1')).toEqual({ t: 'str', v: '0.3' });
    expect(valueAt({ A1: '12345678901', B1: '=A1&""' }, 'B1')).toEqual({
      t: 'str',
      v: '12345678901',
    });
  });

  it('aggregates ranges, skipping text, booleans and empties', () => {
    const inputs = { A1: '1', A2: '2', A3: 'x', A4: 'TRUE', B1: '5' };
    expect(valueAt({ ...inputs, C1: '=SUM(A1:B4)' }, 'C1')).toEqual(n(8));
    expect(valueAt({ ...inputs, C1: '=AVERAGE(A1:A4)' }, 'C1')).toEqual(n(1.5));
    expect(valueAt({ ...inputs, C1: '=MIN(A1:B4)' }, 'C1')).toEqual(n(1));
    expect(valueAt({ ...inputs, C1: '=MAX(A1:B4, 9)' }, 'C1')).toEqual(n(9));
    expect(valueAt({ ...inputs, C1: '=COUNT(A1:B4)' }, 'C1')).toEqual(n(3));
    expect(valueAt({ C1: '=AVERAGE(A1:A2)' }, 'C1')).toEqual(e('#DIV/0!'));
    expect(valueAt({ C1: '=MAX(A1:A2)' }, 'C1')).toEqual(n(0));
  });

  it('ROUND, ABS and IF', () => {
    expect(valueAt({ A1: '=ROUND(2.675, 2)' }, 'A1')).toEqual(n(2.68));
    expect(valueAt({ A1: '=ROUND(-1234.5, -2)' }, 'A1')).toEqual(n(-1200));
    expect(valueAt({ A1: '=ABS(-3)' }, 'A1')).toEqual(n(3));
    expect(valueAt({ A1: '=IF(1>2, "yes", "no")' }, 'A1')).toEqual({ t: 'str', v: 'no' });
    expect(valueAt({ A1: '=IF(0, 1)' }, 'A1')).toEqual({ t: 'bool', v: false });
    expect(valueAt({ A1: '=IF(TRUE, 1, 1/0)' }, 'A1')).toEqual(n(1));
    expect(valueAt({ A1: '=IF("x", 1, 2)' }, 'A1')).toEqual(e('#VALUE!'));
  });

  it('reports errors', () => {
    expect(valueAt({ A1: '=1/0' }, 'A1')).toEqual(e('#DIV/0!'));
    expect(valueAt({ A1: '=NOPE(1)' }, 'A1')).toEqual(e('#NAME?'));
    expect(valueAt({ A1: '="a"+1' }, 'A1')).toEqual(e('#VALUE!'));
    expect(valueAt({ A1: '=ABS(1, 2)' }, 'A1')).toEqual(e('#VALUE!'));
    expect(valueAt({ A1: '=10^400' }, 'A1')).toEqual(e('#NUM!'));
    expect(valueAt({ A1: '=1+' }, 'A1')).toEqual(e('#ERROR!'));
    expect(valueAt({ A1: '=Z9' }, 'A1')).toEqual(e('#REF!'));
    expect(valueAt({ A1: '=SUM(A2:A3)' }, 'A1')).toEqual(n(0));
    expect(valueAt({ A1: '=A2:A3' }, 'A1')).toEqual(e('#VALUE!'));
    expect(valueAt({ A1: '=1/0', B1: '=A1+1' }, 'B1')).toEqual(e('#DIV/0!'));
  });

  it('marks every cell of a cycle', () => {
    const inputs = { A1: '=B1', B1: '=C1', C1: '=A1', A2: '=A2+1' };
    expect(valueAt(inputs, 'A1')).toEqual(e('#CYCLE!'));
    expect(valueAt(inputs, 'B1')).toEqual(e('#CYCLE!'));
    expect(valueAt(inputs, 'C1')).toEqual(e('#CYCLE!'));
    expect(valueAt(inputs, 'A2')).toEqual(e('#CYCLE!'));
  });

  it('follows references across an inserted row', () => {
    const s = sheet({ A1: '3', B2: '=SUM(A1:A2)' });
    s.rows.splice(1, 0, { id: 'rX', order: 'a05' });
    s.cells[cellKey('rX', 'c1')] = { src: '4' };
    expect(evaluateSheet(s).get(cellKey('r2', 'c2'))).toEqual(n(7));
  });

  describe('deep reference chains', () => {
    const PLUS = (prev: string) => `=${prev}+1`;
    const NESTED = (prev: string) => `=IF(TRUE, ABS(ROUND(SUM(${prev}:${prev})+1, 0)), 0)`;
    const x = (i: number) => cellKey(`x${i}`, 'c1');

    /**
     * A single-column chain of `length` rows x0..x(length-1). Upward: x0 = 1, x(i) refers to x(i-1).
     * Downward: the last row is 1, x(i) refers to x(i+1). `reversed` inserts the cells far end first.
     */
    const chain = (
      length: number,
      dir: 'up' | 'down',
      formula: (prev: string) => string,
      reversed = false,
    ): SheetSnapshot => {
      const start = dir === 'up' ? 0 : length - 1;
      const entries: [string, { src: string }][] = [];
      for (let i = 0; i < length; i++) {
        const prev = dir === 'up' ? i - 1 : i + 1;
        entries.push([x(i), { src: i === start ? '1' : formula(`[x${prev}.c1]`) }]);
      }
      if (reversed) entries.reverse();
      return {
        rows: Array.from({ length }, (_, i) => ({ id: `x${i}`, order: `a${i}` })),
        cols: [{ id: 'c1', order: 'a0', width: 120 }],
        cells: Object.fromEntries(entries),
      };
    };
    const sorted = (m: Map<string, CellValue>) => [...m].sort(([a], [b]) => (a < b ? -1 : 1));

    it('evaluates in row-major order, whatever the insertion order', () => {
      expect(MAX_EVAL_DEPTH).toBe(1000);
      const values = evaluateSheet(chain(1500, 'up', PLUS, true));
      expect(values.get(x(1499))).toEqual(n(1500));
    });

    it('caps a downward chain past MAX_EVAL_DEPTH with #NUM!, deterministically', () => {
      let values: Map<string, CellValue> | undefined;
      expect(() => {
        values = evaluateSheet(chain(1500, 'down', PLUS));
      }).not.toThrow();
      expect(values?.get(x(0))).toEqual(e('#NUM!'));
      expect(values?.get(x(1499))).toEqual(n(1));
      const reversed = evaluateSheet(chain(1500, 'down', PLUS, true));
      expect(sorted(reversed)).toEqual(sorted(values as Map<string, CellValue>));
    });

    it('computes a 500-row upward chain of nested formulas', () => {
      expect(evaluateSheet(chain(500, 'up', NESTED, true)).get(x(499))).toEqual(n(500));
    });

    it('survives a stack overflow from a deep nested downward chain', () => {
      let values: Map<string, CellValue> | undefined;
      const t0 = Date.now();
      expect(() => {
        values = evaluateSheet(chain(1200, 'down', NESTED));
      }).not.toThrow();
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(values?.get(x(0))?.t).toBe('err');
    });
  });
});
