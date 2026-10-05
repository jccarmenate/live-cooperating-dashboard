import { describe, expect, it } from 'vitest';
import { closeAction, THROTTLE_WAIT_MS } from '../src/sync/closes';

describe('closeAction', () => {
  it('stops for a bad key, a full room and a message too large to sync', () => {
    expect(closeAction(4401, [], 0).action).toEqual({ kind: 'stop', status: 'unauthorized' });
    expect(closeAction(4503, [], 0).action).toEqual({ kind: 'stop', status: 'crowded' });
    expect(closeAction(1009, [], 0).action).toEqual({ kind: 'stop', status: 'too-large' });
  });

  it('lets the provider reconnect for any other close', () => {
    for (const code of [1000, 1006, 4400, 4409, undefined]) {
      expect(closeAction(code, [], 0).action).toEqual({ kind: 'reconnect' });
    }
  });

  it('waits after a rate-limit close and stops at the third within a minute', () => {
    const first = closeAction(4429, [], 1000);
    expect(first.action).toEqual({ kind: 'wait', ms: THROTTLE_WAIT_MS });
    const second = closeAction(4429, first.throttledAt, 20_000);
    expect(second.action).toEqual({ kind: 'wait', ms: THROTTLE_WAIT_MS });
    const third = closeAction(4429, second.throttledAt, 40_000);
    expect(third.action).toEqual({ kind: 'stop', status: 'throttled' });
  });

  it('forgets rate-limit closes older than a minute', () => {
    const first = closeAction(4429, [], 0);
    const second = closeAction(4429, first.throttledAt, 30_000);
    const later = closeAction(4429, second.throttledAt, 70_000);
    expect(later.action).toEqual({ kind: 'wait', ms: THROTTLE_WAIT_MS });
    expect(later.throttledAt).toEqual([30_000, 70_000]);
  });

  it('leaves the rate-limit history alone for other closes', () => {
    expect(closeAction(1006, [5], 10).throttledAt).toEqual([5]);
  });
});
