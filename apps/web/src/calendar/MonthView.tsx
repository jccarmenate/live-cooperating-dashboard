import { dayNumber, type Occurrence, parseDate, todayIn, toWall } from '@relay/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController } from './calendarController';
import { EventDots } from './EventDots';
import {
  firstOfGrid,
  MONTH_LINES,
  monthGrid,
  monthLayout,
  occurrenceDays,
  timeLabel,
  WEEKDAY_SHORT,
} from './layout';
import { useEventDrag } from './useEventDrag';
import { useNow } from './useNow';

const LINE = 20;
const HEAD = 22;

export function MonthView({
  session,
  ctl,
  occurrences,
}: {
  session: BoardSession;
  ctl: CalendarController;
  occurrences: Occurrence[];
}) {
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const selected = useStore(ctl.ui, (s) => s.selected);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  // The popover belongs to the period it was opened in: navigating closes it.
  const [popover, setPopover] = useState<{ date: string; anchor: string } | null>(null);
  const openDate = popover?.anchor === anchor ? popover.date : null;
  const now = useNow();
  const a = parseDate(anchor) ?? { y: 1970, m: 1, d: 1 };
  const cells = monthGrid(a.y, a.m, todayIn(now, ctl.zone));
  const layout = useMemo(
    () => monthLayout(occurrences, firstOfGrid(a.y, a.m), ctl.zone),
    [occurrences, a.y, a.m, ctl.zone],
  );
  const drag = useEventDrag(ctl, canEdit);
  const isSel = (o: Occurrence) => selected?.eventId === o.eventId && selected.key === o.key;
  const eventProps = (o: Occurrence) => ({
    'data-testid': 'cal-event',
    'data-event-id': o.eventId,
    'data-key': o.key,
    'data-selected': isSel(o) ? 'true' : undefined,
    title: o.title,
    onPointerDown: drag.onPointerDown(o),
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.onPointerUp,
    onPointerCancel: drag.onPointerCancel,
    onLostPointerCapture: drag.onLostPointerCapture,
    onDoubleClick: () => ctl.openEditor({ eventId: o.eventId, key: o.key }),
  });
  const popIndex = openDate ? cells.findIndex((c) => c.date === openDate) : -1;
  /** Every occurrence on a day, including those hidden behind "+N more". */
  const dayItems = (index: number) => {
    const date = parseDate(cells[index]?.date ?? '');
    if (!date) return [];
    const n = dayNumber(date);
    return occurrences.filter((o) => {
      const { first, last } = occurrenceDays(o, ctl.zone);
      return first <= n && n <= last;
    });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b-2 border-ink bg-paper font-mono text-[11px] uppercase">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="relative grid grid-cols-7 border-b border-ink/20">
            {cells.slice(row * 7, row * 7 + 7).map((cell, col) => {
              const index = row * 7 + col;
              const day = layout.days[index] ?? { chips: [], more: 0 };
              const reserved = Math.min(layout.rowLanes[row] ?? 0, MONTH_LINES);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: a day cell is a click target for creating an event
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users create events with N
                <div
                  key={cell.date}
                  data-testid="cal-day"
                  data-date={cell.date}
                  className={`relative flex min-h-0 flex-col overflow-hidden border-r border-ink/20 px-1 ${cell.inMonth ? 'bg-white' : 'bg-paper text-ink/40'}`}
                  onClick={(e) => {
                    // The day number and the space around the chips create; events and
                    // "+N more" keep their own clicks.
                    const t = e.target as Element;
                    if (
                      !canEdit ||
                      t.closest('[data-testid="cal-event"], [data-testid="cal-more"]')
                    )
                      return;
                    ctl.newEvent({ date: cell.date });
                  }}
                >
                  <span
                    className={`self-start font-mono text-[11px] ${cell.today ? 'bg-flame px-1 text-white' : ''}`}
                  >
                    {cell.day}
                  </span>
                  <div style={{ marginTop: reserved * LINE }} className="flex flex-col gap-0.5">
                    {day.chips.map((o) => (
                      <div
                        key={`${o.eventId}:${o.key}`}
                        {...eventProps(o)}
                        className={`relative touch-none truncate px-1 font-mono text-[11px] ${isSel(o) ? 'outline outline-2 outline-ink' : ''}`}
                        style={{ height: LINE - 2, borderLeft: `4px solid ${o.color}` }}
                      >
                        {o.when.allDay ? '' : `${timeLabel(minutesOfDay(o.start, ctl.zone))} `}
                        {o.title}
                        <EventDots session={session} eventId={o.eventId} />
                      </div>
                    ))}
                    {day.more > 0 && (
                      <button
                        type="button"
                        data-testid="cal-more"
                        className="self-start text-left font-mono text-[11px] underline"
                        onClick={() => setPopover({ date: cell.date, anchor })}
                      >
                        +{day.more} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {openDate && popIndex >= 0 && Math.floor(popIndex / 7) === row && (
              <DayPopover
                date={openDate}
                row={row}
                col={popIndex % 7}
                ctl={ctl}
                onClose={() => setPopover(null)}
              >
                {dayItems(popIndex).map((o) => (
                  <div
                    key={`${o.eventId}:${o.key}`}
                    {...eventProps(o)}
                    className="relative touch-pan-y truncate font-mono text-[11px]"
                    style={{ borderLeft: `4px solid ${o.color}`, paddingLeft: 4 }}
                  >
                    {o.title}
                    <EventDots session={session} eventId={o.eventId} />
                  </div>
                ))}
              </DayPopover>
            )}
            {layout.bars
              .filter((b) => b.row === row)
              .map((b) => (
                <div
                  key={`${b.occ.eventId}:${b.occ.key}:${row}`}
                  {...eventProps(b.occ)}
                  className={`absolute touch-none truncate px-1 font-mono text-[11px] text-white ${isSel(b.occ) ? 'outline outline-2 outline-ink' : ''}`}
                  style={{
                    top: HEAD + b.lane * LINE,
                    height: LINE - 2,
                    left: `calc(${(b.startCol / 7) * 100}% + 2px)`,
                    width: `calc(${((b.endCol - b.startCol + 1) / 7) * 100}% - 4px)`,
                    background: b.occ.color,
                    color: b.occ.color === '#F5D547' ? '#111111' : '#FFFFFF',
                  }}
                >
                  {b.occ.title}
                  <EventDots session={session} eventId={b.occ.eventId} />
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The "+N more" list, outside the day cell (which clips its content): anchored to the cell's
 * column, opening upwards in the lower rows and leftwards in the last columns. Escape, a press
 * outside and an editor opening close it. Its items pan vertically on touch (a touch scroll of
 * the list cancels an item drag); a mouse still drags them.
 */
function DayPopover({
  date,
  row,
  col,
  ctl,
  onClose,
  children,
}: {
  date: string;
  row: number;
  col: number;
  ctl: CalendarController;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Capture phase: Escape closes the popover without also clearing the selection. An open
    // dialog (the editor or a series question) keeps its own Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { editor, question } = ctl.ui.getState();
      if (editor || question) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
      e.stopPropagation();
      close.current();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !box.current?.contains(e.target)) close.current();
    };
    // An editor opened from one of the items (or anywhere else) covers the list: close it.
    const unsubscribe = ctl.ui.subscribe((s, prev) => {
      if (s.editor && !prev.editor) close.current();
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [ctl]);
  return (
    <div
      ref={box}
      data-testid="cal-day-popover"
      data-date={date}
      className="absolute z-20 max-h-72 w-56 overflow-y-auto border-2 border-ink bg-white p-2 shadow-hard"
      style={{
        ...(row < 3 ? { top: 0 } : { bottom: 0 }),
        ...(col < 5 ? { left: `${(col / 7) * 100}%` } : { right: `${((6 - col) / 7) * 100}%` }),
      }}
    >
      <div className="mb-1 flex justify-between font-mono text-xs">
        <span>{date}</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

function minutesOfDay(ms: number, zone: string): number {
  const w = toWall(ms, zone);
  return w.hh * 60 + w.mm;
}
