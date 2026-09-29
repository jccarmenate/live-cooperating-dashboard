import { type Occurrence, parseDate, todayIn, toWall } from '@relay/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController, OccRef } from './calendarController';
import { HOUR_PX, SNAP_MIN, timeLabel, WEEKDAY_SHORT, weekDates, weekLayout } from './layout';
import { useEventDrag } from './MonthView';

type Gesture =
  | { kind: 'create'; date: string; from: number; to: number }
  | {
      kind: 'move';
      ref: OccRef;
      offset: number;
      length: number;
      date: string;
      top: number;
      moved: boolean;
    }
  | { kind: 'resize'; ref: OccRef; date: string; top: number; bottom: number };

const snap = (m: number) => Math.max(0, Math.min(24 * 60, Math.round(m / SNAP_MIN) * SNAP_MIN));

function minutesAt(clientY: number, column: Element): number {
  const r = column.getBoundingClientRect();
  return snap(((clientY - r.top) / HOUR_PX) * 60);
}

const columnAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-testid="cal-week-col"]') ?? null;

export function WeekView({
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
  const days = useMemo(() => weekDates(anchor), [anchor]);
  const layout = useMemo(
    () => weekLayout(occurrences, days, ctl.zone),
    [occurrences, days, ctl.zone],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const today = todayIn(Date.now(), ctl.zone);
  const now = toWall(Date.now(), ctl.zone);
  const allDayDrag = useEventDrag(ctl, canEdit);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX;
  }, []);

  const finish = (e: React.PointerEvent) => {
    const g = gesture;
    setGesture(null);
    if (!g) return;
    if (g.kind === 'create') {
      const from = Math.min(g.from, g.to);
      const to = Math.max(g.from, g.to);
      ctl.newEvent({ date: g.date, start: from, end: to > from ? to : from + 60 });
    } else if (g.kind === 'move') {
      if (!g.moved) ctl.select(g.ref);
      else ctl.move(g.ref, { date: g.date, minutes: g.top });
    } else ctl.resize(g.ref, { date: g.date, minutes: g.bottom });
    e.stopPropagation();
  };

  const isSel = (o: Occurrence) => selected?.eventId === o.eventId && selected.key === o.key;
  const lanes = Math.max(1, layout.allDayLanes);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid border-b-2 border-ink bg-paper font-mono text-[11px]"
        style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}
      >
        <div />
        {days.map((d, i) => (
          <div key={d} className={`px-2 py-1 uppercase ${d === today ? 'bg-sun' : ''}`}>
            {WEEKDAY_SHORT[i]} {parseDate(d)?.d}
          </div>
        ))}
      </div>
      <div
        className="relative grid border-b-2 border-ink bg-white"
        style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: lanes * 20 + 4 }}
      >
        <div className="px-1 font-mono text-[10px] text-ink/60">all-day</div>
        {days.map((d) => (
          <div key={d} data-date={d} className="border-l border-ink/20" />
        ))}
        {layout.allDay.map((s) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: an event is a drag target; keyboard users open the selection with Enter
          <div
            key={`${s.occ.eventId}:${s.occ.key}`}
            data-testid="cal-event"
            data-event-id={s.occ.eventId}
            data-key={s.occ.key}
            data-selected={isSel(s.occ) ? 'true' : undefined}
            onPointerDown={allDayDrag.onPointerDown({ eventId: s.occ.eventId, key: s.occ.key })}
            onPointerMove={allDayDrag.onPointerMove}
            onPointerUp={allDayDrag.onPointerUp}
            onDoubleClick={() => ctl.openEditor({ eventId: s.occ.eventId, key: s.occ.key })}
            className={`absolute truncate px-1 font-mono text-[11px] ${isSel(s.occ) ? 'outline outline-2 outline-ink' : ''}`}
            style={{
              top: 2 + s.lane * 20,
              height: 18,
              left: `calc(56px + (100% - 56px) * ${s.startCol / 7} + 2px)`,
              width: `calc((100% - 56px) * ${(s.endCol - s.startCol + 1) / 7} - 4px)`,
              background: s.occ.color,
              color: s.occ.color === '#F5D547' ? '#111111' : '#FFFFFF',
            }}
          >
            {s.occ.title}
          </div>
        ))}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: 24 * HOUR_PX }}
        >
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the 24 hour labels are fixed
                key={h}
                className="absolute right-1 font-mono text-[10px] text-ink/60"
                style={{ top: h * HOUR_PX - 6 }}
              >
                {h > 0 ? timeLabel(h * 60) : ''}
              </div>
            ))}
          </div>
          {days.map((date, day) => (
            <div
              key={date}
              data-testid="cal-week-col"
              data-date={date}
              className="relative border-l border-ink/20"
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgba(17,17,17,0.12) ${HOUR_PX - 1}px, rgba(17,17,17,0.12) ${HOUR_PX}px)`,
              }}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target !== e.currentTarget || !canEdit) return;
                const m = minutesAt(e.clientY, e.currentTarget);
                e.currentTarget.setPointerCapture(e.pointerId);
                setGesture({ kind: 'create', date, from: m, to: m });
              }}
              onPointerMove={(e) => {
                if (gesture?.kind === 'create' && gesture.date === date)
                  setGesture({ ...gesture, to: minutesAt(e.clientY, e.currentTarget) });
              }}
              onPointerUp={finish}
            >
              {layout.boxes
                .filter((b) => b.day === day)
                .map((b) => {
                  const ref = { eventId: b.occ.eventId, key: b.occ.key };
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: an event is a drag target; keyboard users open the selection with Enter
                    <div
                      key={`${b.occ.eventId}:${b.occ.key}`}
                      data-testid="cal-event"
                      data-event-id={b.occ.eventId}
                      data-key={b.occ.key}
                      data-selected={isSel(b.occ) ? 'true' : undefined}
                      className={`absolute overflow-hidden border border-ink px-1 font-mono text-[11px] ${isSel(b.occ) ? 'outline outline-2 outline-ink' : ''}`}
                      style={{
                        top: (b.top / 60) * HOUR_PX,
                        height: Math.max(12, (b.height / 60) * HOUR_PX - 1),
                        left: `${(b.col / b.cols) * 100}%`,
                        width: `${100 / b.cols}%`,
                        background: b.occ.color,
                        color: b.occ.color === '#F5D547' ? '#111111' : '#FFFFFF',
                      }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        const col = e.currentTarget.parentElement;
                        if (!col) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        if ((e.target as HTMLElement).dataset.resize) {
                          setGesture({
                            kind: 'resize',
                            ref,
                            date,
                            top: b.top,
                            bottom: b.top + b.height,
                          });
                          return;
                        }
                        setGesture({
                          kind: 'move',
                          ref,
                          offset: minutesAt(e.clientY, col) - b.top,
                          length: b.height,
                          date,
                          top: b.top,
                          moved: false,
                        });
                      }}
                      onPointerMove={(e) => {
                        if (!gesture || gesture.kind === 'create' || !canEdit) return;
                        const colEl = columnAt(e.clientX, e.clientY);
                        if (!colEl) return;
                        const m = minutesAt(e.clientY, colEl);
                        if (gesture.kind === 'resize')
                          setGesture({ ...gesture, bottom: Math.max(gesture.top + SNAP_MIN, m) });
                        else {
                          const top = snap(m - gesture.offset);
                          const target = colEl.dataset.date ?? gesture.date;
                          if (top !== gesture.top || target !== gesture.date)
                            setGesture({ ...gesture, top, date: target, moved: true });
                        }
                      }}
                      onPointerUp={finish}
                      onDoubleClick={() => ctl.openEditor(ref)}
                    >
                      <div className="font-bold">{b.occ.title}</div>
                      <div>{timeLabel(b.top)}</div>
                      {canEdit && (
                        <div
                          data-testid="cal-resize"
                          data-resize="1"
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                        />
                      )}
                    </div>
                  );
                })}
              {gesture &&
                gesture.kind !== 'create' &&
                gesture.date === date &&
                (gesture.kind === 'resize' || gesture.moved) && (
                  <div
                    data-testid="cal-drag-preview"
                    className="pointer-events-none absolute inset-x-0 border-2 border-dashed border-ink bg-ink/10"
                    style={
                      gesture.kind === 'resize'
                        ? {
                            top: (gesture.top / 60) * HOUR_PX,
                            height: ((gesture.bottom - gesture.top) / 60) * HOUR_PX,
                          }
                        : {
                            top: (gesture.top / 60) * HOUR_PX,
                            height: (gesture.length / 60) * HOUR_PX,
                          }
                    }
                  />
                )}
              {gesture?.kind === 'create' && gesture.date === date && (
                <div
                  data-testid="cal-drag-preview"
                  className="pointer-events-none absolute inset-x-0 border-2 border-dashed border-ink bg-sun/40"
                  style={{
                    top: (Math.min(gesture.from, gesture.to) / 60) * HOUR_PX,
                    height:
                      (Math.max(SNAP_MIN, Math.abs(gesture.to - gesture.from)) / 60) * HOUR_PX,
                  }}
                />
              )}
              {date === today && (
                <div
                  data-testid="cal-now"
                  className="pointer-events-none absolute inset-x-0 h-0.5 bg-flame"
                  style={{ top: ((now.hh * 60 + now.mm) / 60) * HOUR_PX }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
