import { describe, expect, it } from 'vitest';
import { nextClock } from '../src/sync/clock';

describe('clock', () => {
  it('hello sets the role and the offset', () => {
    expect(
      nextClock(
        { role: null, offset: 0, viewKey: null },
        { type: 'hello', role: 'edit', now: 10_500 },
        10_000,
      ),
    ).toEqual({
      role: 'edit',
      offset: 500,
      viewKey: null,
    });
  });

  it('time refreshes the offset and keeps the role', () => {
    expect(
      nextClock(
        { role: 'view', offset: 500, viewKey: null },
        { type: 'time', now: 20_000 },
        20_100,
      ),
    ).toEqual({
      role: 'view',
      offset: -100,
      viewKey: null,
    });
  });

  it('keeps the view key from hello and across time refreshes', () => {
    const a = nextClock(
      { role: null, offset: 0, viewKey: null },
      { type: 'hello', role: 'edit', now: 5, viewKey: 'vk' },
      5,
    );
    expect(a.viewKey).toBe('vk');
    expect(nextClock(a, { type: 'time', now: 9 }, 9).viewKey).toBe('vk');
  });
});
