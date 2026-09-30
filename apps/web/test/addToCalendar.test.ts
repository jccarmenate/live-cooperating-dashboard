import { applyCommand, getRoots, readCalendar } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';
import { addToCalendarWhen } from '../src/ui/addToCalendarWhen';
import { stickyTitle } from '../src/ui/stickyTitle';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const notify = vi.fn();
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
    notify,
  });
  applyCommand(doc, {
    type: 'CreateShape',
    shape: {
      id: 's1',
      type: 'sticky',
      x: 0,
      y: 0,
      w: 180,
      h: 140,
      style: { fill: '#F5D547', stroke: '#111111', font: 'sans' },
      createdBy: 'u1',
      authorName: 'B',
      createdAt: 0,
    },
  });
  const events = (page: string) => readCalendar(getRoots(doc).calendars.get(page))?.events ?? [];
  return { doc, docs, board, notify, events };
}

describe('Add to calendar', () => {
  it('derives the title from the first non-empty line of the sticky', () => {
    expect(stickyTitle('\n  Plan the retro  \nsecond line')).toBe('Plan the retro');
    expect(stickyTitle('   ')).toBe('Untitled');
    expect(stickyTitle(undefined)).toBe('Untitled');
    expect(stickyTitle('x'.repeat(200))).toHaveLength(120);
  });

  it('creates a linked event on an existing calendar, as one undo step, and says where', () => {
    const { board, notify, events, docs } = setup();
    const cal = board.createPage('calendar');
    const when = { allDay: true as const, start: '2026-10-01', end: '2026-10-01' };
    expect(board.addStickyToCalendar({ pageId: cal, shapeId: 's1', title: 'Retro', when })).toBe(
      cal,
    );
    expect(events(cal)).toMatchObject([
      { title: 'Retro', when, link: { pageId: 'main', shapeId: 's1' } },
    ]);
    const title = docs.store.getState().pages.find((p) => p.id === cal)?.title;
    expect(notify).toHaveBeenLastCalledWith(`Added to ${title}`);
    expect(docs.store.getState().activePage).toBe('main');
    board.undo();
    expect(events(cal)).toHaveLength(0);
    // The step changed only the calendar, which is not on screen: the toast says so.
    expect(notify).toHaveBeenLastCalledWith('Undone (calendar event)');
    board.redo();
    expect(notify).toHaveBeenLastCalledWith('Redone (calendar event)');
    // On the calendar page itself, a plain "Undone".
    board.setPage(cal);
    board.commit({
      type: 'CreateEvent',
      pageId: cal,
      id: 'e2',
      fields: { title: 'X', color: '#3B3BF5', when, createdBy: 'u1', createdAt: 0 },
    });
    board.undo();
    expect(notify).toHaveBeenLastCalledWith('Undone');
  });

  it('creates a new calendar page when asked, and refuses a missing sticky', () => {
    const { board, events, docs } = setup();
    const when = { allDay: true as const, start: '2026-10-01', end: '2026-10-01' };
    const page = board.addStickyToCalendar({ pageId: null, shapeId: 's1', title: 'X', when });
    expect(page).not.toBeNull();
    expect(docs.store.getState().pages.find((p) => p.id === page)?.type).toBe('calendar');
    expect(events(page as string)).toHaveLength(1);
    expect(
      board.addStickyToCalendar({ pageId: page, shapeId: 'ghost', title: 'X', when }),
    ).toBeNull();
  });

  it('makes an end at or before the start one hour long, rolling into the next day', () => {
    const Z = 'Europe/Madrid';
    expect(addToCalendarWhen('2026-10-01', true, '14:00', '14:00', Z)).toEqual({
      allDay: true,
      start: '2026-10-01',
      end: '2026-10-01',
    });
    expect(addToCalendarWhen('2026-10-01', false, '14:00', '15:30', Z)).toEqual({
      allDay: false,
      start: '2026-10-01T14:00',
      end: '2026-10-01T15:30',
      tz: Z,
    });
    expect(addToCalendarWhen('2026-10-01', false, '14:00', '14:00', Z)).toMatchObject({
      start: '2026-10-01T14:00',
      end: '2026-10-01T15:00',
    });
    expect(addToCalendarWhen('2026-10-01', false, '14:00', '09:00', Z)).toMatchObject({
      end: '2026-10-01T15:00',
    });
    expect(addToCalendarWhen('2026-12-31', false, '23:30', '23:30', Z)).toMatchObject({
      start: '2026-12-31T23:30',
      end: '2027-01-01T00:30',
    });
  });

  it('stores a timed event whose end equals its start as one hour', () => {
    const { board, events } = setup();
    const cal = board.createPage('calendar');
    const when = addToCalendarWhen('2026-10-01', false, '14:00', '14:00', 'Europe/Madrid');
    expect(board.addStickyToCalendar({ pageId: cal, shapeId: 's1', title: 'T', when })).toBe(cal);
    expect(events(cal)[0]?.when).toEqual({
      allDay: false,
      start: '2026-10-01T14:00',
      end: '2026-10-01T15:00',
      tz: 'Europe/Madrid',
    });
  });

  it('says so when the chosen calendar no longer exists', () => {
    const { board, notify } = setup();
    const when = { allDay: true as const, start: '2026-10-01', end: '2026-10-01' };
    expect(board.addStickyToCalendar({ pageId: 'gone', shapeId: 's1', title: 'X', when })).toBe(
      null,
    );
    expect(notify).toHaveBeenLastCalledWith('That calendar no longer exists');
  });

  it('keeps the dialog state per page', () => {
    const { board } = setup();
    board.setAddToCalendar('s1');
    expect(board.ui.getState().addToCalendar).toBe('s1');
    board.setPage(board.createPage('board'));
    expect(board.ui.getState().addToCalendar).toBeNull();
  });

  it('closes the dialog when its sticky is deleted', () => {
    const { board, doc } = setup();
    board.setAddToCalendar('s1');
    applyCommand(doc, { type: 'DeleteShapes', ids: ['s1'] });
    expect(board.ui.getState().addToCalendar).toBeNull();
  });
});
