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
