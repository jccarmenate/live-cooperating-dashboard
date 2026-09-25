import { describe, expect, it } from 'vitest';
import { keyFromHash } from '../src/sync/key';

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
