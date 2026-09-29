import { type Occurrence, toInstant } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { monthGrid, monthLayout, viewWindow, weekDates, weekLayout } from '../src/calendar/layout';

const Z = 'Europe/Madrid';
let n = 0;
function occ(when: Occurrence['when'], start: number, end: number): Occurrence {
  n++;
  return {
    eventId: `e${n}`,
    key: `k${n}`,
    when,
    start,
    end,
    title: `T${n}`,
    notes: '',
    color: '#3B3BF5',
    recurring: false,
    changed: false,
  };
}
const allDay = (s: string, e: string) => {
  const [sy, sm, sd] = s.split('-').map(Number) as [number, number, number];
  const [ey, em, ed] = e.split('-').map(Number) as [number, number, number];
  return occ(
    { allDay: true, start: s, end: e },
    toInstant({ y: sy, m: sm, d: sd, hh: 0, mm: 0 }, Z),
    toInstant({ y: ey, m: em, d: ed + 1, hh: 0, mm: 0 }, Z),
  );
};
const timed = (d: number, h1: number, m1: number, h2: number, m2: number, d2 = d) =>
  occ(
    { allDay: false, start: '', end: '', tz: Z },
    toInstant({ y: 2026, m: 9, d, hh: h1, mm: m1 }, Z),
    toInstant({ y: 2026, m: 9, d: d2, hh: h2, mm: m2 }, Z),
  );

describe('grids and windows', () => {
  it('builds a 6-week month grid starting on the Monday on or before the 1st', () => {
    const cells = monthGrid(2026, 9, '2026-09-28');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: '2026-08-31', day: 31, inMonth: false, today: false });
    expect(cells[1]?.inMonth).toBe(true);
    expect(cells.find((c) => c.today)?.date).toBe('2026-09-28');
    expect(monthGrid(2026, 6, '2026-01-01')[0]?.date).toBe('2026-06-01');
  });

  it('lists a week from Monday and computes view windows in the viewer zone', () => {
    expect(weekDates('2026-10-01')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    const w = viewWindow('week', '2026-10-01', Z);
    expect(w.from).toBe(toInstant({ y: 2026, m: 9, d: 28, hh: 0, mm: 0 }, Z));
    expect(w.to).toBe(toInstant({ y: 2026, m: 10, d: 5, hh: 0, mm: 0 }, Z));
    const m = viewWindow('month', '2026-09-15', Z);
    expect(m.from).toBe(toInstant({ y: 2026, m: 8, d: 31, hh: 0, mm: 0 }, Z));
    expect(m.to).toBe(toInstant({ y: 2026, m: 10, d: 12, hh: 0, mm: 0 }, Z));
  });
});

describe('month layout', () => {
  it('splits bars at week rows, packs lanes, and counts what does not fit', () => {
    const long = allDay('2026-09-04', '2026-09-08'); // Fri..Tue: crosses a row boundary
    const a = allDay('2026-09-07', '2026-09-07');
    const b = allDay('2026-09-07', '2026-09-07');
    const c = allDay('2026-09-07', '2026-09-07');
    const chip = timed(7, 9, 0, 10, 0);
    const late = timed(15, 23, 0, 1, 0, 16); // crosses midnight: a chip on both days (row 2 has no bars)
    const layout = monthLayout([long, a, b, c, chip, late], '2026-08-31', Z);
    const longBars = layout.bars.filter((x) => x.occ === long);
    expect(longBars.map((x) => [x.row, x.startCol, x.endCol])).toEqual([
      [0, 4, 6],
      [1, 0, 1],
    ]);
    // Row 1 has 4 bar lanes (long, a, b, c); 3 fit, so the 7th has one bar and the chip hidden.
    expect(layout.rowLanes[1]).toBe(4);
    const sept7 = layout.days[7];
    expect(sept7?.chips).toEqual([]);
    expect(sept7?.more).toBe(2);
    expect(layout.days[15]?.chips).toEqual([late]);
    expect(layout.days[16]?.chips).toEqual([late]);
  });
});

describe('week layout', () => {
  it('places boxes by wall time, splits at midnight and shares columns among overlaps', () => {
    const days = weekDates('2026-09-28');
    const x = timed(28, 9, 0, 10, 0);
    const y = timed(28, 9, 30, 11, 0);
    const z = timed(28, 10, 0, 10, 30);
    const night = timed(29, 23, 0, 1, 30, 30);
    const tiny = timed(30, 8, 0, 8, 5);
    const layout = weekLayout([x, y, z, night, tiny], days, Z);
    const box = (o: Occurrence) =>
      layout.boxes.filter((b) => b.occ === o).map((b) => [b.day, b.top, b.height, b.col, b.cols]);
    expect(box(x)).toEqual([[0, 540, 60, 0, 2]]);
    expect(box(y)).toEqual([[0, 570, 90, 1, 2]]);
    expect(box(z)).toEqual([[0, 600, 30, 0, 2]]);
    expect(box(night)).toEqual([
      [1, 1380, 60, 0, 1],
      [2, 0, 90, 0, 1],
    ]);
    expect(box(tiny)).toEqual([[2, 480, 15, 0, 1]]);
  });

  it('packs all-day occurrences into lanes across the week', () => {
    const days = weekDates('2026-09-28');
    const a = allDay('2026-09-27', '2026-09-29');
    const b = allDay('2026-09-29', '2026-10-01');
    const c = allDay('2026-10-03', '2026-10-06');
    const layout = weekLayout([a, b, c], days, Z);
    expect(layout.allDay.map((s) => [s.occ, s.startCol, s.endCol, s.lane])).toEqual([
      [a, 0, 1, 0],
      [b, 1, 3, 1],
      [c, 5, 6, 0],
    ]);
    expect(layout.allDayLanes).toBe(2);
  });
});
