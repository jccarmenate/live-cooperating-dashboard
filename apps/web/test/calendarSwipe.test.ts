import { describe, expect, it } from 'vitest';
import { swipeWeeks } from '../src/calendar/useCalendarSwipe';

describe('swipeWeeks', () => {
  it('rolls a week per row height the finger travels, up for later weeks', () => {
    expect(swipeWeeks(500, 460, 80)).toBe(0);
    expect(swipeWeeks(500, 420, 80)).toBe(1);
    expect(swipeWeeks(500, 330, 80)).toBe(2);
    expect(swipeWeeks(500, 590, 80)).toBe(-1);
  });

  it('never divides by a zero-height grid', () => {
    expect(swipeWeeks(500, 100, 0)).toBe(0);
  });
});
