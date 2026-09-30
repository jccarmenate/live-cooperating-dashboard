import { type Occurrence, toInstant } from '@relay/core';
import { describe, expect, it } from 'vitest';
import {
  grabMove,
  gridFocus,
  monthGrid,
  monthGridFrom,
  monthLayout,
  moveTarget,
  periodTitle,
  timeLabel,
  viewWindow,
  weekDates,
  weekLayout,
  zoneNote,
} from '../src/calendar/layout';

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

  it('never draws a box past midnight', () => {
    const late = timed(28, 23, 50, 23, 55);
    const layout = weekLayout([late], weekDates('2026-09-28'), Z);
    expect(layout.boxes.map((b) => [b.day, b.top, b.height])).toEqual([[0, 1430, 10]]);
  });

  it('draws boxes in wall minutes on DST days', () => {
    const at = (m: number, d: number, hh: number, mm: number) =>
      toInstant({ y: 2026, m, d, hh, mm }, Z);
    const MIN = 60_000;
    // Fall back, Sunday 25 Oct: 02:30 CEST + 40 min ends at 02:10 CET, above its start.
    const back = occ(
      { allDay: false, start: '', end: '', tz: Z },
      at(10, 25, 2, 30),
      at(10, 25, 2, 30) + 40 * MIN,
    );
    // 01:00 CEST + 4 h ends at 04:00 CET: 3 wall hours.
    const long = occ(
      { allDay: false, start: '', end: '', tz: Z },
      at(10, 25, 1, 0),
      at(10, 25, 1, 0) + 240 * MIN,
    );
    const fall = weekLayout([back, long], weekDates('2026-10-25'), Z);
    const box = (l: typeof fall, o: Occurrence) =>
      l.boxes.filter((b) => b.occ === o).map((b) => [b.day, b.top, b.height]);
    expect(box(fall, back)).toEqual([[6, 150, 15]]);
    expect(box(fall, long)).toEqual([[6, 60, 180]]);
    // Spring forward, Sunday 29 Mar: 01:30 CET + 1 h is 03:30 CEST, 2 wall hours.
    const fwd = occ(
      { allDay: false, start: '', end: '', tz: Z },
      at(3, 29, 1, 30),
      at(3, 29, 1, 30) + 60 * MIN,
    );
    const spring = weekLayout([fwd], weekDates('2026-03-29'), Z);
    expect(box(spring, fwd)).toEqual([[6, 90, 120]]);
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

describe('week-view move gestures', () => {
  // Monday 28 Sep 22:00 → Tuesday 29 Sep 02:00 (Madrid).
  const night = () => timed(28, 22, 0, 2, 0, 29);

  it('moves a cross-midnight event grabbed on its after-midnight part by the nudge only', () => {
    // Grabbed at 01:00 on Tuesday, then nudged 15 minutes down.
    const grab = grabMove(night(), '2026-09-29', Z, 60);
    expect(grab).toEqual({ offset: 180, length: 240, fits: false });
    expect(moveTarget(grab, '2026-09-29', 75)).toEqual({
      drop: { date: '2026-09-28', minutes: 22 * 60 + 15 },
      top: 0,
      height: 135,
    });
    // Dropped a day later (same pointer height on Wednesday): Tuesday 22:00.
    expect(moveTarget(grab, '2026-09-30', 60).drop).toEqual({ date: '2026-09-29', minutes: 1320 });
  });

  it('moves a cross-midnight event grabbed on its first day, clamping the preview to the column', () => {
    const grab = grabMove(night(), '2026-09-28', Z, 23 * 60);
    expect(grab).toEqual({ offset: 60, length: 240, fits: false });
    expect(moveTarget(grab, '2026-09-28', 23 * 60 + 15)).toEqual({
      drop: { date: '2026-09-28', minutes: 22 * 60 + 15 },
      top: 22 * 60 + 15,
      height: 105,
    });
  });

  it('keeps an event that fits its day inside the day', () => {
    const grab = grabMove(timed(28, 9, 0, 10, 0), '2026-09-28', Z, 9 * 60 + 30);
    expect(grab).toEqual({ offset: 30, length: 60, fits: true });
    expect(moveTarget(grab, '2026-09-30', 1440)).toEqual({
      drop: { date: '2026-09-30', minutes: 23 * 60 },
      top: 23 * 60,
      height: 60,
    });
    expect(moveTarget(grab, '2026-09-30', 0).drop).toEqual({ date: '2026-09-30', minutes: 0 });
  });
});

describe('the editor zone note', () => {
  const havana = (start: string, end: string) =>
    ({ allDay: false, start, end, tz: 'America/Havana' }) as const;

  it('shows the event zone times, with dates when its day is not the day shown', () => {
    expect(zoneNote(havana('2026-09-30T20:00', '2026-09-30T21:00'), Z, '2026-09-30')).toBe(
      'Event time: 20:00–21:00 America/Havana',
    );
    // 20:00 Havana is 02:00 the next day in Madrid.
    expect(zoneNote(havana('2026-09-30T20:00', '2026-09-30T21:00'), Z, '2026-10-01')).toBe(
      'Event time: 30 Sep 20:00–21:00 America/Havana',
    );
    expect(zoneNote(havana('2026-09-30T23:00', '2026-10-01T01:00'), Z, '2026-10-01')).toBe(
      'Event time: 30 Sep 23:00 – 1 Oct 01:00 America/Havana',
    );
    expect(
      zoneNote(havana('2026-09-30T20:00', '2026-09-30T21:00'), 'America/Havana', 'x'),
    ).toBeNull();
    expect(zoneNote({ allDay: true, start: '2026-09-30', end: '2026-09-30' }, Z, 'x')).toBeNull();
  });
});

describe('titles and labels', () => {
  it('names the period in en-GB style', () => {
    expect(periodTitle('month', '2026-09-15')).toBe('September 2026');
    expect(periodTitle('week', '2026-09-24')).toBe('21 – 27 Sep 2026');
    expect(periodTitle('week', '2026-10-01')).toBe('28 Sep – 4 Oct 2026');
    expect(periodTitle('week', '2026-01-01')).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(timeLabel(9 * 60 + 5)).toBe('09:05');
    expect(timeLabel(0)).toBe('00:00');
  });
});

describe('rolling month grid', () => {
  it('builds 42 days from any Monday, dimming days outside the month of its third row', () => {
    const cells = monthGridFrom('2026-09-07', '2026-09-28');
    expect(cells).toHaveLength(42);
    expect(cells[0]?.date).toBe('2026-09-07');
    expect(cells[41]?.date).toBe('2026-10-18');
    expect(gridFocus('2026-09-07')).toBe('2026-09-24');
    expect(cells.filter((c) => c.inMonth).map((c) => c.date)).toHaveLength(24);
    expect(cells.find((c) => c.date === '2026-10-01')?.inMonth).toBe(false);
    expect(cells.find((c) => c.today)?.date).toBe('2026-09-28');
  });

  it('matches the calendar-month grid when the start is the grid of a month', () => {
    expect(monthGridFrom('2026-08-31', '2026-09-28')).toEqual(monthGrid(2026, 9, '2026-09-28'));
    expect(gridFocus('2026-08-31')).toBe('2026-09-17');
  });

  it('gives the rolled grid its own window', () => {
    const w = viewWindow('month', '2026-09-24', 'Europe/Madrid', '2026-09-07');
    expect(w.from).toBe(toInstant({ y: 2026, m: 9, d: 7, hh: 0, mm: 0 }, 'Europe/Madrid'));
    expect(w.to).toBe(toInstant({ y: 2026, m: 10, d: 19, hh: 0, mm: 0 }, 'Europe/Madrid'));
  });
});
