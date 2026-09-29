import { describe, expect, it } from 'vitest';
import { dropDate } from '../src/calendar/useEventDrag';

describe('dropDate', () => {
  it('moves the first day by the days between grab and drop', () => {
    // A 3-day bar (14–16) grabbed on the 15th, dropped on the 16th: starts on the 15th.
    expect(dropDate('2026-09-14', '2026-09-15', '2026-09-16')).toBe('2026-09-15');
    // Grabbed on its last day, dropped two days earlier.
    expect(dropDate('2026-09-14', '2026-09-16', '2026-09-14')).toBe('2026-09-12');
    // Across a month and a year boundary.
    expect(dropDate('2026-12-30', '2026-12-30', '2027-01-02')).toBe('2027-01-02');
  });

  it('is null when nothing moves or a day is unknown', () => {
    expect(dropDate('2026-09-14', '2026-09-15', '2026-09-15')).toBeNull();
    expect(dropDate('2026-09-14', null, '2026-09-15')).toBeNull();
    expect(dropDate('2026-09-14', '2026-09-15', null)).toBeNull();
    expect(dropDate('nope', '2026-09-15', '2026-09-16')).toBeNull();
  });
});
