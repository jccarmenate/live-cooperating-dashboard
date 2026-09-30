import { applyCommand, getRoots, readCalendar } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';
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
