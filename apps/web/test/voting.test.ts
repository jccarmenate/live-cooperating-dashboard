import { describe, expect, it } from 'vitest';
import { MAX_TIMER_MS, voteTimerDelay } from '../src/render/voting';

describe('voteTimerDelay', () => {
  const now = 1_000_000;

  it('fires 50 ms after a near deadline', () => {
    expect(voteTimerDelay(now + 10_000, now)).toBe(10_050);
  });

  it('fires almost at once for a deadline already past', () => {
    expect(voteTimerDelay(now - 5_000, now)).toBe(50);
  });

  it('caps a far deadline so the browser never wraps the delay', () => {
    expect(voteTimerDelay(now + 30 * 24 * 60 * 60_000, now)).toBe(MAX_TIMER_MS);
    expect(voteTimerDelay(Number.MAX_SAFE_INTEGER, now)).toBe(60_000);
  });
});
