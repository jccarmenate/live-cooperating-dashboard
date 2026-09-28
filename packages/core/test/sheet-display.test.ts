import { describe, expect, it } from 'vitest';
import { defaultAlign, formatValue, parseTsv, toTsv } from '../src';

const n = (v: number) => ({ t: 'num' as const, v });

describe('formatValue', () => {
  it('formats by kind and number format (en-US)', () => {
    expect(formatValue({ t: 'empty' })).toBe('');
    expect(formatValue({ t: 'err', v: '#REF!' })).toBe('#REF!');
    expect(formatValue({ t: 'bool', v: true })).toBe('TRUE');
    expect(formatValue({ t: 'str', v: 'hi' })).toBe('hi');
    expect(formatValue(n(1 / 3), undefined, 'en-US')).toBe('0.3333333333');
    expect(formatValue(n(1234567), undefined, 'en-US')).toBe('1234567');
    expect(formatValue(n(1234.5), { num: 'number' }, 'en-US')).toBe('1,234.50');
    expect(formatValue(n(0.125), { num: 'percent' }, 'en-US')).toBe('12.5%');
    expect(formatValue(n(3), { num: 'eur' }, 'en-US')).toBe('€3.00');
    expect(formatValue(n(3), { num: 'usd' }, 'en-US')).toBe('$3.00');
  });

  it('aligns numbers right, booleans and errors centre, text left', () => {
    expect(defaultAlign(n(1))).toBe('right');
    expect(defaultAlign({ t: 'bool', v: false })).toBe('center');
    expect(defaultAlign({ t: 'err', v: '#NUM!' })).toBe('center');
    expect(defaultAlign({ t: 'str', v: 'x' })).toBe('left');
  });
});

describe('tsv', () => {
  it('round-trips fields with tabs, newlines and quotes', () => {
    const rows = [
      ['a', 'b\tc'],
      ['d"e', 'f\ng'],
      ['', 'h'],
    ];
    const text = toTsv(rows);
    expect(text).toBe('a\t"b\tc"\n"d""e"\t"f\ng"\n\th');
    expect(parseTsv(text)).toEqual(rows);
  });

  it('parses CRLF and a trailing newline as Excel writes them', () => {
    expect(parseTsv('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('solo')).toEqual([['solo']]);
  });
});
