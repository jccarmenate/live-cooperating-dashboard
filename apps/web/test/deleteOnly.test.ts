import {
  allowedWhenFull,
  applyCommand,
  type Command,
  type EventFields,
  SESSION_ORIGIN,
  type When,
} from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCalendarController, type EditorDraft } from '../src/calendar/calendarController';
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
  interface Allow {
    canEdit: boolean;
    canDelete: boolean;
  }

  /**
   * A calendar page with an event that does not repeat (`e1`) and a daily one (`r1`). What the
   * board allows can change mid-test, as it does when the board fills while a question is open.
   */
  function setup(initial: Allow) {
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
    const day: When = { allDay: true, start: '2026-10-05', end: '2026-10-05' };
    const create = (id: string, extra: Partial<EventFields> = {}) =>
      applyCommand(doc, {
        type: 'CreateEvent',
        pageId: 'cal',
        id,
        fields: {
          title: 'Standup',
          color: '#E85A1B',
          when: day,
          createdBy: 'u',
          createdAt: 0,
          ...extra,
        },
      });
    create('e1');
    create('r1', { rule: { freq: 'daily', interval: 1 } });
    const docs = createDocStore(doc, 'cal');
    const calendar = createCalendarStore(doc, docs.store);
    const { committed, commit } = recorder(doc);
    let access = initial;
    const ctl = createCalendarController({
      calendar: calendar.store,
      commit,
      commitSession: () => {},
      canEdit: () => access.canEdit,
      canDelete: () => access.canDelete,
      notify: () => {},
      user: { id: 'u', name: 'U' },
      zone: 'UTC',
      now: () => Date.UTC(2026, 9, 5),
    });
    return {
      ctl,
      committed,
      /** What the board allows from now on. */
      allow(next: Allow) {
        access = next;
      },
    };
  }

  it('removes an event', () => {
    const { ctl, committed } = setup({ canEdit: false, canDelete: true });
    ctl.remove({ eventId: 'e1', key: '2026-10-05' });
    expect(committed).toEqual([{ type: 'DeleteEvent', pageId: 'cal', id: 'e1' }]);
  });

  it('removes a repeating event only whole', () => {
    const { ctl, committed } = setup({ canEdit: false, canDelete: true });
    ctl.remove({ eventId: 'r1', key: '2026-10-06' });
    expect(ctl.ui.getState().question).toEqual({ action: 'delete', drops: 0, allOnly: true });
    // "Only this event" would write an exception, which a full board refuses.
    ctl.answer('one');
    expect(committed).toEqual([]);
    expect(ctl.ui.getState().question).toEqual({ action: 'delete', drops: 0, allOnly: true });
    ctl.answer('all');
    expect(committed).toEqual([{ type: 'DeleteEvent', pageId: 'cal', id: 'r1' }]);
  });

  it('a delete asked while the board took edits can only go whole once it is full', () => {
    const { ctl, committed, allow } = setup({ canEdit: true, canDelete: true });
    ctl.remove({ eventId: 'r1', key: '2026-10-06' });
    expect(ctl.ui.getState().question).toEqual({ action: 'delete', drops: 0 });
    // The board fills while the question is open.
    allow({ canEdit: false, canDelete: true });
    ctl.answer('one');
    expect(committed).toEqual([]);
    expect(ctl.ui.getState().question).toEqual({ action: 'delete', drops: 0 });
    ctl.answer('all');
    expect(committed).toEqual([{ type: 'DeleteEvent', pageId: 'cal', id: 'r1' }]);
  });

  it('a change asked while the board took edits is not saved once it is full', () => {
    const { ctl, committed, allow } = setup({ canEdit: true, canDelete: true });
    ctl.openEditor({ eventId: 'r1', key: '2026-10-06' });
    const draft = ctl.ui.getState().editor?.draft as EditorDraft;
    ctl.save({ ...draft, title: 'Renamed' });
    expect(ctl.ui.getState().question).toEqual({ action: 'save', drops: 0 });
    // The board fills while the question is open. It would drop the write and report success.
    allow({ canEdit: false, canDelete: true });
    ctl.answer('all');
    expect(committed).toEqual([]);
    expect(ctl.ui.getState().question).toBeNull();
    // The editor does not close as if the change had been saved.
    expect(ctl.ui.getState().editor).not.toBeNull();
  });
});
