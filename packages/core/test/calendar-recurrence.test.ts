import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  type CalendarEvent,
  EVENT_COLORS,
  type Exception,
  type ExpandWindow,
  expand,
  expandAll,
  formatDate,
  formatWall,
  fromWallMinutes,
  isOccurrence,
  type Occurrence,
  occurrenceWhen,
  parseDate,
  type Rule,
  toInstant,
  toWall,
  type When,
  wallMinutes,
  whenRange,
} from '../src';

const MADRID = 'Europe/Madrid';
/** Generous, so that slow CI machines do not flake; the freeze it guards against took 18–30 s. */
const BUDGET_MS = 5000;
const at = (y: number, m: number, d: number, tz = 'UTC') =>
  toInstant({ y, m, d, hh: 0, mm: 0 }, tz);

function ev(when: When, rule?: Rule, exceptions: CalendarEvent['exceptions'] = {}): CalendarEvent {
  return {
    id: 'e1',
    title: 'Series',
    notes: '',
    color: EVENT_COLORS[0] as string,
    when,
    ...(rule ? { rule } : {}),
    exceptions,
    rsvp: {},
    createdBy: 'u1',
    createdAt: 0,
  };
}

const timed = (start: string, end: string, tz = MADRID): When => ({
  allDay: false,
  start,
  end,
  tz,
});
const keys = (e: CalendarEvent, from: number, to: number, zone = MADRID) =>
  expand(e, { from, to, zone } satisfies ExpandWindow).map((o) => o.key);

describe('expand', () => {
  it('returns a single event once, when it overlaps the window', () => {
    const e = ev(timed('2026-09-28T09:00', '2026-09-28T10:00'));
    expect(keys(e, at(2026, 9, 28, MADRID), at(2026, 9, 29, MADRID))).toEqual(['2026-09-28']);
    expect(keys(e, at(2026, 9, 29, MADRID), at(2026, 9, 30, MADRID))).toEqual([]);
  });

  it('repeats daily with an interval and an inclusive until', () => {
    const e = ev(timed('2026-09-01T09:00', '2026-09-01T09:30'), {
      freq: 'daily',
      interval: 2,
      until: '2026-09-07',
    });
    expect(keys(e, at(2026, 8, 1), at(2026, 10, 1))).toEqual([
      '2026-09-01',
      '2026-09-03',
      '2026-09-05',
      '2026-09-07',
    ]);
  });

  it('repeats weekly on chosen weekdays, and counts cancelled occurrences toward count', () => {
    const e = ev(
      timed('2026-09-28T09:00', '2026-09-28T09:15'),
      { freq: 'weekly', interval: 1, byDay: [0, 2], count: 4 },
      { '2026-09-30': { cancelled: true } },
    );
    expect(keys(e, at(2026, 9, 1), at(2026, 12, 1))).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-07',
    ]);
  });

  it('skips months without the day, and 29 February outside leap years', () => {
    const monthly = ev(
      { allDay: true, start: '2026-01-31', end: '2026-01-31' },
      { freq: 'monthly', interval: 1, count: 4 },
    );
    expect(keys(monthly, at(2026, 1, 1), at(2027, 1, 1))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
    const yearly = ev(
      { allDay: true, start: '2028-02-29', end: '2028-02-29' },
      { freq: 'yearly', interval: 1 },
    );
    expect(keys(yearly, at(2028, 1, 1), at(2037, 1, 1))).toEqual([
      '2028-02-29',
      '2032-02-29',
      '2036-02-29',
    ]);
  });

  it('keeps the wall time across a DST change', () => {
    const e = ev(timed('2026-10-19T09:00', '2026-10-19T10:00'), { freq: 'weekly', interval: 1 });
    const occ = expand(e, { from: at(2026, 10, 18), to: at(2026, 11, 3), zone: 'UTC' });
    expect(occ.map((o) => o.when.start)).toEqual([
      '2026-10-19T09:00',
      '2026-10-26T09:00',
      '2026-11-02T09:00',
    ]);
    // In UTC the same meeting moves from 07:00 to 08:00 when Madrid leaves summer time.
    expect(occ.map((o) => new Date(o.start).getUTCHours())).toEqual([7, 8, 8]);
  });

  it('applies exceptions: changed fields, and an occurrence moved into the window', () => {
    const e = ev(
      timed('2026-09-01T09:00', '2026-09-01T10:00'),
      { freq: 'daily', interval: 1, count: 10 },
      {
        '2026-09-02': { when: timed('2026-09-20T12:00', '2026-09-20T13:00'), title: 'Moved' },
        '2026-09-03': {
          when: timed('2026-09-03T15:00', '2026-09-03T16:00'),
          color: EVENT_COLORS[1] as string,
        },
      },
    );
    const occ = expand(e, {
      from: at(2026, 9, 15, MADRID),
      to: at(2026, 9, 25, MADRID),
      zone: MADRID,
    });
    expect(occ.map((o) => [o.key, o.title, o.changed])).toEqual([['2026-09-02', 'Moved', true]]);
    const third = expand(e, {
      from: at(2026, 9, 3, MADRID),
      to: at(2026, 9, 4, MADRID),
      zone: MADRID,
    });
    expect(third.map((o) => [o.key, o.color, o.when.start])).toEqual([
      ['2026-09-03', EVENT_COLORS[1], '2026-09-03T15:00'],
    ]);
  });

  it('places all-day events on the same dates in every zone', () => {
    const e = ev({ allDay: true, start: '2026-09-28', end: '2026-09-29' });
    for (const zone of ['Pacific/Auckland', 'America/Havana']) {
      const [o] = expand(e, { from: at(2026, 9, 27, zone), to: at(2026, 10, 1, zone), zone });
      expect(o?.start).toBe(at(2026, 9, 28, zone));
      expect(o?.end).toBe(at(2026, 9, 30, zone));
    }
  });

  it('includes an occurrence that started before the window and still runs', () => {
    const e = ev(timed('2026-09-01T22:00', '2026-09-02T02:00'), { freq: 'daily', interval: 1 });
    expect(keys(e, at(2026, 9, 10, MADRID), at(2026, 9, 11, MADRID))).toEqual([
      '2026-09-09',
      '2026-09-10',
    ]);
  });

  it('knows which dates are occurrences', () => {
    const e = ev(timed('2026-09-28T09:00', '2026-09-28T09:15'), {
      freq: 'weekly',
      interval: 2,
      byDay: [0, 4],
    });
    const d = (s: string) => parseDate(s) ?? { y: 0, m: 0, d: 0 };
    expect(isOccurrence(e, d('2026-10-02'))).toBe(true);
    expect(isOccurrence(e, d('2026-10-09'))).toBe(false);
    expect(isOccurrence(e, d('2026-10-12'))).toBe(true);
    expect(isOccurrence(e, d('2026-09-27'))).toBe(false);
  });

  it('expanding window by window equals expanding the whole range (property)', () => {
    const ruleArb = fc.record({
      freq: fc.constantFrom(
        'daily' as const,
        'weekly' as const,
        'monthly' as const,
        'yearly' as const,
      ),
      interval: fc.integer({ min: 1, max: 4 }),
      byDay: fc.option(
        fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 3 }),
        { nil: undefined },
      ),
      count: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(
        ruleArb,
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 1, max: 300 }),
        (raw, day, cut) => {
          const rule: Rule = { freq: raw.freq, interval: raw.interval };
          if (raw.freq === 'weekly' && raw.byDay) rule.byDay = [...raw.byDay].sort((a, b) => a - b);
          if (raw.count) rule.count = raw.count;
          const e = ev(
            timed(
              `2026-01-${String(day).padStart(2, '0')}T09:00`,
              `2026-01-${String(day).padStart(2, '0')}T10:00`,
            ),
            rule,
          );
          const a = at(2026, 1, 1);
          const c = at(2027, 6, 1);
          const b = a + cut * 86_400_000;
          const whole = keys(e, a, c, 'UTC');
          const split = [...new Set([...keys(e, a, b, 'UTC'), ...keys(e, b, c, 'UTC')])];
          expect(split).toEqual(whole);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('expandAll', () => {
  it('caps the result and reports truncation', () => {
    const cal = {
      events: Array.from({ length: 3 }, (_, i) => ({
        ...ev(
          { allDay: true, start: '2026-01-01', end: '2026-01-01' },
          { freq: 'daily', interval: 1 },
        ),
        id: `e${i}`,
      })),
    };
    const res = expandAll(cal, { from: at(2026, 1, 1), to: at(2027, 1, 1), zone: 'UTC' });
    expect(res.occurrences).toHaveLength(1000);
    expect(res.truncated).toBe(true);
    const first = res.occurrences.slice(0, 3).map((o) => o.eventId);
    expect(first).toEqual(['e0', 'e1', 'e2']);
  });

  it('expands counted series with many exceptions at the caps within a time budget', () => {
    const start = parseDate('2026-01-01') ?? { y: 0, m: 0, d: 0 };
    const day = (n: number) => formatDate(addDays(start, n));
    const allDay = (d: string): When => ({ allDay: true, start: d, end: d });
    // 200 exceptions outside the window: 198 edits in place, one occurrence moved into the
    // window, and one on a date past the count (not an occurrence, so ignored).
    const exceptions: CalendarEvent['exceptions'] = {};
    for (let k = 1; k < 199; k++)
      exceptions[day(700 + k)] = { when: allDay(day(700 + k)), title: 'Edited' };
    exceptions[day(700)] = { when: allDay('2026-01-07'), title: 'Moved' };
    exceptions[day(1100)] = { when: allDay('2026-01-08'), title: 'Ghost' };
    expect(Object.keys(exceptions)).toHaveLength(200);
    const events = Array.from({ length: 500 }, (_, i) => ({
      ...ev(allDay('2026-01-01'), { freq: 'daily', interval: 1, count: 999 }, exceptions),
      id: `e${String(i).padStart(3, '0')}`,
    }));
    const win = { from: at(2026, 1, 5), to: at(2026, 1, 12), zone: 'UTC' };

    const t0 = Date.now();
    const perEvent = events.map((e) => expand(e, win));
    const all = expandAll({ events }, win);
    const elapsed = Date.now() - t0;

    // Each series: 5–11 January, plus the occurrence moved in from its original date.
    for (const occ of perEvent) {
      expect(occ.map((o) => o.key)).toEqual([
        '2026-01-05',
        '2026-01-06',
        '2026-01-07',
        day(700),
        '2026-01-08',
        '2026-01-09',
        '2026-01-10',
        '2026-01-11',
      ]);
    }
    expect(perEvent[0]?.find((o) => o.key === day(700))?.title).toBe('Moved');
    expect(all.occurrences).toHaveLength(1000);
    expect(all.truncated).toBe(true);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it.each([
    ['42-day', at(2026, 3, 2), at(2026, 4, 13)],
    ['400-day', at(2026, 1, 1), at(2027, 2, 5)],
  ])(
    'stops early for 500 plain daily timed series over a %s window',
    (_, from, to) => {
      const events = Array.from({ length: 500 }, (_, i) => ({
        ...ev(timed('2025-06-01T09:00', '2025-06-01T10:00'), { freq: 'daily', interval: 1 }),
        id: `e${String(i).padStart(3, '0')}`,
      }));
      const win = { from, to, zone: MADRID };

      const t0 = Date.now();
      const res = expandAll({ events }, win);
      const elapsed = Date.now() - t0;

      // The first 1000 by start: every series on the window's first day, then its second day,
      // each day in event-id order.
      const firstDay = formatDate(toWall(from, 'UTC'));
      const secondDay = formatDate(addDays(toWall(from, 'UTC'), 1));
      expect(res.truncated).toBe(true);
      expect(res.occurrences).toHaveLength(1000);
      expect(res.occurrences.slice(0, 500).every((o) => o.key === firstDay)).toBe(true);
      expect(res.occurrences.slice(500).every((o) => o.key === secondDay)).toBe(true);
      expect(res.occurrences.slice(0, 500).map((o) => o.eventId)).toEqual(events.map((e) => e.id));
      expect(res.occurrences[0]?.when).toEqual(timed(`${firstDay}T09:00`, `${firstDay}T10:00`));
      expect(res.occurrences[0]?.start).toBe(
        toInstant({ ...toWall(from, 'UTC'), hh: 9, mm: 0 }, MADRID),
      );
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );

  it('stays fast when 500 series each move 200 past occurrences into the window', () => {
    // Exception k is keyed on the series' real occurrence 2025-01-01 + k days and moved to
    // day k % 3 of the window at 08:00 + (k % 8) h: the moves cluster on the window's first
    // days, and many share the earliest start.
    const seriesStart = { y: 2025, m: 1, d: 1 };
    const winStart = { y: 2026, m: 3, d: 2 };
    const exceptions: CalendarEvent['exceptions'] = {};
    for (let k = 0; k < 200; k++) {
      const d = formatDate(addDays(winStart, k % 3));
      const hh = String(8 + (k % 8)).padStart(2, '0');
      exceptions[formatDate(addDays(seriesStart, k))] = {
        when: timed(`${d}T${hh}:00`, `${d}T${hh}:30`),
        title: 'Moved',
      };
    }
    const events = Array.from({ length: 500 }, (_, i) => ({
      ...ev(
        timed('2025-01-01T09:00', '2025-01-01T10:00'),
        { freq: 'daily', interval: 1 },
        exceptions,
      ),
      id: `e${String(i).padStart(3, '0')}`,
    }));
    const win = { from: at(2026, 3, 2, MADRID), to: at(2026, 4, 13, MADRID), zone: MADRID };

    const t0 = Date.now();
    const res = expandAll({ events }, win);
    const elapsed = Date.now() - t0;

    // 9 moves per series land at the earliest start (k ≡ 0 mod 24), so the first 1000 are all
    // moved occurrences at 2 March 08:00, by event id and then key.
    const earliest = toInstant({ ...winStart, hh: 8, mm: 0 }, MADRID);
    const firstKeys = Array.from({ length: 9 }, (_, j) => formatDate(addDays(seriesStart, 24 * j)));
    expect(res.truncated).toBe(true);
    expect(res.occurrences).toHaveLength(1000);
    expect(
      res.occurrences.every((o) => o.start === earliest && o.changed && o.title === 'Moved'),
    ).toBe(true);
    expect(res.occurrences.slice(0, 9).map((o) => [o.eventId, o.key])).toEqual(
      firstKeys.map((k) => ['e000', k]),
    );
    expect(res.occurrences[999]?.eventId).toBe('e111');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it('equals expanding every event fully and then sorting (property)', () => {
    const zones = ['UTC', MADRID, 'America/Havana', 'Pacific/Apia', 'Australia/Lord_Howe'];
    const dateArb = fc
      .integer({ min: 0, max: 120 })
      .map((n) => formatDate(addDays({ y: 2026, m: 1, d: 1 }, n)));
    const whenArb = fc.oneof(
      fc.record({ d: dateArb, span: fc.integer({ min: 0, max: 3 }) }).map(({ d, span }): When => {
        const s = parseDate(d) ?? { y: 2026, m: 1, d: 1 };
        return { allDay: true, start: d, end: formatDate(addDays(s, span)) };
      }),
      fc
        .record({
          d: dateArb,
          min: fc.integer({ min: 0, max: 95 }).map((q) => q * 15),
          len: fc.integer({ min: 0, max: 3 * 96 }).map((q) => q * 15),
          tz: fc.constantFrom(...zones),
        })
        .map(({ d, min, len, tz }): When => {
          const s = { ...(parseDate(d) ?? { y: 2026, m: 1, d: 1 }), hh: 0, mm: 0 };
          return {
            allDay: false,
            start: formatWall(fromWallMinutes(wallMinutes(s) + min)),
            end: formatWall(fromWallMinutes(wallMinutes(s) + min + len)),
            tz,
          };
        }),
    );
    const ruleArb = fc.option(
      fc.record(
        {
          freq: fc.constantFrom('daily' as const, 'weekly' as const, 'monthly' as const),
          interval: fc.integer({ min: 1, max: 3 }),
          byDay: fc
            .uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 3 })
            .map((a) => [...a].sort((x, y) => x - y)),
          count: fc.integer({ min: 1, max: 30 }),
          until: dateArb,
        },
        { requiredKeys: ['freq', 'interval'] },
      ),
      { nil: undefined },
    );
    const exceptionArb = fc.oneof(
      fc.constant<Exception>({ cancelled: true }),
      whenArb.map((when): Exception => ({ when, title: 'Changed' })),
    );
    const eventArb = fc
      .record({
        when: whenArb,
        rule: ruleArb,
        exceptions: fc.dictionary(dateArb, exceptionArb, { maxKeys: 6 }),
      })
      .map(({ when, rule, exceptions }) => {
        if (!rule) return ev(when, undefined, exceptions);
        const { byDay, ...rest } = rule;
        return ev(when, rule.freq === 'weekly' && byDay ? { ...rest, byDay } : rest, exceptions);
      });
    fc.assert(
      fc.property(
        fc.array(eventArb, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 12 }),
        fc.constantFrom(...zones),
        (raw, fromDay, days, limit, zone) => {
          const events = raw.map((e, i) => ({ ...e, id: `e${i}` }));
          const from = at(2026, 1, 1) + fromDay * 86_400_000;
          const win = { from, to: from + days * 86_400_000, zone };
          const naive = events.flatMap((e) => expand(e, win, Number.POSITIVE_INFINITY)).sort(order);
          const res = expandAll({ events }, win, limit);
          expect(res.occurrences).toEqual(naive.slice(0, limit));
          expect(res.truncated).toBe(naive.length > limit);
          for (const e of events) {
            const full = expand(e, win, Number.POSITIVE_INFINITY);
            expect(expand(e, win, limit)).toEqual(full.slice(0, limit));
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

const order = (a: Occurrence, b: Occurrence): number =>
  a.start - b.start ||
  (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0) ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

describe('series edges', () => {
  it('reads an until before the start as the start date: one occurrence', () => {
    const e = ev(timed('2026-09-10T09:00', '2026-09-10T10:00'), {
      freq: 'daily',
      interval: 1,
      until: '2026-09-01',
    });
    expect(keys(e, at(2026, 8, 1), at(2026, 11, 1))).toEqual(['2026-09-10']);
    expect(isOccurrence(e, { y: 2026, m: 9, d: 10 })).toBe(true);
    expect(isOccurrence(e, { y: 2026, m: 9, d: 11 })).toBe(false);
  });

  it('carries occurrence instants that match whenRange of the occurrence when (property)', () => {
    const zones = [MADRID, 'America/Havana', 'Australia/Lord_Howe', 'Pacific/Apia', 'UTC'];
    fc.assert(
      fc.property(
        fc.constantFrom(...zones),
        fc.constantFrom(...zones),
        fc.integer({ min: 0, max: 95 }).map((q) => q * 15),
        fc.integer({ min: 0, max: 14 * 96 }).map((q) => q * 15),
        fc.integer({ min: 0, max: 330 }),
        fc.boolean(),
        (tz, zone, min, len, day, allDay) => {
          const s = { y: 2026, m: 1, d: 1, hh: 0, mm: 0 };
          const base: When = allDay
            ? { allDay: true, start: '2026-01-01', end: formatDate(addDays(s, len % 30)) }
            : {
                allDay: false,
                start: formatWall(fromWallMinutes(wallMinutes(s) + min)),
                end: formatWall(fromWallMinutes(wallMinutes(s) + min + len)),
                tz,
              };
          const e = ev(base, { freq: 'daily', interval: 1 });
          const from = at(2026, 1, 1) + day * 86_400_000;
          const occ = expand(e, { from, to: from + 3 * 86_400_000, zone });
          expect(occ.length).toBeGreaterThan(0);
          for (const o of occ) {
            expect(o.when).toEqual(occurrenceWhen(base, parseDate(o.key) ?? s));
            expect({ start: o.start, end: o.end }).toEqual(whenRange(o.when, zone));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('includes a far-keyed exception exactly when its when overlaps the window (property)', () => {
    const zones = ['Pacific/Kiritimati', 'Etc/GMT+12', 'Pacific/Apia', 'UTC', MADRID];
    const FAR_KEY = '2010-06-15';
    const origin = { y: 2026, m: 3, d: 1, hh: 0, mm: 0 };
    const whenArb = fc.oneof(
      fc
        .record({ d: fc.integer({ min: -400, max: 20 }), span: fc.integer({ min: 0, max: 365 }) })
        .map(({ d, span }): When => {
          const s = addDays(origin, d);
          return { allDay: true, start: formatDate(s), end: formatDate(addDays(s, span)) };
        }),
      fc
        .record({
          m: fc.integer({ min: -16 * 1440, max: 6 * 1440 }),
          len: fc.integer({ min: 0, max: 14 * 1440 }),
          tz: fc.constantFrom(...zones),
        })
        .map(({ m, len, tz }): When => {
          const s = wallMinutes(origin) + m;
          return {
            allDay: false,
            start: formatWall(fromWallMinutes(s)),
            end: formatWall(fromWallMinutes(s + len)),
            tz,
          };
        }),
    );
    fc.assert(
      fc.property(
        whenArb,
        fc.integer({ min: -3 * 1440, max: 3 * 1440 }),
        fc.integer({ min: 0, max: 3 * 1440 }),
        fc.constantFrom(...zones),
        (when, fromMin, lenMin, zone) => {
          const e = ev(
            { allDay: true, start: '2000-01-01', end: '2000-01-01' },
            { freq: 'daily', interval: 1 },
            { [FAR_KEY]: { when, title: 'Far' } },
          );
          const from = toInstant(origin, 'UTC') + fromMin * 60_000;
          const win = { from, to: from + lenMin * 60_000, zone };
          const r = whenRange(when, zone);
          const overlaps =
            r.start < win.to && (r.end > win.from || (r.end === r.start && r.start >= win.from));
          const included = expand(e, win, Number.POSITIVE_INFINITY).some((o) => o.key === FAR_KEY);
          expect(included).toBe(overlaps);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
