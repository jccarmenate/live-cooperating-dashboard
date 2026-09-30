import { describe, expect, it } from 'vitest';
import { rsvpSummary } from '../src/calendar/rsvp';

describe('rsvpSummary', () => {
  it('groups answers by status with sorted names', () => {
    expect(
      rsvpSummary({
        u1: { status: 'yes', name: 'Zoe' },
        u2: { status: 'yes', name: 'Ana' },
        u3: { status: 'maybe', name: '' },
        u4: { status: 'no', name: 'Bo' },
      }),
    ).toEqual({ yes: ['Ana', 'Zoe'], maybe: ['Someone'], no: ['Bo'] });
    expect(rsvpSummary({})).toEqual({ yes: [], maybe: [], no: [] });
  });
});
