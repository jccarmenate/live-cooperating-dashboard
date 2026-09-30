import { todayIn, viewerZone } from '@relay/core';
import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { addToCalendarWhen } from './addToCalendarWhen';
import { Dialog } from './Dialog';
import { stickyTitle } from './stickyTitle';

const input = 'w-full border-2 border-ink bg-white px-2 py-1 font-mono text-xs';
const label = 'flex flex-col gap-1 font-mono text-[11px] uppercase text-ink/70';

export function AddToCalendarDialog({ session }: { session: BoardSession }) {
  const shapeId = useStore(session.controller.ui, (s) => s.addToCalendar);
  if (!shapeId) return null;
  return <AddToCalendarForm key={shapeId} session={session} shapeId={shapeId} />;
}

function AddToCalendarForm({ session, shapeId }: { session: BoardSession; shapeId: string }) {
  const pages = useStore(session.doc, (d) => d.pages);
  const calendars = pages.filter((p) => p.type === 'calendar');
  const text = useStore(session.doc, (d) => d.shapes[shapeId]?.text);
  const zone = viewerZone();
  const nextHour = Math.min(23, new Date().getHours() + 1);
  const [page, setPage] = useState<string>(calendars[0]?.id ?? '__new');
  const [title, setTitle] = useState(stickyTitle(text));
  const [date, setDate] = useState(todayIn(Date.now(), zone));
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState(`${String(nextHour).padStart(2, '0')}:00`);
  const [end, setEnd] = useState(
    `${String(Math.min(23, nextHour + 1)).padStart(2, '0')}:${nextHour === 23 ? '45' : '00'}`,
  );
  const close = useCallback(() => session.controller.setAddToCalendar(null), [session]);
  // A chosen calendar that a peer deleted falls back to the first one left, or to a new one.
  const chosen =
    page === '__new' || calendars.some((c) => c.id === page) ? page : (calendars[0]?.id ?? '__new');
  const submit = () => {
    session.controller.addStickyToCalendar({
      pageId: chosen === '__new' ? null : chosen,
      shapeId,
      title,
      when: addToCalendarWhen(date, allDay, start, end, zone),
    });
  };
  return (
    <Dialog title="Add to calendar" onClose={close}>
      <form
        data-testid="add-cal-dialog"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={label}>
          Calendar
          <select
            data-testid="add-cal-page"
            className={input}
            value={chosen}
            onChange={(e) => setPage(e.target.value)}
          >
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="__new">New calendar page</option>
          </select>
        </label>
        <label className={label}>
          Title
          <input
            data-testid="add-cal-title"
            className={input}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className={label}>
          Date
          <input
            data-testid="add-cal-date"
            type="date"
            required
            className={input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 font-mono text-xs">
          <input
            data-testid="add-cal-allday"
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All day
        </label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              Start
              <input
                data-testid="add-cal-start"
                type="time"
                required
                step={900}
                className={input}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className={label}>
              End
              <input
                data-testid="add-cal-end"
                type="time"
                required
                step={900}
                className={input}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs uppercase"
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="add-cal-submit"
            className="border-2 border-ink bg-sun px-3 py-1.5 font-mono text-xs uppercase"
          >
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
