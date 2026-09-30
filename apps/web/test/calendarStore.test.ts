import { applyCommand, EVENT_COLORS, LOCAL_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createCalendarStore } from '../src/store/calendarStore';
import { createDocStore } from '../src/store/docStore';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  const calendars = createCalendarStore(doc, docs.store);
  return { doc, controller, calendars };
}

describe('calendar store', () => {
  it('projects the active calendar page and follows edits; nothing on other pages', () => {
    const { doc, controller, calendars } = setup();
    expect(calendars.store.getState()).toEqual({ pageId: null, calendar: null });
    const id = controller.createPage('calendar');
    controller.setPage(id);
    expect(calendars.store.getState()).toEqual({ pageId: id, calendar: { events: [] } });
    applyCommand(
      doc,
      {
        type: 'CreateEvent',
        pageId: id,
        id: 'e1',
        fields: {
          title: 'Standup',
          color: EVENT_COLORS[0] as string,
          when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
          createdBy: 'u1',
          createdAt: 1,
        },
      },
      LOCAL_ORIGIN,
    );
    expect(calendars.store.getState().calendar?.events.map((e) => e.title)).toEqual(['Standup']);
    controller.setPage('main');
    expect(calendars.store.getState()).toEqual({ pageId: null, calendar: null });
    calendars.destroy();
  });
});
