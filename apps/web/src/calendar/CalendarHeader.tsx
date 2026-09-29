import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController } from './calendarController';
import { periodTitle } from './layout';

/** A header button without a background: one bg class each, so none overrides another. */
const base =
  'grid h-8 place-items-center border-2 border-ink px-2 font-mono text-xs uppercase hover:bg-paper';
const btn = `${base} bg-white`;

export function CalendarHeader({
  session,
  ctl,
}: {
  session: BoardSession;
  ctl: CalendarController;
}) {
  const view = useStore(ctl.ui, (s) => s.view);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink bg-white px-3 py-2">
      <button
        type="button"
        data-testid="cal-prev"
        aria-label="Previous"
        className={btn}
        onClick={() => ctl.step(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      <button type="button" data-testid="cal-today" className={btn} onClick={() => ctl.today()}>
        Today
      </button>
      <button
        type="button"
        data-testid="cal-next"
        aria-label="Next"
        className={btn}
        onClick={() => ctl.step(1)}
      >
        <ChevronRight size={14} />
      </button>
      <div className="flex">
        {(['month', 'week'] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-testid={`cal-view-${v}`}
            aria-pressed={view === v}
            className={`${base} ${view === v ? 'bg-sun' : 'bg-white'} -ml-0.5 first:ml-0`}
            onClick={() => ctl.setView(v)}
          >
            {v === 'month' ? 'Month' : 'Week'}
          </button>
        ))}
      </div>
      <h2 data-testid="cal-title" className="min-w-40 font-display text-base">
        {periodTitle(view, anchor)}
      </h2>
      <div className="ml-auto flex items-center gap-3">
        {canEdit && (
          <button
            type="button"
            data-testid="cal-new"
            className={`${base} bg-sun`}
            onClick={() => ctl.newEvent()}
          >
            <span className="flex items-center gap-1">
              <Plus size={12} /> New event
            </span>
          </button>
        )}
        <span data-testid="cal-zone" className="font-mono text-[11px] text-ink/60">
          Times in {ctl.zone}
        </span>
      </div>
    </div>
  );
}
