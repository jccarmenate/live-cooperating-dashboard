import { describe, expect, it } from 'vitest';
import { newWheel, wheelWeeks } from '../src/calendar/useCalendarWheel';

describe('wheelWeeks', () => {
  it('turns one mouse notch into one week', () => {
    const w = newWheel();
    expect(wheelWeeks(w, 100, 0)).toBe(1);
    expect(wheelWeeks(w, -100, 50)).toBe(-1);
  });

  it('adds up small trackpad deltas, and caps a burst at three weeks', () => {
    const w = newWheel();
    expect([40, 40, 40].map((d, i) => wheelWeeks(w, d, i * 10))).toEqual([0, 0, 1]);
    expect(wheelWeeks(w, 1000, 40)).toBe(3);
  });

  it('forgets a partial step after a pause or a change of direction', () => {
    const w = newWheel();
    expect(wheelWeeks(w, 90, 0)).toBe(0);
    expect(wheelWeeks(w, 20, 1000)).toBe(0);
    expect(wheelWeeks(w, 90, 1010)).toBe(1);
    expect(wheelWeeks(w, 60, 1020)).toBe(0);
    expect(wheelWeeks(w, -60, 1030)).toBe(0);
  });
});
