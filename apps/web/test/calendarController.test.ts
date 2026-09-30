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

function setup(opts: { canEdit?: boolean; zone?: string; refuseCommits?: boolean } = {}) {
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
    commit: opts.refuseCommits ? () => false : board.commit,
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

/** Brings two replicas up to date with each other. */
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe('merge-safe saves', () => {
  for (const [label, peerId] of [
    ['lower', 1],
    ['higher', 2 ** 31],
  ] as const) {
    it(`a single-event save writes only what changed, so a peer's rename survives (${label} peer id)`, () => {
      const { ctl, create, doc, page, events } = setup();
      create('a', {
        title: 'Old',
        notes: 'n',
        when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T10:00', tz: ZONE },
      });
      const peer = new Y.Doc();
      peer.clientID = peerId;
      sync(doc, peer);
      ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
      applyCommand(peer, {
        type: 'UpdateEvent',
        pageId: page,
        id: 'a',
        patch: {
          title: 'Renamed',
          when: { allDay: false, start: '2026-09-28T11:00', end: '2026-09-28T12:00', tz: ZONE },
        },
      });
      ctl.save({ ...draftOf(ctl), color: EVENT_COLORS[3] as string });
      expect(ctl.ui.getState().editor).toBeNull();
      sync(doc, peer);
      const expected = {
        title: 'Renamed',
        notes: 'n',
        color: EVENT_COLORS[3],
        when: { start: '2026-09-28T11:00', end: '2026-09-28T12:00' },
      };
      expect(events()[0]).toMatchObject(expected);
      expect(readCalendar(getRoots(peer).calendars.get(page))?.events[0]).toMatchObject(expected);
    });
  }

  it('a single-event save writes the timing and the rule only when they were edited', () => {
    const { ctl, create, events, doc } = setup();
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    let updates = 0;
    doc.on('update', () => updates++);
    ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
    ctl.save(draftOf(ctl));
    expect(ctl.ui.getState().editor).toBeNull();
    expect(updates).toBe(0);
    ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
    ctl.save({ ...draftOf(ctl), endDate: '2026-09-29', repeat: 'weekly' });
    expect(events()[0]).toMatchObject({
      when: { allDay: true, start: '2026-09-28', end: '2026-09-29' },
      rule: { freq: 'weekly', interval: 1 },
    });
  });

  it("keeps a peer's removal of the rule when the user left the repeat alone", () => {
    const { ctl, create, events, doc, page } = setup();
    create('a', {
      when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      rule: { freq: 'weekly', interval: 1 },
    });
    ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
    applyCommand(doc, { type: 'UpdateEvent', pageId: page, id: 'a', patch: { rule: null } });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    expect(ctl.ui.getState().editor).toBeNull();
    expect(events()[0]).toMatchObject({ title: 'Renamed' });
    expect(events()[0]?.rule).toBeUndefined();
  });

  it('keeps a rule a peer added to a single event while it was open (title-only save)', () => {
    const { ctl, create, events, doc, page } = setup();
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
    applyCommand(doc, {
      type: 'UpdateEvent',
      pageId: page,
      id: 'a',
      patch: { rule: { freq: 'weekly', interval: 1 } },
    });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    // Now a series, but the user did not touch the repeat: both scopes are offered.
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(ctl.ui.getState().editor).toBeNull();
    expect(events()[0]).toMatchObject({
      title: 'Renamed',
      when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      rule: { freq: 'weekly', interval: 1 },
    });
  });

  it("keeps a peer's change to a series' interval and days (title-only save)", () => {
    const { ctl, create, events, doc, page } = setup();
    const when = {
      allDay: false,
      start: '2026-09-28T09:00',
      end: '2026-09-28T09:30',
      tz: ZONE,
    } as const;
    create('s', { when, rule: { freq: 'weekly', interval: 1, byDay: [0] } });
    applyCommand(doc, {
      type: 'SetOccurrence',
      pageId: page,
      id: 's',
      key: '2026-10-12',
      value: { cancelled: true },
    });
    ctl.openEditor({ eventId: 's', key: '2026-09-28' });
    const peerRule = { freq: 'weekly', interval: 2, byDay: [0, 2] } as const;
    applyCommand(doc, {
      type: 'UpdateEvent',
      pageId: page,
      id: 's',
      patch: { rule: { ...peerRule, byDay: [...peerRule.byDay] } },
    });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({ title: 'Renamed', when, rule: peerRule });
    expect(Object.keys(events()[0]?.exceptions ?? {})).toEqual(['2026-10-12']);
  });
});

describe('the selection follows its occurrence', () => {
  const WEEKLY_MON = {
    when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE },
    rule: { freq: 'weekly', interval: 1 },
  };

  it('drops the selection, the editor and its question when a peer shifts the series off that date', () => {
    const { ctl, create, doc, page, events } = setup();
    create('s', WEEKLY_MON);
    ctl.openEditor({ eventId: 's', key: '2026-10-05' });
    expect(ctl.ui.getState().selected).toEqual({ eventId: 's', key: '2026-10-05' });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    expect(ctl.ui.getState().question).not.toBeNull();
    applyCommand(doc, {
      type: 'UpdateEvent',
      pageId: page,
      id: 's',
      patch: { when: { ...WEEKLY_MON.when, start: '2026-09-29T09:00', end: '2026-09-29T09:30' } },
    });
    expect(ctl.ui.getState().selected).toBeNull();
    expect(ctl.ui.getState().editor).toBeNull();
    expect(ctl.ui.getState().question).toBeNull();
    ctl.answer('one');
    expect(events()[0]?.exceptions).toEqual({});
  });

  it('drops an open series question when a peer removes the rule', () => {
    const { ctl, create, doc, page, events } = setup();
    // On a later occurrence: its ref is re-keyed to the now single event's day.
    create('s', WEEKLY_MON);
    ctl.openEditor({ eventId: 's', key: '2026-10-05' });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    expect(ctl.ui.getState().question).not.toBeNull();
    applyCommand(doc, { type: 'UpdateEvent', pageId: page, id: 's', patch: { rule: null } });
    expect(ctl.ui.getState().question).toBeNull();
    expect(ctl.ui.getState().editor?.ref).toEqual({ eventId: 's', key: '2026-09-28' });
    ctl.answer('one');
    expect(events()[0]).toMatchObject({ title: 'T', exceptions: {} });
    // On the first occurrence: the ref keeps its key, but the question is about a series.
    create('t', WEEKLY_MON);
    ctl.openEditor({ eventId: 't', key: '2026-09-28' });
    ctl.save({ ...draftOf(ctl), title: 'Renamed' });
    expect(ctl.ui.getState().question).not.toBeNull();
    applyCommand(doc, { type: 'UpdateEvent', pageId: page, id: 't', patch: { rule: null } });
    expect(ctl.ui.getState().question).toBeNull();
    ctl.answer('all');
    expect(events().find((e) => e.id === 't')).toMatchObject({ title: 'T' });
  });

  it('drops the selection when a peer cancels that occurrence, and keeps it for a moved one', () => {
    const { ctl, create, doc, page } = setup();
    create('s', WEEKLY_MON);
    ctl.select({ eventId: 's', key: '2026-10-05' });
    const moved = {
      when: { ...WEEKLY_MON.when, start: '2026-10-06T09:00', end: '2026-10-06T09:30' },
    };
    applyCommand(doc, {
      type: 'SetOccurrence',
      pageId: page,
      id: 's',
      key: '2026-10-05',
      value: moved,
    });
    expect(ctl.ui.getState().selected).toEqual({ eventId: 's', key: '2026-10-05' });
    applyCommand(doc, {
      type: 'SetOccurrence',
      pageId: page,
      id: 's',
      key: '2026-10-05',
      value: { cancelled: true },
    });
    expect(ctl.ui.getState().selected).toBeNull();
  });

  it('re-keys the selection after an "All events" day shift', () => {
    const { ctl, create, events } = setup();
    create('s', WEEKLY_MON);
    ctl.select({ eventId: 's', key: '2026-10-05' });
    ctl.move({ eventId: 's', key: '2026-10-05' }, { date: '2026-10-06' });
    ctl.answer('all');
    expect(events().find((e) => e.id === 's')?.when.start).toBe('2026-09-29T09:00');
    expect(ctl.ui.getState().selected).toEqual({ eventId: 's', key: '2026-10-06' });
    // A daily series: the old date is still an occurrence, but the selection follows the moved one.
    create('d', DAILY_9);
    ctl.openEditor({ eventId: 'd', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), startDate: '2026-10-02', endDate: '2026-10-02' });
    ctl.answer('all');
    expect(events().find((e) => e.id === 'd')?.when.start).toBe('2026-09-30T09:00');
    expect(ctl.ui.getState().selected).toEqual({ eventId: 'd', key: '2026-10-02' });
  });

  it('re-keys the selection and the editor when a single event changes day', () => {
    const { ctl, create, doc, page } = setup();
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.select({ eventId: 'a', key: '2026-09-28' });
    ctl.move({ eventId: 'a', key: '2026-09-28' }, { date: '2026-10-01' });
    expect(ctl.ui.getState().selected).toEqual({ eventId: 'a', key: '2026-10-01' });
    ctl.openEditor({ eventId: 'a', key: '2026-10-01' });
    applyCommand(doc, {
      type: 'UpdateEvent',
      pageId: page,
      id: 'a',
      patch: { when: { allDay: true, start: '2026-10-02', end: '2026-10-02' } },
    });
    expect(ctl.ui.getState().selected).toEqual({ eventId: 'a', key: '2026-10-02' });
    expect(ctl.ui.getState().editor?.ref).toEqual({ eventId: 'a', key: '2026-10-02' });
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

  it("measures a timing edit of another zone's timed exception in that zone (all-day series)", () => {
    const { ctl, create, events, doc, page } = setup();
    create('a', ALL_DAY_DAILY);
    // 20:00 Havana on 30 Sep is 02:00 on 1 Oct in Madrid.
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
    ctl.openEditor({ eventId: 'a', key: '2026-09-30' });
    expect(draftOf(ctl)).toMatchObject({ startDate: '2026-10-01', startTime: '02:00' });
    ctl.save({ ...draftOf(ctl), startTime: '03:00', endTime: '04:00' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 1 });
    ctl.answer('all');
    // Same day in Havana: the all-day series does not move.
    expect(events()[0]).toMatchObject({ when: ALL_DAY_DAILY.when, exceptions: {} });
  });

  it('turns untouched weekly days with a moved start even when the interval changed', () => {
    const { ctl, create, events } = setup();
    create('s', { ...DAILY_9, rule: { freq: 'weekly', interval: 1, byDay: [0, 2] } });
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), interval: 2, startDate: '2026-10-01', endDate: '2026-10-01' });
    expect(ctl.ui.getState().question).toMatchObject({ allOnly: true });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      when: { start: '2026-09-29T09:00', end: '2026-09-29T09:30' },
      rule: { freq: 'weekly', interval: 2, byDay: [1, 3] },
    });
  });

  it('"Only this event" writes nothing without changes, and clears an exception set back to the series', () => {
    const { ctl, create, events, doc, board } = setup();
    create('s', DAILY_9);
    let updates = 0;
    doc.on('update', () => updates++);
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save(draftOf(ctl));
    ctl.answer('one');
    expect(updates).toBe(0);
    expect(ctl.ui.getState().editor).toBeNull();
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), title: 'Focus', startTime: '14:00', endTime: '14:30' });
    ctl.answer('one');
    expect(Object.keys(events()[0]?.exceptions ?? {})).toEqual(['2026-09-30']);
    ctl.openEditor({ eventId: 's', key: '2026-09-30' });
    ctl.save({ ...draftOf(ctl), title: 'T', startTime: '09:00', endTime: '09:30' });
    ctl.answer('one');
    expect(events()[0]?.exceptions).toEqual({});
    board.undo();
    expect(events()[0]?.exceptions['2026-09-30']).toMatchObject({ title: 'Focus' });
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

describe('.ics', () => {
  const ICS = (uids: string[]) =>
    [
      'BEGIN:VCALENDAR',
      ...uids.flatMap((u, i) => [
        'BEGIN:VEVENT',
        `UID:${u}`,
        `DTSTART;VALUE=DATE:2026100${i + 1}`,
        `SUMMARY:${u}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ].join('\r\n');

  it('imports as one undo step, skips events already in the calendar and reports warnings', () => {
    const { ctl, events, board } = setup();
    const first = ctl.importIcs(ICS(['a@x', 'b@x']));
    expect(first).toEqual({ imported: 2, skipped: 0, warnings: [] });
    expect(
      events()
        .map((e) => e.uid)
        .sort(),
    ).toEqual(['a@x', 'b@x']);
    const again = ctl.importIcs(`${ICS(['a@x', 'c@x'])}\r\nBEGIN:VEVENT\r\nUID:bad\r\nEND:VEVENT`);
    expect(again?.imported).toBe(1);
    expect(again?.skipped).toBe(1);
    expect(again?.warnings.map((w) => w.message)).toEqual(['Event without a valid start; skipped']);
    board.undo();
    expect(
      events()
        .map((e) => e.uid)
        .sort(),
    ).toEqual(['a@x', 'b@x']);
  });

  it('refuses a file over 1 MB, an import past the event cap, and an import over the byte budget', () => {
    const { ctl, notify, events } = setup();
    expect(ctl.importIcs('x'.repeat(1024 * 1024 + 1))).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('This file is larger than 1 MB');
    const many = Array.from({ length: 501 }, (_, i) => `u${i}@x`);
    expect(
      ctl.importIcs(ICS(many).replace(/DTSTART;VALUE=DATE:\d+/g, 'DTSTART;VALUE=DATE:20261001')),
    ).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('This calendar is full (500 events)');
    const heavy = Array.from({ length: 150 }, (_, i) =>
      [
        'BEGIN:VEVENT',
        `UID:h${i}`,
        'DTSTART;VALUE=DATE:20261001',
        `DESCRIPTION:${'z'.repeat(1900)}`,
        'END:VEVENT',
      ].join('\r\n'),
    ).join('\r\n');
    expect(ctl.importIcs(`BEGIN:VCALENDAR\r\n${heavy}\r\nEND:VCALENDAR`)).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('This file is too large to import at once');
    expect(events()).toHaveLength(0);
  });

  it('never dedupes events without a UID, and stores no uid for them', () => {
    const { ctl, events } = setup();
    const noUid = (title: string) =>
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20261001',
        `SUMMARY:${title}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
    expect(ctl.importIcs(noUid('First'))).toMatchObject({ imported: 1, skipped: 0 });
    expect(ctl.importIcs(noUid('Second'))).toMatchObject({ imported: 1, skipped: 0 });
    expect(
      events()
        .map((e) => [e.title, e.uid])
        .sort(),
    ).toEqual([
      ['First', undefined],
      ['Second', undefined],
    ]);
  });

  it('accepts an import that fills the calendar to exactly 500 events', () => {
    const { ctl, events } = setup();
    const many = Array.from({ length: 500 }, (_, i) => `u${i}@x`);
    const text = ICS(many).replace(/DTSTART;VALUE=DATE:\d+/g, 'DTSTART;VALUE=DATE:20261001');
    expect(ctl.importIcs(text)).toMatchObject({ imported: 500, skipped: 0 });
    expect(events()).toHaveLength(500);
  });

  it('refuses an import meant for another page, and says so when the commit is refused', () => {
    const { ctl, events, page } = setup();
    expect(ctl.importIcs(ICS(['a@x']), 'other-page')).toBeNull();
    expect(events()).toHaveLength(0);
    expect(ctl.importIcs(ICS(['a@x']), page)).toMatchObject({ imported: 1 });
    const refused = setup({ refuseCommits: true });
    expect(refused.ctl.importIcs(ICS(['a@x']))).toBeNull();
    expect(refused.notify).toHaveBeenLastCalledWith('Could not import right now');
  });

  it('exports what it can re-import', () => {
    const { ctl, create } = setup();
    create('a', { title: 'Trip', when: { allDay: true, start: '2026-10-01', end: '2026-10-03' } });
    const text = ctl.exportIcs('Team') ?? '';
    expect(text).toContain('SUMMARY:Trip');
    expect(text).toContain('X-WR-CALNAME:Team');
  });
});
