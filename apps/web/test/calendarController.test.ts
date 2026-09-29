import { applyCommand, EVENT_COLORS, getRoots, readCalendar } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createCalendarController } from '../src/calendar/calendarController';
import { createActivityStore } from '../src/store/activityStore';
import { createCalendarStore } from '../src/store/calendarStore';
import { createDocStore } from '../src/store/docStore';

const ZONE = 'Europe/Madrid';
const NOW = Date.UTC(2026, 8, 28, 10, 0); // Monday 28 Sep 2026, 12:00 in Madrid

function setup(opts: { canEdit?: boolean } = {}) {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  const calendars = createCalendarStore(doc, docs.store);
  const page = board.createPage('calendar');
  board.setPage(page);
  const notify = vi.fn();
  let n = 0;
  const ctl = createCalendarController({
    calendar: calendars.store,
    commit: board.commit,
    commitSession: board.commitSession,
    canEdit: () => opts.canEdit ?? true,
    notify,
    user: { id: 'u1', name: 'Brisk Otter' },
    zone: ZONE,
    now: () => NOW,
    newId: () => `ev${++n}`,
  });
  const events = () => readCalendar(getRoots(doc).calendars.get(page))?.events ?? [];
  // Events written as if by a peer (no origin): this user's undo never touches them.
  const create = (id: string, fields: Record<string, unknown>) =>
    applyCommand(doc, {
      type: 'CreateEvent',
      pageId: page,
      id,
      fields: {
        title: 'T',
        color: EVENT_COLORS[0] as string,
        createdBy: 'u2',
        createdAt: 0,
        ...fields,
      } as never,
    });
  return { doc, page, board, ctl, notify, events, create };
}

describe('navigation', () => {
  it('starts on this month and steps by month or week', () => {
    const { ctl } = setup();
    expect(ctl.ui.getState()).toMatchObject({ view: 'month', anchor: '2026-09-28' });
    ctl.step(1);
    expect(ctl.ui.getState().anchor).toBe('2026-10-01');
    ctl.setView('week');
    ctl.step(-1);
    expect(ctl.ui.getState().anchor).toBe('2026-09-24');
    ctl.today();
    expect(ctl.ui.getState().anchor).toBe('2026-09-28');
  });
});

describe('creating and editing', () => {
  it('creates a timed event in the viewer zone from a week drag, as one undo step', () => {
    const { ctl, events, board } = setup();
    ctl.newEvent({ date: '2026-09-29', start: 9 * 60, end: 10 * 60 + 30 });
    const draft = ctl.ui.getState().editor?.draft;
    expect(draft).toMatchObject({
      allDay: false,
      startDate: '2026-09-29',
      startTime: '09:00',
      endTime: '10:30',
      title: '',
    });
    ctl.save({ ...(draft as NonNullable<typeof draft>), title: '  ' });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      id: 'ev1',
      title: 'Untitled',
      when: { allDay: false, start: '2026-09-29T09:00', end: '2026-09-29T10:30', tz: ZONE },
      createdBy: 'u1',
    });
    expect(ctl.ui.getState().editor).toBeNull();
    board.undo();
    expect(events()).toHaveLength(0);
  });

  it('creates an all-day event by default and a weekly rule from the draft', () => {
    const { ctl, events } = setup();
    ctl.newEvent({ date: '2026-10-05' });
    const draft = ctl.ui.getState().editor?.draft as NonNullable<
      ReturnType<typeof ctl.ui.getState>['editor']
    >['draft'];
    expect(draft).toMatchObject({ allDay: true, startDate: '2026-10-05', endDate: '2026-10-05' });
    ctl.save({
      ...draft,
      title: 'Retro',
      repeat: 'weekly',
      interval: 2,
      byDay: [0, 3],
      ends: 'after',
      count: 5,
    });
    expect(events()[0]).toMatchObject({
      when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
      rule: { freq: 'weekly', interval: 2, byDay: [0, 3], count: 5 },
    });
  });

  it('refuses invalid drafts and a full calendar', () => {
    const { ctl, events, notify, doc, page } = setup();
    ctl.newEvent({ date: '2026-09-29', start: 600, end: 660 });
    const draft = ctl.ui.getState().editor?.draft as NonNullable<
      ReturnType<typeof ctl.ui.getState>['editor']
    >['draft'];
    ctl.save({ ...draft, endTime: '09:00' });
    expect(notify).toHaveBeenLastCalledWith('The end is before the start');
    ctl.save({ ...draft, endTime: '10:05' });
    expect(notify).toHaveBeenLastCalledWith('An event lasts at least 15 minutes');
    expect(events()).toHaveLength(0);
    expect(ctl.ui.getState().editor).not.toBeNull();
    doc.transact(() => {
      for (let i = 0; i < 500; i++) {
        applyCommand(doc, {
          type: 'CreateEvent',
          pageId: page,
          id: `x${i}`,
          fields: {
            title: 'x',
            color: EVENT_COLORS[0] as string,
            when: { allDay: true, start: '2026-09-01', end: '2026-09-01' },
            createdBy: 'u',
            createdAt: 0,
          },
        });
      }
    });
    ctl.closeEditor();
    ctl.newEvent();
    expect(notify).toHaveBeenLastCalledWith('This calendar is full (500 events)');
    expect(ctl.ui.getState().editor).toBeNull();
  });

  it('opens events read-only for viewers, who cannot create, move or answer', () => {
    const { ctl, create, events } = setup({ canEdit: false });
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.newEvent();
    expect(ctl.ui.getState().editor).toBeNull();
    ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
    expect(ctl.ui.getState().editor?.readOnly).toBe(true);
    ctl.move({ eventId: 'a', key: '2026-09-28' }, { date: '2026-09-30' });
    ctl.rsvp('a', 'yes');
    expect(events()[0]?.when.start).toBe('2026-09-28');
    expect(events()[0]?.rsvp).toEqual({});
  });
});

describe('moving, resizing and deleting', () => {
  it('moves a single timed event to another day keeping its local time, and in week view to a new time', () => {
    const { ctl, create, events } = setup();
    create('a', {
      when: {
        allDay: false,
        start: '2026-09-28T09:00',
        end: '2026-09-28T10:00',
        tz: 'America/Havana',
      },
    });
    // 09:00 Havana is 15:00 in Madrid.
    ctl.move({ eventId: 'a', key: '2026-09-28' }, { date: '2026-10-01' });
    expect(events()[0]?.when).toEqual({
      allDay: false,
      start: '2026-10-01T09:00',
      end: '2026-10-01T10:00',
      tz: 'America/Havana',
    });
    ctl.move({ eventId: 'a', key: '2026-10-01' }, { date: '2026-10-02', minutes: 17 * 60 });
    expect(events()[0]?.when).toMatchObject({ start: '2026-10-02T11:00', end: '2026-10-02T12:00' });
  });

  it('asks about a series: "Only this event" writes an exception', () => {
    const { ctl, create, events } = setup();
    create('s', {
      when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE },
      rule: { freq: 'daily', interval: 1 },
    });
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-09-30', minutes: 11 * 60 });
    expect(ctl.ui.getState().question).toEqual({ action: 'move', drops: 0 });
    ctl.answer('one');
    expect(ctl.ui.getState().question).toBeNull();
    expect(events()[0]?.exceptions).toEqual({
      '2026-09-30': {
        when: { allDay: false, start: '2026-09-30T11:00', end: '2026-09-30T11:30', tz: ZONE },
      },
    });
  });

  it('"All events" shifts the whole series and clears its exceptions, reporting how many', () => {
    const { ctl, create, events } = setup();
    create('s', {
      when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE },
      rule: { freq: 'daily', interval: 1 },
    });
    ctl.remove({ eventId: 's', key: '2026-10-02' });
    ctl.answer('one');
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-10-01', minutes: 10 * 60 });
    expect(ctl.ui.getState().question).toEqual({ action: 'move', drops: 1 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      when: { start: '2026-09-29T10:00', end: '2026-09-29T10:30' },
      exceptions: {},
    });
  });

  it('resizes all events of a series without dropping exceptions, and cancels on no answer', () => {
    const { ctl, create, events } = setup();
    create('s', {
      when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE },
      rule: { freq: 'weekly', interval: 1 },
    });
    ctl.remove({ eventId: 's', key: '2026-10-05' });
    ctl.answer('one');
    ctl.resize({ eventId: 's', key: '2026-10-12' }, { date: '2026-10-12', minutes: 10 * 60 + 15 });
    ctl.answer(null);
    expect(events()[0]?.when.end).toBe('2026-09-28T09:30');
    ctl.resize({ eventId: 's', key: '2026-10-12' }, { date: '2026-10-12', minutes: 10 * 60 + 15 });
    ctl.answer('all');
    expect(events()[0]?.when.end).toBe('2026-09-28T10:15');
    expect(Object.keys(events()[0]?.exceptions ?? {})).toEqual(['2026-10-05']);
  });

  it('deletes a whole series, and closes the editor when its event disappears', () => {
    const { ctl, create, events, doc, page } = setup();
    create('s', {
      when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      rule: { freq: 'daily', interval: 1 },
    });
    ctl.remove({ eventId: 's', key: '2026-09-29' });
    ctl.answer('all');
    expect(events()).toHaveLength(0);
    create('t', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.openEditor({ eventId: 't', key: '2026-09-28' });
    ctl.select({ eventId: 't', key: '2026-09-28' });
    applyCommand(doc, { type: 'DeleteEvent', pageId: page, id: 't' });
    expect(ctl.ui.getState().editor).toBeNull();
    expect(ctl.ui.getState().selected).toBeNull();
  });
});

describe('RSVP and visible occurrences', () => {
  it('answers with the SESSION origin, so undo does not remove it', () => {
    const { ctl, create, events, board } = setup();
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.rsvp('a', 'maybe');
    expect(events()[0]?.rsvp).toEqual({ u1: { status: 'maybe', name: 'Brisk Otter' } });
    board.undo();
    expect(events()[0]?.rsvp).toEqual({ u1: { status: 'maybe', name: 'Brisk Otter' } });
    ctl.rsvp('a', null);
    expect(events()[0]?.rsvp).toEqual({});
  });

  it('lists the occurrences of the visible window', () => {
    const { ctl, create } = setup();
    create('s', {
      when: { allDay: true, start: '2026-09-01', end: '2026-09-01' },
      rule: { freq: 'weekly', interval: 1 },
    });
    expect(ctl.visible().occurrences.map((o) => o.key)).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
      '2026-10-06',
    ]);
    ctl.setView('week');
    expect(ctl.visible().occurrences.map((o) => o.key)).toEqual(['2026-09-29']);
  });
});
