// packages/core/test/calendar-ics.test.ts
import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  type CalendarSnapshot,
  EVENT_COLORS,
  parseIcs,
  writeIcs,
} from '../src';

declare const TextEncoder: new () => { encode(input: string): Uint8Array };

const base = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1',
  title: 'Standup',
  notes: '',
  color: EVENT_COLORS[0] as string,
  when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:15', tz: 'Europe/Madrid' },
  exceptions: {},
  rsvp: {},
  createdBy: 'u1',
  createdAt: 0,
  ...over,
});

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

describe('writeIcs', () => {
  it('writes a calendar with zoned, all-day and repeating events', () => {
    const cal: CalendarSnapshot = {
      events: [
        base({
          notes: 'Line 1\nsemi; comma, back\\slash',
          rule: { freq: 'weekly', interval: 2, byDay: [0, 2], until: '2026-12-31' },
          exceptions: {
            '2026-09-30': { cancelled: true },
            '2026-10-12': {
              when: {
                allDay: false,
                start: '2026-10-12T10:00',
                end: '2026-10-12T10:15',
                tz: 'Europe/Madrid',
              },
              title: 'Late',
            },
          },
        }),
        base({
          id: 'e2',
          title: 'Trip',
          uid: 'trip@example.com',
          when: { allDay: true, start: '2026-10-01', end: '2026-10-03' },
        }),
      ],
    };
    const text = writeIcs(cal, { name: 'Team', now: NOW });
    expect(
      text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Relay//Calendar//EN\r\n'),
    ).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('UID:e1@relay\r\n');
    expect(text).toContain('DTSTAMP:20260928T120000Z\r\n');
    expect(text).toContain('DTSTART;TZID=Europe/Madrid:20260928T090000\r\n');
    expect(text).toContain('DTEND;TZID=Europe/Madrid:20260928T091500\r\n');
    expect(text).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T225900Z\r\n');
    expect(text).toContain('EXDATE;TZID=Europe/Madrid:20260930T090000\r\n');
    expect(text).toContain('RECURRENCE-ID;TZID=Europe/Madrid:20261012T090000\r\n');
    expect(text).toContain('SUMMARY:Late\r\n');
    expect(text).toContain('DESCRIPTION:Line 1\\nsemi\\; comma\\, back\\\\slash\r\n');
    expect(text).toContain('UID:trip@example.com\r\n');
    expect(text).toContain('DTSTART;VALUE=DATE:20261001\r\n');
    expect(text).toContain('DTEND;VALUE=DATE:20261004\r\n');
  });

  it('escapes every line break, so text cannot inject content lines', () => {
    const title = 'a\rBEGIN:VEVENT\rb\r\nc\nd';
    const text = writeIcs({ events: [base({ title })] }, { name: 'x', now: NOW });
    expect(text).toContain('SUMMARY:a\\nBEGIN:VEVENT\\nb\\nc\\nd\r\n');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(parseIcs(text, { zone: 'UTC' }).events.map((e) => e.fields.title)).toEqual([
      'a\nBEGIN:VEVENT\nb\nc\nd',
    ]);
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const text = writeIcs({ events: [base({ title: 'é'.repeat(100) })] }, { name: 'x', now: NOW });
    for (const line of text.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const summary = parseIcs(text, { zone: 'UTC' }).events[0]?.fields.title;
    expect(summary).toBe('é'.repeat(100));
  });

  /** `series` daily series × 200 exceptions (100 moved, 100 cancelled), full title and notes. */
  const bigCalendar = (series: number): CalendarSnapshot => {
    const tz = 'Europe/Madrid';
    const events = Array.from({ length: series }, (_, i) => {
      const exceptions: CalendarEvent['exceptions'] = {};
      for (let k = 0; k < 200; k++) {
        const d = new Date(Date.UTC(2026, 9, 1 + k)).toISOString().slice(0, 10);
        exceptions[d] =
          k % 2
            ? { cancelled: true }
            : {
                when: { allDay: false, start: `${d}T10:00`, end: `${d}T11:00`, tz },
                title: 'Moved',
              };
      }
      return base({
        id: `e${i}`,
        title: 'T'.repeat(120),
        notes: 'é'.repeat(2000),
        rule: { freq: 'daily', interval: 1 },
        exceptions,
      });
    });
    return { events };
  };
  const encoder = new TextEncoder();
  const longestLine = (text: string) =>
    text.split('\r\n').reduce((max, line) => Math.max(max, encoder.encode(line).length), 0);

  it('exports a large calendar correctly (50 series × 200 exceptions, full notes)', () => {
    const text = writeIcs(bigCalendar(50), { name: 'Big', now: NOW });
    // Each series is one master plus 100 moved occurrences, each repeating the 2000-char notes.
    expect(text.split('BEGIN:VEVENT').length - 1).toBe(50 * 101);
    expect(longestLine(text)).toBeLessThanOrEqual(75);
    const unfolded = text.replace(/\r\n /g, '');
    expect(unfolded.split(`\r\nDESCRIPTION:${'é'.repeat(2000)}\r\n`).length - 1).toBe(50 * 101);
    expect(unfolded.split(`\r\nSUMMARY:${'T'.repeat(120)}\r\n`).length - 1).toBe(50);
  }, 30_000);

  it('exports a calendar at the caps in bounded time (500 series × 200 exceptions)', () => {
    const cal = bigCalendar(500);
    const t0 = Date.now();
    const text = writeIcs(cal, { name: 'Big', now: NOW });
    const ms = Date.now() - t0;
    expect(text.split('BEGIN:VEVENT').length - 1).toBe(500 * 101);
    expect(longestLine(text.slice(0, 200_000))).toBeLessThanOrEqual(75);
    // A generous budget: about 1.2 s here, and about 44 s before folding stopped encoding
    // every character on its own.
    expect(ms).toBeLessThan(15_000);
  }, 60_000);
});

describe('parseIcs', () => {
  it('round-trips what writeIcs writes', () => {
    const e = base({
      notes: 'a, b; c\nd',
      rule: { freq: 'monthly', interval: 1, count: 6 },
      exceptions: {
        '2026-10-28': { cancelled: true },
        '2026-11-28': {
          when: {
            allDay: false,
            start: '2026-11-29T11:00',
            end: '2026-11-29T11:30',
            tz: 'Europe/Madrid',
          },
          title: 'Moved',
        },
      },
    });
    const { events, warnings } = parseIcs(writeIcs({ events: [e] }, { name: 'x', now: NOW }), {
      zone: 'America/Havana',
    });
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      uid: 'e1@relay',
      fields: {
        title: 'Standup',
        notes: 'a, b; c\nd',
        color: EVENT_COLORS[0],
        when: e.when,
        rule: e.rule,
      },
      exceptions: e.exceptions,
    });
  });

  it('reads UTC and floating times in the importer zone, durations and missing ends', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'DTSTART:20260928T070000Z',
      'DURATION:PT1H30M',
      'SUMMARY:UTC',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:b',
      'DTSTART:20260928T090000',
      'SUMMARY:Floating',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:c',
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261001',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { events } = parseIcs(ics, { zone: 'Europe/Madrid' });
    expect(events.map((e) => e.fields.when)).toEqual([
      { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T10:30', tz: 'Europe/Madrid' },
      { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T10:00', tz: 'Europe/Madrid' },
      { allDay: true, start: '2026-10-01', end: '2026-10-01' },
    ]);
    expect(events[2]?.fields.title).toBe('Untitled');
  });

  it('warns about what it cannot represent, and skips duplicates and orphans', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:r',
      'DTSTART;TZID=Romance Standard Time:20260928T090000',
      'RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:r',
      'DTSTART:20260929T090000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:nobody',
      'RECURRENCE-ID:20261001T090000Z',
      'DTSTART:20261001T100000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:nostart',
      'SUMMARY:No start',
      'END:VEVENT',
      'BEGIN:VTODO',
      'UID:todo',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    const { events, warnings } = parseIcs(ics, { zone: 'UTC' });
    expect(
      events.map((e) => [
        e.uid,
        e.fields.when.allDay ? '' : e.fields.when.tz,
        e.fields.rule ?? null,
      ]),
    ).toEqual([['r', 'UTC', null]]);
    expect(warnings).toEqual([
      { line: 4, message: 'Unknown time zone "Romance Standard Time"; read as UTC' },
      { line: 2, message: 'Repeat rule not supported; only the first date was imported' },
      { line: 7, message: 'Duplicate event "r"; skipped' },
      { line: 16, message: 'Event without a valid start; skipped' },
      { line: 11, message: 'A changed occurrence has no series; skipped' },
    ]);
  });

  it('unfolds lines and unescapes text, and ignores alarms inside events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'DTSTART;VALUE=DATE:20261005',
      'SUMMARY:Long ti',
      ' tle\\, folded',
      'BEGIN:VALARM',
      'DESCRIPTION:Not the event',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [e] = parseIcs(ics, { zone: 'UTC' }).events;
    expect(e?.fields.title).toBe('Long title, folded');
    expect(e?.fields.notes).toBe('');
  });
});

/** A one-event calendar around `lines`, CRLF-joined; the event starts on physical line 2. */
const oneEvent = (...lines: string[]): string =>
  ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

describe('parseIcs limits and edge cases', () => {
  it('reads a long EXDATE list under an unknown zone once, warning once and capping at 200', () => {
    const values = Array.from({ length: 5000 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 9, 1) + i * 86_400_000);
      return `${day.toISOString().slice(0, 10).replace(/-/g, '')}T090000`;
    });
    const ics = oneEvent(
      'UID:long',
      'DTSTART;TZID=Foo/Bar:20260928T090000',
      'RRULE:FREQ=DAILY',
      `EXDATE;TZID=Foo/Bar:${values.join(',')}`,
      `EXDATE;TZID=Foo/Bar:${values.slice(0, 3).join(',')}`,
    );
    const { events, warnings } = parseIcs(ics, { zone: 'Europe/Madrid' });
    expect(warnings).toEqual([{ line: 4, message: 'Unknown time zone "Foo/Bar"; read as UTC' }]);
    expect(Object.keys(events[0]?.exceptions ?? {})).toHaveLength(200);
    expect(events[0]?.exceptions['2026-10-01']).toEqual({ cancelled: true });
  });

  it('keeps cleared notes on a changed occurrence through a round trip', () => {
    const e = base({
      notes: 'Agenda',
      rule: { freq: 'daily', interval: 1 },
      exceptions: {
        '2026-09-29': {
          when: {
            allDay: false,
            start: '2026-09-29T10:00',
            end: '2026-09-29T10:15',
            tz: 'Europe/Madrid',
          },
          notes: '',
        },
      },
    });
    const text = writeIcs({ events: [e] }, { name: 'x', now: NOW });
    expect(text).toContain('DESCRIPTION:\r\n');
    expect(parseIcs(text, { zone: 'UTC' }).events[0]?.exceptions).toEqual(e.exceptions);
  });

  it('reads a UTC UNTIL as its date in the event zone', () => {
    const ics = oneEvent(
      'UID:u',
      'DTSTART;TZID=America/New_York:20260928T200000',
      'RRULE:FREQ=DAILY;UNTIL=20261003T000000Z',
    );
    expect(parseIcs(ics, { zone: 'UTC' }).events[0]?.fields.rule).toEqual({
      freq: 'daily',
      interval: 1,
      until: '2026-10-02',
    });
  });

  it('reads a floating UNTIL in the event zone, not in UTC', () => {
    const ics = oneEvent(
      'UID:t',
      'DTSTART;TZID=Asia/Tokyo:20260928T090000',
      'RRULE:FREQ=DAILY;UNTIL=20261002T230000',
    );
    expect(parseIcs(ics, { zone: 'UTC' }).events[0]?.fields.rule?.until).toBe('2026-10-02');
  });

  it('reads DATE-valued EXDATEs on an all-day series', () => {
    const ics = oneEvent(
      'UID:d',
      'DTSTART;VALUE=DATE:20261001',
      'RRULE:FREQ=WEEKLY',
      'EXDATE;VALUE=DATE:20261008,20261015',
      'EXDATE;VALUE=DATE:20261029',
    );
    expect(parseIcs(ics, { zone: 'UTC' }).events[0]?.exceptions).toEqual({
      '2026-10-08': { cancelled: true },
      '2026-10-15': { cancelled: true },
      '2026-10-29': { cancelled: true },
    });
  });

  it('clamps an oversized DURATION instead of dropping the event', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:all',
      'DTSTART;VALUE=DATE:20261001',
      'DURATION:P99999999W',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:timed',
      'DTSTART:20261001T090000',
      'DURATION:P99999999W',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { events, warnings } = parseIcs(ics, { zone: 'UTC' });
    expect(warnings).toEqual([]);
    expect(events.map((e) => e.fields.when)).toEqual([
      { allDay: true, start: '2026-10-01', end: '2027-10-01' },
      { allDay: false, start: '2026-10-01T09:00', end: '2026-10-15T09:00', tz: 'UTC' },
    ]);
  });

  it('accepts WKST=MO and treats any other week start as unsupported', () => {
    const mo = oneEvent(
      'UID:mo',
      'DTSTART:20261001T090000Z',
      'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU,TH',
    );
    expect(parseIcs(mo, { zone: 'UTC' })).toEqual({
      events: [
        expect.objectContaining({
          fields: expect.objectContaining({ rule: { freq: 'weekly', interval: 1, byDay: [1, 3] } }),
        }),
      ],
      warnings: [],
    });
    const su = oneEvent(
      'UID:su',
      'DTSTART:20261001T090000Z',
      'RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU,TH',
    );
    const { events, warnings } = parseIcs(su, { zone: 'UTC' });
    expect(events[0]?.fields.rule).toBeUndefined();
    expect(warnings).toEqual([
      { line: 2, message: 'Repeat rule not supported; only the first date was imported' },
    ]);
  });

  it('escapes a UID with separators and line breaks on export', () => {
    const text = writeIcs({ events: [base({ uid: 'a;b,c\rd\ne' })] }, { name: 'x', now: NOW });
    expect(text).toContain('UID:a\\;b\\,c\\nd\\ne\r\n');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(parseIcs(text, { zone: 'UTC' }).events[0]?.uid).toBe('a;b,c\nd\ne');
  });

  it('leaves the uid unset for an event whose file has no UID, and keeps each one', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261001',
      'SUMMARY:One',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:',
      'DTSTART;VALUE=DATE:20261002',
      'SUMMARY:Two',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const { events, warnings } = parseIcs(ics, { zone: 'UTC' });
    expect(events.map((e) => [e.uid, e.fields.title])).toEqual([
      [undefined, 'One'],
      [undefined, 'Two'],
    ]);
    expect(warnings).toEqual([]);
  });
});
