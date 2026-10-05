import { allowedWhenFull, applyCommand, type Command, SESSION_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCalendarController } from '../src/calendar/calendarController';
import { createSheetController } from '../src/sheet/sheetController';
import { createCalendarStore } from '../src/store/calendarStore';
import { createDocStore } from '../src/store/docStore';
import { createSheetStore } from '../src/store/sheetStore';

/** Records what a controller commits, and applies it so the stores follow. */
function recorder(doc: Y.Doc) {
  const committed: Command[] = [];
  const commit = (...commands: Command[]) => {
    committed.push(...commands);
    for (const c of commands) applyCommand(doc, c);
    return true;
  };
  return { committed, commit };
}

describe('sheet controller on a full board', () => {
  function setup() {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: { id: 'p', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
        sheet: {
          rows: ['a0', 'a1'].map((order, i) => ({ id: `r${i}`, order })),
          cols: ['a0', 'a1'].map((order, i) => ({ id: `c${i}`, order })),
        },
      },
      SESSION_ORIGIN,
    );
    applyCommand(doc, {
      type: 'SetCells',
      pageId: 'p',
      cells: [
        { row: 'r0', col: 'c0', src: 'bold', fmt: { bold: true } },
        { row: 'r1', col: 'c1', src: 'plain' },
      ],
    });
    const docs = createDocStore(doc, 'p');
    const sheet = createSheetStore(doc, docs.store);
    const { committed, commit } = recorder(doc);
    const ctl = createSheetController({
      sheet: sheet.store,
      commit,
      canEdit: () => false,
      canDelete: () => true,
    });
    return { ctl, committed };
  }

  it('clears cells with their formats, so the write is a pure deletion', () => {
    const { ctl, committed } = setup();
    ctl.selectAll();
    ctl.clear();
    expect(committed).toHaveLength(1);
    expect(committed.every(allowedWhenFull)).toBe(true);
  });

  it('deletes rows but does not start an edit', () => {
    const { ctl, committed } = setup();
    ctl.startEdit('x');
    expect(ctl.ui.getState().editing).toBeNull();
    ctl.deleteRows();
    expect(committed.map((c) => c.type)).toEqual(['DeleteRows']);
  });
});

describe('calendar controller on a full board', () => {
  it('removes an event', () => {
    const doc = new Y.Doc();
    applyCommand(
      doc,
      {
        type: 'CreatePage',
        page: {
          id: 'cal',
          type: 'calendar',
          title: 'C',
          order: 'a1',
          createdBy: 'u',
          createdAt: 0,
        },
      },
      SESSION_ORIGIN,
    );
    applyCommand(doc, {
      type: 'CreateEvent',
      pageId: 'cal',
      id: 'e1',
      fields: {
        title: 'Standup',
        color: '#E85A1B',
        when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
        createdBy: 'u',
        createdAt: 0,
      },
    });
    const docs = createDocStore(doc, 'cal');
    const calendar = createCalendarStore(doc, docs.store);
    const { committed, commit } = recorder(doc);
    const ctl = createCalendarController({
      calendar: calendar.store,
      commit,
      commitSession: () => {},
      canEdit: () => false,
      canDelete: () => true,
      notify: () => {},
      user: { id: 'u', name: 'U' },
      zone: 'UTC',
      now: () => Date.UTC(2026, 9, 5),
    });
    ctl.remove({ eventId: 'e1', key: '2026-10-05' });
    expect(committed).toEqual([{ type: 'DeleteEvent', pageId: 'cal', id: 'e1' }]);
  });
});
