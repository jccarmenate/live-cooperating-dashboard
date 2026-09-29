import { dayNumber, type Occurrence, parseDate, todayIn, toWall } from '@relay/core';
import { useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController, OccRef } from './calendarController';
import {
  firstOfGrid,
  MONTH_LINES,
  monthGrid,
  monthLayout,
  occurrenceDays,
  timeLabel,
  WEEKDAY_SHORT,
} from './layout';

const LINE = 20;
const HEAD = 22;

/** Pointer gestures on an event: a click selects, a drag onto another day moves it. */
export function useEventDrag(ctl: CalendarController, canEdit: boolean) {
  const drag = useRef<{ ref: OccRef; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (ref: OccRef) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { ref, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      ctl.select(d.ref);
      return;
    }
    if (!canEdit) return;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-date]');
    const date = target?.dataset.date;
    if (date) ctl.move(d.ref, { date });
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

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
  const [popover, setPopover] = useState<string | null>(null);
  const a = parseDate(anchor) ?? { y: 1970, m: 1, d: 1 };
  const cells = monthGrid(a.y, a.m, todayIn(Date.now(), ctl.zone));
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
    onPointerDown: drag.onPointerDown({ eventId: o.eventId, key: o.key }),
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.onPointerUp,
    onDoubleClick: () => ctl.openEditor({ eventId: o.eventId, key: o.key }),
  });
  const popIndex = popover ? cells.findIndex((c) => c.date === popover) : -1;
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
                  className={`relative min-h-0 overflow-hidden border-r border-ink/20 px-1 ${cell.inMonth ? 'bg-white' : 'bg-paper text-ink/40'}`}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && canEdit) ctl.newEvent({ date: cell.date });
                  }}
                >
                  <span
                    className={`font-mono text-[11px] ${cell.today ? 'bg-flame px-1 text-white' : ''}`}
                  >
                    {cell.day}
                  </span>
                  <div style={{ marginTop: reserved * LINE }} className="flex flex-col gap-0.5">
                    {day.chips.map((o) => (
                      <div
                        key={`${o.eventId}:${o.key}`}
                        {...eventProps(o)}
                        className={`truncate px-1 font-mono text-[11px] ${isSel(o) ? 'outline outline-2 outline-ink' : ''}`}
                        style={{ height: LINE - 2, borderLeft: `4px solid ${o.color}` }}
                      >
                        {o.when.allDay ? '' : `${timeLabel(minutesOfDay(o.start, ctl.zone))} `}
                        {o.title}
                      </div>
                    ))}
                    {day.more > 0 && (
                      <button
                        type="button"
                        data-testid="cal-more"
                        className="text-left font-mono text-[11px] underline"
                        onClick={() => setPopover(cell.date)}
                      >
                        +{day.more} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {popIndex >= 0 && Math.floor(popIndex / 7) === row && (
              // Outside the day cell, which clips its content: anchored to the cell's column,
              // opening upwards in the lower rows and leftwards in the last columns.
              <div
                data-testid="cal-day-popover"
                className="absolute z-20 max-h-72 w-56 overflow-y-auto border-2 border-ink bg-white p-2 shadow-hard"
                style={{
                  ...(row < 3 ? { top: 0 } : { bottom: 0 }),
                  ...(popIndex % 7 < 5
                    ? { left: `${((popIndex % 7) / 7) * 100}%` }
                    : { right: `${((6 - (popIndex % 7)) / 7) * 100}%` }),
                }}
              >
                <div className="mb-1 flex justify-between font-mono text-xs">
                  <span>{popover}</span>
                  <button type="button" aria-label="Close" onClick={() => setPopover(null)}>
                    ×
                  </button>
                </div>
                {dayItems(popIndex).map((o) => (
                  <div
                    key={`${o.eventId}:${o.key}`}
                    {...eventProps(o)}
                    className="truncate font-mono text-[11px]"
                    style={{ borderLeft: `4px solid ${o.color}`, paddingLeft: 4 }}
                  >
                    {o.title}
                  </div>
                ))}
              </div>
            )}
            {layout.bars
              .filter((b) => b.row === row)
              .map((b) => (
                <div
                  key={`${b.occ.eventId}:${b.occ.key}:${row}`}
                  {...eventProps(b.occ)}
                  className={`absolute truncate px-1 font-mono text-[11px] text-white ${isSel(b.occ) ? 'outline outline-2 outline-ink' : ''}`}
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
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function minutesOfDay(ms: number, zone: string): number {
  const w = toWall(ms, zone);
  return w.hh * 60 + w.mm;
}
