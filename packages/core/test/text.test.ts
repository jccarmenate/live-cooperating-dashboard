import { describe, expect, it } from 'vitest';
import { diffText, transformCaret } from '../src';

describe('diffText', () => {
  it('returns null for equal strings', () => {
    expect(diffText('abc', 'abc')).toBeNull();
  });

  it('detects insertions, deletions and replacements', () => {
    expect(diffText('hello', 'hello!')).toEqual({ index: 5, deleteCount: 0, insert: '!' });
    expect(diffText('hello', 'hllo')).toEqual({ index: 1, deleteCount: 1, insert: '' });
    expect(diffText('cat', 'cut')).toEqual({ index: 1, deleteCount: 1, insert: 'u' });
    expect(diffText('', 'new')).toEqual({ index: 0, deleteCount: 0, insert: 'new' });
  });

  it('applying the diff reproduces the target', () => {
    const cases: [string, string][] = [
      ['aaa', 'aaaa'],
      ['abcabc', 'abc'],
      ['x', ''],
      ['sprint retro', 'sprint 14 retro'],
    ];
    for (const [a, b] of cases) {
      const d = diffText(a, b);
      if (!d) throw new Error('expected a diff');
      expect(a.slice(0, d.index) + d.insert + a.slice(d.index + d.deleteCount)).toBe(b);
    }
  });
});

describe('transformCaret', () => {
  const d = { index: 5, deleteCount: 2, insert: 'XYZ' };
  it('keeps carets before the edit', () => {
    expect(transformCaret(3, d)).toBe(3);
    expect(transformCaret(5, d)).toBe(5);
  });
  it('shifts carets after the edit', () => {
    expect(transformCaret(10, d)).toBe(11);
  });
  it('moves carets inside a deleted range to the end of the insertion', () => {
    expect(transformCaret(6, d)).toBe(8);
  });
});
