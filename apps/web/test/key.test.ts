import { describe, expect, it } from 'vitest';
import { hashFor, keyFromHash, pageFromHash } from '../src/sync/key';

describe('keyFromHash', () => {
  it('extracts k from the fragment', () => {
    expect(keyFromHash('#k=abc_-1')).toBe('abc_-1');
    expect(keyFromHash('#x=1&k=a%2Bb')).toBe('a+b');
  });
  it('returns null when absent', () => {
    expect(keyFromHash('')).toBeNull();
    expect(keyFromHash('#kk=1')).toBeNull();
  });
});

describe('page in the hash', () => {
  it('reads and writes the page next to the key', () => {
    expect(pageFromHash('#k=abc&p=p2')).toBe('p2');
    expect(pageFromHash('#k=abc')).toBeNull();
    expect(hashFor('abc', 'p2')).toBe('#k=abc&p=p2');
    expect(hashFor(null, 'main')).toBe('#p=main');
    expect(pageFromHash(hashFor('a b', 'x y'))).toBe('x y');
  });

  it('reads a malformed escape as absent instead of throwing', () => {
    expect(pageFromHash('#p=%E0')).toBeNull();
    expect(keyFromHash('#k=%E0')).toBeNull();
    expect(pageFromHash('#k=%E0&p=p2')).toBe('p2');
    expect(keyFromHash('#k=abc&p=%E0')).toBe('abc');
  });
});
