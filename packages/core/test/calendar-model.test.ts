import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  createUndo,
  EVENT_COLORS,
  getRoots,
  LOCAL_ORIGIN,
  MAX_EVENT_TITLE,
  readCalendar,
  readRule,
  readWhen,
  SESSION_ORIGIN,
} from '../src';

const page = (id: string, type: 'board' | 'sheet' | 'calendar') => ({
  type: 'CreatePage' as const,
  page: { id, type, title: 'Cal', order: 'a1', createdBy: 'u1', createdAt: 1 },
});

function calendarDoc() {
  const doc = new Y.Doc();
  applyCommand(doc, page('cal', 'calendar'), SESSION_ORIGIN);
  const events = getRoots(doc).calendars.get('cal')?.get('events');
  if (!(events instanceof Y.Map)) throw new Error('no events map');
  return { doc, events: events as Y.Map<unknown> };
}

function putEvent(events: Y.Map<unknown>, id: string, fields: Record<string, unknown>) {
  const m = new Y.Map<unknown>();
  events.set(id, m);
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  if (!m.has('exceptions')) m.set('exceptions', new Y.Map());
  if (!m.has('rsvp')) m.set('rsvp', new Y.Map());
  return m;
}

describe('calendar page lifecycle', () => {
  it('creates an empty calendar with a calendar page, and deletes it with the page', () => {
    const { doc } = calendarDoc();
    expect(readCalendar(getRoots(doc).calendars.get('cal'))).toEqual({ events: [] });
    applyCommand(doc, { type: 'DeletePage', id: 'cal' }, SESSION_ORIGIN);
    expect(getRoots(doc).calendars.has('cal')).toBe(false);
  });

  it('creates no calendar for other page types', () => {
    const doc = new Y.Doc();
    applyCommand(doc, page('b', 'board'), SESSION_ORIGIN);
    expect(getRoots(doc).calendars.size).toBe(0);
  });

  it('is tracked by the undo manager for LOCAL edits', () => {
    const { doc, events } = calendarDoc();
    const undo = createUndo(doc);
    doc.transact(() => {
      putEvent(events, 'e1', {
        title: 'Standup',
        color: EVENT_COLORS[0],
        when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      });
    }, LOCAL_ORIGIN);
    expect(readCalendar(getRoots(doc).calendars.get('cal'))?.events).toHaveLength(1);
    undo.undo();
    expect(readCalendar(getRoots(doc).calendars.get('cal'))?.events).toHaveLength(0);
  });
});

describe('reading untrusted calendar data', () => {
  it('normalizes whens', () => {
    expect(readWhen({ allDay: true, start: '2026-09-28', end: '2026-09-26' })).toEqual({
      allDay: true,
      start: '2026-09-28',
      end: '2026-09-28',
    });
    expect(readWhen({ allDay: true, start: '2026-01-01', end: '2028-01-01' })?.end).toBe(
      '2027-01-01',
    );
    expect(
      readWhen({ allDay: false, start: '2026-09-28T10:00', end: '2026-09-28T09:00', tz: 'X/Y' }),
    ).toEqual({ allDay: false, start: '2026-09-28T10:00', end: '2026-09-28T11:00', tz: 'UTC' });
    expect(
      readWhen({ allDay: false, start: '2026-09-01T10:00', end: '2026-10-30T10:00', tz: 'UTC' })
        ?.end,
    ).toBe('2026-09-15T10:00');
    expect(readWhen({ allDay: true, start: 'soon', end: '2026-09-28' })).toBeNull();
    expect(readWhen({ start: '2026-09-28' })).toBeNull();
    expect(readWhen('2026-09-28')).toBeNull();
  });

  it('clamps rules and drops unknown frequencies', () => {
    expect(
      readRule({ freq: 'weekly', interval: 500, byDay: [3, 1, 1, 9, 'x'], count: 5000 }),
    ).toEqual({ freq: 'weekly', interval: 99, byDay: [1, 3], count: 999 });
    expect(readRule({ freq: 'daily', byDay: [1] })).toEqual({ freq: 'daily', interval: 1 });
    expect(readRule({ freq: 'hourly', interval: 1 })).toBeUndefined();
    expect(readRule({ freq: 'monthly', interval: 2, until: 'never' })).toEqual({
      freq: 'monthly',
      interval: 2,
    });
  });

  it('reads events defensively: caps, defaults, invalid parts dropped', () => {
    const { doc, events } = calendarDoc();
    const m = putEvent(events, 'e1', {
      title: 'x'.repeat(500),
      notes: 42,
      color: 'url(evil)',
      when: { allDay: true, start: '2026-09-28', end: '2026-09-29' },
      rule: { freq: 'daily', interval: 1 },
      link: { pageId: 'main', shapeId: 's'.repeat(80) },
      uid: 'u'.repeat(300),
      createdBy: 'u1',
      createdAt: 'yesterday',
    });
    const ex = m.get('exceptions') as Y.Map<unknown>;
    ex.set('2026-09-30', { cancelled: true });
    ex.set('not-a-date', { cancelled: true });
    ex.set('2026-10-01', {
      when: { allDay: true, start: '2026-10-02', end: '2026-10-02' },
      title: 'Moved',
    });
    ex.set('2026-10-03', { title: 'no when' });
    const rsvp = m.get('rsvp') as Y.Map<unknown>;
    rsvp.set('u1', { status: 'yes', name: 'N'.repeat(99) });
    rsvp.set('u2', { status: 'perhaps', name: 'B' });
    putEvent(events, 'e0', { title: '', when: { allDay: false, start: 'bad', end: 'bad' } });
    putEvent(events, 'e2', {
      title: '   ',
      color: EVENT_COLORS[1],
      when: { allDay: true, start: '2026-09-01', end: '2026-09-01' },
    });

    const cal = readCalendar(getRoots(doc).calendars.get('cal'));
    expect(cal?.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    const [e1, e2] = cal?.events ?? [];
    expect(e1?.title).toHaveLength(MAX_EVENT_TITLE);
    expect(e1?.notes).toBe('');
    expect(e1?.color).toBe(EVENT_COLORS[0]);
    expect(e1?.link).toBeUndefined();
    expect(e1?.uid).toHaveLength(200);
    expect(e1?.createdAt).toBe(0);
    expect(Object.keys(e1?.exceptions ?? {})).toEqual(['2026-09-30', '2026-10-01']);
    expect(e1?.rsvp).toEqual({ u1: { status: 'yes', name: 'N'.repeat(40) } });
    expect(e2?.title).toBe('Untitled');
    expect(e2?.color).toBe(EVENT_COLORS[1]);
  });

  it('reads only the first 500 events by id, and a malformed calendar as null', () => {
    const { doc, events } = calendarDoc();
    doc.transact(() => {
      for (let i = 0; i < 520; i++) {
        putEvent(events, `e${String(i).padStart(3, '0')}`, {
          title: 'T',
          when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
        });
      }
    });
    const cal = readCalendar(getRoots(doc).calendars.get('cal'));
    expect(cal?.events).toHaveLength(500);
    expect(cal?.events.at(-1)?.id).toBe('e499');
    expect(readCalendar(new Y.Map())).toBeNull();
    expect(readCalendar('nope')).toBeNull();
  });
});
