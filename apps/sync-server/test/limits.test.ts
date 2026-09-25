import { describe, expect, it } from 'vitest';
import { messageBytes, TokenBucket } from '../src/limits';

describe('TokenBucket', () => {
  it('allows a burst then refills at the given rate', () => {
    const b = new TokenBucket(10, 3, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(100)).toBe(true); // 0.1 s * 10/s = 1 token
    expect(b.take(100)).toBe(false);
  });

  it('never exceeds the burst size', () => {
    const b = new TokenBucket(10, 2, 0);
    b.take(0);
    b.take(0);
    const results = [b.take(60_000), b.take(60_000), b.take(60_000)];
    expect(results).toEqual([true, true, false]);
  });
});

describe('messageBytes', () => {
  it('measures strings, buffers and views', () => {
    expect(messageBytes('abc')).toBe(3);
    expect(messageBytes(new ArrayBuffer(8))).toBe(8);
    expect(messageBytes(new Uint8Array(5))).toBe(5);
  });

  it('measures multi-byte strings as UTF-8 wire bytes, not UTF-16 code units', () => {
    expect(messageBytes('é')).toBe(2);
    expect(messageBytes('€')).toBe(3);
  });
});
