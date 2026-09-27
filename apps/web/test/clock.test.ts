import { describe, expect, it } from 'vitest';
import { nextClock } from '../src/sync/clock';

describe('clock', () => {
  it('hello sets the role and the offset', () => {
    expect(
      nextClock({ role: null, offset: 0 }, { type: 'hello', role: 'edit', now: 10_500 }, 10_000),
    ).toEqual({
      role: 'edit',
      offset: 500,
    });
  });

  it('time refreshes the offset and keeps the role', () => {
    expect(nextClock({ role: 'view', offset: 500 }, { type: 'time', now: 20_000 }, 20_100)).toEqual(
      {
        role: 'view',
        offset: -100,
      },
    );
  });
});
