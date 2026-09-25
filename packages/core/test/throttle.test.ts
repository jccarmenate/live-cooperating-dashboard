import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '../src';

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the first call immediately and coalesces the rest into one trailing call', () => {
    const calls: number[] = [];
    const t = throttle((n: number) => calls.push(n), 50);
    t(1);
    t(2);
    t(3);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(50);
    expect(calls).toEqual([1, 3]);
  });

  it('flush runs the pending call now', () => {
    const calls: number[] = [];
    const t = throttle((n: number) => calls.push(n), 50);
    t(1);
    t(2);
    t.flush();
    expect(calls).toEqual([1, 2]);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([1, 2]);
  });

  it('cancel drops the pending call', () => {
    const calls: number[] = [];
    const t = throttle((n: number) => calls.push(n), 50);
    t(1);
    t(2);
    t.cancel();
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([1]);
  });
});
