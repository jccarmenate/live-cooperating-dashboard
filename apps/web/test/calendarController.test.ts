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

function setup(opts: { canEdit?: boolean; zone?: string } = {}) {
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
    zone: opts.zone ?? ZONE,
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

type Draft = NonNullable<
  ReturnType<ReturnType<typeof setup>['ctl']['ui']['getState']>['editor']
>['draft'];
const draftOf = (ctl: ReturnType<typeof setup>['ctl']): Draft =>
  ctl.ui.getState().editor?.draft as Draft;
const DAILY_9 = {
  when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE },
  rule: { freq: 'daily', interval: 1 },
};

describe('"All events" applies only what the user changed', () => {
  it('a title-only save on a moved occurrence keeps the series; moving it a day shifts the series a day', () => {
    const { ctl, create, events } = setup();
    create('s', DAILY_9);
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-10-02', minutes: 14 * 60 });
    ctl.answer('one');
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    expect(draftOf(ctl)).toMatchObject({ startDate: '2026-10-02', startTime: '14:00' });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Renamed', when: DAILY_9.when });
    expect(Object.keys(events()[0]?.exceptions ?? {})).toEqual(['2026-09-30']);
    expect(ctl.ui.getState().editor).toBeNull();
    // Month view: 2 Oct 14:00 → 3 Oct 14:00, one day.
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-10-03' });
    expect(ctl.ui.getState().question).toEqual({ action: 'move', drops: 1 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      when: { start: '2026-09-29T09:00', end: '2026-09-29T09:30' },
      exceptions: {},
    });
  });

  it('keeps real-time durations across a DST change', () => {
    const { ctl, create, events } = setup();
    const when = { allDay: false, start: '2026-09-28T22:00', end: '2026-09-29T06:00', tz: ZONE };
    create('s', { when, rule: { freq: 'daily', interval: 1 } });
    // Madrid falls back on 25 Oct 2026: 8 h from 24 Oct 22:00 CEST end at 05:00 CET.
    ctl.openEditor({ eventId: 's', key: '2026-10-24' });
    expect(draftOf(ctl)).toMatchObject({
      startDate: '2026-10-24',
      startTime: '22:00',
      endDate: '2026-10-25',
      endTime: '05:00',
    });
    ctl.save({ ...draftOf(ctl), title: 'Night shift' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Night shift', when });
  });

  it('asks on save: "Only this event" writes an exception, "All events" with a new time clears', () => {
    const { ctl, create, events } = setup();
    create('s', DAILY_9);
    ctl.remove({ eventId: 's', key: '2026-10-02' });
    ctl.answer('one');
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), title: 'Focus' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('one');
    expect(ctl.ui.getState().editor).toBeNull();
    expect(events()[0]?.title).toBe('T');
    expect(events()[0]?.exceptions['2026-09-30']).toMatchObject({
      when: { allDay: false, start: '2026-09-30T09:00', end: '2026-09-30T09:30', tz: ZONE },
      title: 'Focus',
    });
    ctl.openEditor({ eventId: 's', key: '2026-10-01' });
    ctl.save({ ...draftOf(ctl), startTime: '10:00', endTime: '10:45' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 2 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      when: { allDay: false, start: '2026-09-28T10:00', end: '2026-09-28T10:45', tz: ZONE },
      exceptions: {},
    });
  });

  it('a rule change asks for all events only', () => {
    const { ctl, create, events } = setup();
    create('s', DAILY_9);
    ctl.openEditor({ eventId: 's', key: '2026-10-01' });
    ctl.save({ ...draftOf(ctl), repeat: 'weekly' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0, allOnly: true });
    ctl.answer('one');
    expect(ctl.ui.getState().question).not.toBeNull();
    expect(events()[0]?.exceptions).toEqual({});
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      rule: { freq: 'weekly', interval: 1 },
      when: DAILY_9.when,
    });
  });

  it('a stored rule with both count and until is unchanged by a title-only save', () => {
    const { ctl, create, events } = setup();
    const rule = { freq: 'daily', interval: 1, count: 5, until: '2026-12-31' };
    create('s', { ...DAILY_9, rule });
    ctl.remove({ eventId: 's', key: '2026-09-30' });
    ctl.answer('one');
    ctl.openEditor({ eventId: 's', key: '2026-09-29' });
    ctl.save({ ...draftOf(ctl), title: 'Kept' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Kept', rule, when: DAILY_9.when });
    expect(Object.keys(events()[0]?.exceptions ?? {})).toEqual(['2026-09-30']);
  });

  it('toggles a series between all-day and timed', () => {
    const { ctl, create, events } = setup();
    create('a', {
      when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      rule: { freq: 'daily', interval: 1 },
    });
    ctl.openEditor({ eventId: 'a', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), allDay: false, startTime: '10:00', endTime: '11:00' });
    ctl.answer('all');
    expect(events()[0]?.when).toEqual({
      allDay: false,
      start: '2026-09-28T10:00',
      end: '2026-09-28T11:00',
      tz: ZONE,
    });
    create('t', DAILY_9);
    ctl.openEditor({ eventId: 't', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), allDay: true });
    ctl.answer('all');
    expect(events()[1]?.when).toEqual({ allDay: true, start: '2026-09-28', end: '2026-09-28' });
  });

  it('edits a series in another zone through the viewer zone', () => {
    const { ctl, create, events } = setup();
    const when = {
      allDay: false,
      start: '2026-09-28T09:00',
      end: '2026-09-28T10:00',
      tz: 'America/Havana',
    };
    create('h', { when, rule: { freq: 'daily', interval: 1 } });
    ctl.openEditor({ eventId: 'h', key: '2026-09-30' });
    expect(draftOf(ctl)).toMatchObject({ startTime: '15:00', endTime: '16:00' });
    ctl.save({ ...draftOf(ctl), title: 'Sync' });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Sync', when });
    ctl.openEditor({ eventId: 'h', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), startTime: '16:00', endTime: '17:00' });
    ctl.answer('all');
    expect(events()[0]?.when).toEqual({
      ...when,
      start: '2026-09-28T10:00',
      end: '2026-09-28T11:00',
    });
  });
});

describe('limits and edge cases', () => {
  it('refuses "Only this event" past the exception cap', () => {
    const { ctl, create, events, notify, doc, page } = setup();
    create('s', DAILY_9);
    doc.transact(() => {
      for (let i = 0; i < 200; i++) {
        const key = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
        applyCommand(doc, {
          type: 'SetOccurrence',
          pageId: page,
          id: 's',
          key,
          value: { cancelled: true },
        });
      }
    });
    ctl.move({ eventId: 's', key: '2026-09-28' }, { date: '2026-09-28', minutes: 11 * 60 });
    ctl.answer('one');
    expect(notify).toHaveBeenLastCalledWith('Too many changes to this series');
    expect(Object.keys(events()[0]?.exceptions ?? {})).toHaveLength(200);
    expect(events()[0]?.exceptions['2026-09-28']).toBeUndefined();
  });

  it('caps timed events at 14 days and all-day events at 366 days', () => {
    const { ctl, events, notify } = setup();
    ctl.newEvent({ date: '2026-09-29', start: 600, end: 660 });
    ctl.save({ ...draftOf(ctl), endDate: '2026-10-13', endTime: '10:15' });
    expect(notify).toHaveBeenLastCalledWith('An event can last at most 14 days');
    ctl.save({ ...draftOf(ctl), endDate: '2026-10-13', endTime: '10:00' });
    expect(events()).toHaveLength(1);
    ctl.newEvent({ date: '2026-09-29' });
    ctl.save({ ...draftOf(ctl), endDate: '2027-09-30' });
    expect(notify).toHaveBeenLastCalledWith('An all-day event can last at most 366 days');
    ctl.save({ ...draftOf(ctl), endDate: '2027-09-29' });
    expect(events()).toHaveLength(2);
  });

  it('ends a new event on the next day when it crosses midnight', () => {
    const { ctl, events } = setup();
    ctl.newEvent({ date: '2026-09-29', start: 23 * 60 });
    expect(draftOf(ctl)).toMatchObject({
      startDate: '2026-09-29',
      startTime: '23:00',
      endDate: '2026-09-30',
      endTime: '00:00',
    });
    ctl.newEvent({ date: '2026-09-29', start: 23 * 60 + 45 });
    expect(draftOf(ctl)).toMatchObject({ endDate: '2026-09-30', endTime: '00:45' });
    ctl.save(draftOf(ctl));
    expect(events()[0]?.when).toEqual({
      allDay: false,
      start: '2026-09-29T23:45',
      end: '2026-09-30T00:45',
      tz: ZONE,
    });
  });

  it('re-checks the event cap on save and keeps the editor open', () => {
    const { ctl, events, notify, doc, page } = setup();
    ctl.newEvent({ date: '2026-09-29' });
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
    ctl.save(draftOf(ctl));
    expect(notify).toHaveBeenLastCalledWith('This calendar is full (500 events)');
    expect(ctl.ui.getState().editor).not.toBeNull();
    expect(events()).toHaveLength(500);
  });

  it('drops a question whose event disappears, and re-checks the role on answer', () => {
    const role = { canEdit: true };
    const { ctl, create, events, doc, page } = setup(role);
    create('s', DAILY_9);
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-09-30', minutes: 11 * 60 });
    applyCommand(doc, { type: 'DeleteEvent', pageId: page, id: 's' });
    expect(ctl.ui.getState().question).toBeNull();
    create('t', DAILY_9);
    ctl.move({ eventId: 't', key: '2026-09-30' }, { date: '2026-09-30', minutes: 11 * 60 });
    role.canEdit = false;
    ctl.answer('one');
    expect(ctl.ui.getState().question).toBeNull();
    expect(events()[0]?.exceptions).toEqual({});
  });

  it('moves a timed event in month view by its own wall time, across differing DST dates', () => {
    const { ctl, create, events } = setup();
    // Madrid falls back on 25 Oct, Havana on 1 Nov: 09:00 Havana is 15:00 in Madrid on
    // 20 Oct but 14:00 on 27 Oct.
    create('a', {
      when: {
        allDay: false,
        start: '2026-10-20T09:00',
        end: '2026-10-20T10:00',
        tz: 'America/Havana',
      },
    });
    ctl.move({ eventId: 'a', key: '2026-10-20' }, { date: '2026-10-27' });
    expect(events()[0]?.when).toMatchObject({ start: '2026-10-27T09:00', end: '2026-10-27T10:00' });
  });

  it('resizes a timed exception of an all-day series without asking', () => {
    const { ctl, create, events } = setup();
    create('a', {
      when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      rule: { freq: 'daily', interval: 1 },
    });
    ctl.openEditor({ eventId: 'a', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), allDay: false, startTime: '10:00', endTime: '11:00' });
    ctl.answer('one');
    ctl.resize({ eventId: 'a', key: '2026-09-30' }, { date: '2026-09-30', minutes: 11 * 60 + 30 });
    expect(ctl.ui.getState().question).toBeNull();
    expect(events()[0]?.exceptions['2026-09-30']).toMatchObject({
      when: { allDay: false, start: '2026-09-30T10:00', end: '2026-09-30T11:30', tz: ZONE },
    });
    expect(events()[0]?.when).toEqual({ allDay: true, start: '2026-09-28', end: '2026-09-28' });
  });
});

describe('changes are measured against the draft the editor opened with', () => {
  const ALL_DAY_DAILY = {
    when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
    rule: { freq: 'daily', interval: 1 },
  };

  it('a title-only "All events" save on another zone\'s timed exception keeps the series', () => {
    const { ctl, create, events, doc, page } = setup();
    create('a', ALL_DAY_DAILY);
    // Made "only this" by a Havana user: 20:00 Havana is 02:00 the next day in Madrid.
    const havana = {
      allDay: false,
      start: '2026-09-30T20:00',
      end: '2026-09-30T21:00',
      tz: 'America/Havana',
    } as const;
    applyCommand(doc, {
      type: 'SetOccurrence',
      pageId: page,
      id: 'a',
      key: '2026-09-30',
      value: { when: havana },
    });
    applyCommand(doc, {
      type: 'SetOccurrence',
      pageId: page,
      id: 'a',
      key: '2026-10-02',
      value: { cancelled: true },
    });
    ctl.openEditor({ eventId: 'a', key: '2026-09-30' });
    expect(draftOf(ctl)).toMatchObject({ startDate: '2026-10-01', startTime: '02:00' });
    ctl.save({ ...draftOf(ctl), title: 'Holiday' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Holiday', when: ALL_DAY_DAILY.when });
    expect(events()[0]?.exceptions).toEqual({
      '2026-09-30': { when: havana },
      '2026-10-02': { cancelled: true },
    });
  });

  it('a title-only save on an occurrence whose end is an ambiguous fall-back time, seen from another zone', () => {
    const { ctl, create, events, notify } = setup({ zone: 'America/Havana' });
    // 25 Oct: 02:00 CEST + 1 h ends at 02:00 CET, which reads back as the earlier 02:00.
    const when = { allDay: false, start: '2026-09-28T02:00', end: '2026-09-28T03:00', tz: ZONE };
    create('s', { when, rule: { freq: 'daily', interval: 1 } });
    ctl.openEditor({ eventId: 's', key: '2026-10-25' });
    ctl.save({ ...draftOf(ctl), title: 'Backup' });
    expect(notify).not.toHaveBeenCalled();
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Backup', when, exceptions: {} });
  });

  it('"Only this event" overrides only the fields that differ from the series', () => {
    const { ctl, create, events } = setup();
    create('s', DAILY_9);
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), title: 'Focus' });
    ctl.answer('one');
    expect(events()[0]?.exceptions['2026-09-30']).toEqual({
      when: { allDay: false, start: '2026-09-30T09:00', end: '2026-09-30T09:30', tz: ZONE },
      title: 'Focus',
    });
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    expect(draftOf(ctl).title).toBe('Focus');
    ctl.save({ ...draftOf(ctl), title: 'T', color: EVENT_COLORS[2] as string });
    ctl.answer('one');
    expect(events()[0]?.exceptions['2026-09-30']).toEqual({
      when: { allDay: false, start: '2026-09-30T09:00', end: '2026-09-30T09:30', tz: ZONE },
      color: EVENT_COLORS[2],
    });
  });

  it('"All events" patches only the text fields the user changed', () => {
    const { ctl, create, events } = setup();
    create('s', DAILY_9);
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), title: 'Focus' });
    ctl.answer('one');
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), color: EVENT_COLORS[1] as string });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'T', color: EVENT_COLORS[1], when: DAILY_9.when });
    expect(events()[0]?.exceptions['2026-09-30']).toMatchObject({ title: 'Focus' });
  });

  it('keeps a base start that falls in a DST gap', () => {
    const { ctl, create, events } = setup();
    // Madrid springs forward on 29 Mar 2026: 02:30 does not exist that day.
    create('s', {
      when: { allDay: false, start: '2026-03-28T02:30', end: '2026-03-28T03:00', tz: ZONE },
      rule: { freq: 'daily', interval: 1 },
    });
    ctl.move({ eventId: 's', key: '2026-03-28' }, { date: '2026-03-29' });
    ctl.answer('all');
    expect(events()[0]?.when.start).toBe('2026-03-29T02:30');
  });

  it('turns weekly days with the series when "All events" moves it', () => {
    const { ctl, create, events } = setup();
    create('s', { ...DAILY_9, rule: { freq: 'weekly', interval: 1, byDay: [0, 2] } });
    // Drag Wednesday 30 Sep to Thursday 1 Oct.
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-10-01' });
    expect(ctl.ui.getState().question).toEqual({ action: 'move', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      when: { start: '2026-09-29T09:00', end: '2026-09-29T09:30' },
      rule: { freq: 'weekly', interval: 1, byDay: [1, 3] },
    });
    ctl.setView('week');
    expect(ctl.visible().occurrences.map((o) => o.key)).toEqual(['2026-09-29', '2026-10-01']);
  });
});
