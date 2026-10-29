import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { mayEdit } from '../sync/clock';
import { Dialog } from '../ui/Dialog';
import type { CalendarController } from './calendarController';

const btn = 'border-2 border-ink px-3 py-1.5 pointer-coarse:py-2.5 font-mono text-xs uppercase';

/**
 * "Only this event" / "All events" for an action on one occurrence of a series. A changed rule
 * applies to the whole series only, and so does a delete on a full board (one occurrence would
 * need an exception), so those questions offer no "Only this event". The board can fill while
 * the dialog is open: the offer follows the live access as well as the question.
 */
export function SeriesDialog({ session, ctl }: { session: BoardSession; ctl: CalendarController }) {
  const q = useStore(ctl.ui, (s) => s.question);
  const canEdit = useStore(session.conn.clock, mayEdit);
  if (!q) return null;
  const allOnly = q.allOnly === true || !canEdit;
  return (
    <Dialog title="Repeating event" onClose={() => ctl.answer(null)}>
      <div data-testid="cal-series" className="flex flex-col gap-3 font-mono text-xs">
        <p>
          {q.action === 'delete'
            ? allOnly
              ? 'Delete all events in the series?'
              : 'Delete only this event, or all events in the series?'
            : 'Change only this event, or all events in the series?'}
        </p>
        {q.drops > 0 && (
          <p data-testid="cal-series-drops" className="border-2 border-flame px-2 py-1">
            Changing all events clears {q.drops} changed{' '}
            {q.drops === 1 ? 'occurrence' : 'occurrences'}.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="cal-series-cancel"
            className={`${btn} bg-white`}
            onClick={() => ctl.answer(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="cal-series-all"
            className={`${btn} ${allOnly ? 'bg-sun' : 'bg-white'}`}
            onClick={() => ctl.answer('all')}
          >
            All events
          </button>
          {!allOnly && (
            <button
              type="button"
              data-testid="cal-series-one"
              className={`${btn} bg-sun`}
              onClick={() => ctl.answer('one')}
            >
              Only this event
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
