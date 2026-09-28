import { describe, expect, it } from 'vitest';
import { cellAddress, colIndex, colLetters, lex, parseFormula } from '../src';

describe('addresses', () => {
  it('converts column indexes and letters', () => {
    expect([0, 25, 26, 51, 52, 59].map(colLetters)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'BH']);
    expect(['A', 'z', 'AA', 'bh'].map(colIndex)).toEqual([0, 25, 26, 59]);
    expect(colIndex('')).toBe(-1);
    expect(colIndex('A1')).toBe(-1);
    expect(cellAddress(2, 1)).toBe('B3');
  });
});

describe('lex', () => {
  const kinds = (s: string) => lex(s)?.map((t) => t.k);

  it('tokenizes literals, references, names and operators with positions', () => {
    expect(kinds('SUM(A1:$B$2) & "x""y" <= 1.5e2%')).toEqual([
      'name',
      '(',
      'a1',
      ':',
      'a1',
      ')',
      'op',
      'str',
      'op',
      'num',
      'op',
    ]);
    const t = lex('$b$12');
    expect(t).toEqual([
      { k: 'a1', ref: { row: 11, col: 1, absRow: true, absCol: true }, s: 0, e: 5 },
    ]);
    expect(lex('"a""b"')?.[0]).toMatchObject({ k: 'str', v: 'a"b' });
  });

  it('reads stored references, #REF! and booleans', () => {
    expect(lex('[$ab12cd34.ef56gh78]')?.[0]).toMatchObject({
      k: 'id',
      ref: { row: 'ab12cd34', col: 'ef56gh78', absRow: true, absCol: false },
    });
    expect(kinds('#REF!+true')).toEqual(['refErr', 'op', 'bool']);
  });

  it('keeps names that look like references when followed by "(" or more letters', () => {
    expect(kinds('LOG10(1)')).toEqual(['name', '(', 'num', ')']);
    expect(kinds('A1B')).toEqual(['name']);
  });

  it('rejects invalid characters and unterminated strings', () => {
    expect(lex('1 ? 2')).toBeNull();
    expect(lex('"open')).toBeNull();
  });
});

describe('parseFormula', () => {
  const ref = (row: string, col: string) => ({ row, col, absRow: false, absCol: false });

  it('respects precedence and associativity', () => {
    expect(parseFormula('1+2*3')).toEqual({
      k: 'bin',
      op: '+',
      l: { k: 'num', v: 1 },
      r: { k: 'bin', op: '*', l: { k: 'num', v: 2 }, r: { k: 'num', v: 3 } },
    });
    expect(parseFormula('2^3^2')).toEqual({
      k: 'bin',
      op: '^',
      l: { k: 'num', v: 2 },
      r: { k: 'bin', op: '^', l: { k: 'num', v: 3 }, r: { k: 'num', v: 2 } },
    });
    expect(parseFormula('-2^2')).toEqual({
      k: 'bin',
      op: '^',
      l: { k: 'neg', arg: { k: 'num', v: 2 } },
      r: { k: 'num', v: 2 },
    });
    expect(parseFormula('1&2=3')).toEqual({
      k: 'bin',
      op: '=',
      l: { k: 'bin', op: '&', l: { k: 'num', v: 1 }, r: { k: 'num', v: 2 } },
      r: { k: 'num', v: 3 },
    });
    expect(parseFormula('50%*2')).toEqual({
      k: 'bin',
      op: '*',
      l: { k: 'pct', arg: { k: 'num', v: 50 } },
      r: { k: 'num', v: 2 },
    });
  });

  it('parses calls, references and ranges', () => {
    expect(parseFormula('sum([r1.c1]:[r2.c2], 3)')).toEqual({
      k: 'call',
      name: 'SUM',
      args: [
        { k: 'range', from: ref('r1', 'c1'), to: ref('r2', 'c2') },
        { k: 'num', v: 3 },
      ],
    });
    expect(parseFormula('IF()')).toEqual({ k: 'call', name: 'IF', args: [] });
    expect(parseFormula('[r1.c1]')).toEqual({ k: 'ref', ref: ref('r1', 'c1') });
  });

  it('turns #REF!, A1 leftovers and bare names into error nodes', () => {
    expect(parseFormula('#REF!+1')).toEqual({
      k: 'bin',
      op: '+',
      l: { k: 'err', v: '#REF!' },
      r: { k: 'num', v: 1 },
    });
    expect(parseFormula('[r1.c1]:#REF!')).toEqual({ k: 'err', v: '#REF!' });
    expect(parseFormula('A1')).toEqual({ k: 'err', v: '#REF!' });
    expect(parseFormula('FOO')).toEqual({ k: 'err', v: '#NAME?' });
  });

  it('returns null on syntax errors', () => {
    for (const bad of ['', '1+', '(1', '1)', 'SUM(1,', '1 2', '*3', '[r1.c1]:', '"x']) {
      expect(parseFormula(bad)).toBeNull();
    }
  });
});
