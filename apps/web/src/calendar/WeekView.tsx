import { dayNumber, type Occurrence, parseDate, todayIn, toWall } from '@relay/core';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { BoardSession } from '../board/session';
import { LONG_PRESS_MS, moved } from '../render/touch';
import type { CalendarController, OccRef } from './calendarController';
import { EventDots } from './EventDots';
import {
  grabMove,
  HOUR_PX,
  type MoveGrab,
  moveTarget,
  occurrenceDays,
  SNAP_MIN,
  timeLabel,
  WEEKDAY_SHORT,
  type WeekBox,
  weekDates,
  weekLayout,
} from './layout';
import { DRAG_THRESHOLD, useEventDrag } from './useEventDrag';
import { useNow } from './useNow';

const DAY_MIN = 24 * 60;

/** A live pointer gesture on the time grid. Mutated in place: moves never re-render the view. */
type Gesture =
  | { kind: 'create'; pointerId: number; col: HTMLElement; date: string; from: number; to: number }
  | {
      kind: 'move';
      pointerId: number;
      ref: OccRef;
      x: number;
      y: number;
      moved: boolean;
      grab: MoveGrab;
      /** The column under the pointer. */
      date: string;
      /** The preview in that column, and where a release drops the event. */
      top: number;
      height: number;
      drop: { date: string; minutes: number } | null;
    }
  | {
      kind: 'resize';
      pointerId: number;
      ref: OccRef;
      x: number;
      y: number;
      moved: boolean;
      date: string;
      top: number;
      bottom: number;
    };

/** What the drag preview draws: a day column (0–6) and a minute range. */
interface Preview {
  day: number;
  top: number;
  height: number;
  create: boolean;
}

const snap = (m: number) => Math.max(0, Math.min(DAY_MIN, Math.round(m / SNAP_MIN) * SNAP_MIN));

function minutesAt(clientY: number, column: Element): number {
  const r = column.getBoundingClientRect();
  return snap(((clientY - r.top) / HOUR_PX) * 60);
}

const columnAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-testid="cal-week-col"]') ?? null;

// Day columns share the width, but never narrower than --day-min (set on phones, see below).
const gridColumns = '56px repeat(7, minmax(var(--day-min, 0px), 1fr))';
const hourLines = `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgba(17,17,17,0.12) ${HOUR_PX - 1}px, rgba(17,17,17,0.12) ${HOUR_PX}px)`;
const textOn = (color: string) => (color === '#F5D547' ? '#111111' : '#FFFFFF');

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
  /** Boxes per day column; `hasEnd` marks the segment holding the event's real end. */
  const byDay = useMemo(() => {
    const out: { box: WeekBox; hasEnd: boolean }[][] = days.map(() => []);
    for (const box of layout.boxes) {
      const date = parseDate(days[box.day] ?? '');
      const hasEnd = !!date && occurrenceDays(box.occ, ctl.zone).last === dayNumber(date);
      out[box.day]?.push({ box, hasEnd });
    }
    return out;
  }, [layout, days, ctl.zone]);
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const preview = useMemo(() => createStore<Preview | null>(() => null), []);
  const now = useNow();
  const today = todayIn(now, ctl.zone);
  const nowWall = toWall(now, ctl.zone);
  const allDayDrag = useEventDrag(ctl, canEdit);
  // Touch: a finger's pending hold, which becomes a gesture once `started`.
  const hold = useRef<{
    pointerId: number;
    target: HTMLElement;
    x: number;
    y: number;
    timer: number;
    started: boolean;
  } | null>(null);
  const lastPointer = useRef('mouse');

  // Non-passive, so a held finger's drag stops the grid scrolling under it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (hold.current?.started) e.preventDefault();
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onMove);
      if (hold.current) window.clearTimeout(hold.current.timer);
    };
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX;
  }, []);

  // When the days scroll sideways (phones), each week opens on today, or else on Monday.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the shown week changes
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const col = el.querySelector<HTMLElement>(`[data-testid="cal-week-col"][data-date="${today}"]`);
    el.scrollLeft = col ? col.offsetLeft - 56 : 0;
  }, [days, today]);

  const show = (g: Gesture) => {
    const day = days.indexOf(g.date);
    if (g.kind === 'create') {
      const top = Math.min(g.from, g.to);
      preview.setState(
        { day, top, height: Math.max(SNAP_MIN, Math.abs(g.to - g.from)), create: true },
        true,
      );
    } else if (g.moved) {
      const height = g.kind === 'move' ? g.height : g.bottom - g.top;
      preview.setState({ day, top: g.top, height, create: false }, true);
    }
  };
  const clear = () => {
    gesture.current = null;
    preview.setState(null, true);
  };
  const boxOf = (el: HTMLElement, day: number) =>
    byDay[day]?.find(
      (x) => x.box.occ.eventId === el.dataset.eventId && x.box.occ.key === el.dataset.key,
    );

  /** Starts a gesture at a point on the time grid; false when there is none to start. */
  const begin = (pointerId: number, t: HTMLElement, x: number, y: number, grid: HTMLElement) => {
    const col = t.closest<HTMLElement>('[data-testid="cal-week-col"]');
    const date = col?.dataset.date;
    if (!col || !date) return false;
    const evEl = t.closest<HTMLElement>('[data-testid="cal-event"]');
    if (evEl) {
      const found = boxOf(evEl, days.indexOf(date));
      if (!found) return false;
      const b = found.box;
      const ref = { eventId: b.occ.eventId, key: b.occ.key };
      const start = { pointerId, ref, x, y, moved: false, date };
      gesture.current =
        t.dataset.resize && found.hasEnd
          ? { kind: 'resize', ...start, top: b.top, bottom: b.top + b.height }
          : {
              kind: 'move',
              ...start,
              // Measured from the event's real start: a part after midnight grabs it there.
              grab: grabMove(b.occ, date, ctl.zone, minutesAt(y, col)),
              top: b.top,
              height: b.height,
              drop: null,
            };
      // Captured by the box itself: its events still bubble to these delegated handlers,
      // and the click and double-click that follow target the box (double-click opens it).
      evEl.setPointerCapture(pointerId);
      return true;
    }
    if (!canEdit) return false;
    // A start at the bottom edge still leaves room for the shortest event.
    const m = Math.min(minutesAt(y, col), DAY_MIN - SNAP_MIN);
    gesture.current = { kind: 'create', pointerId, col, date, from: m, to: m };
    show(gesture.current);
    grid.setPointerCapture(pointerId);
    return true;
  };

  const endHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };

  /**
   * A finger's tap: on an event it selects it, or opens the selected one; on an empty slot it
   * creates a one-hour event there.
   */
  const tap = (t: HTMLElement, y: number) => {
    const evEl = t.closest<HTMLElement>('[data-testid="cal-event"]');
    const { eventId, key } = evEl?.dataset ?? {};
    if (eventId && key) {
      const sel = ctl.ui.getState().selected;
      if (sel?.eventId === eventId && sel.key === key) ctl.openEditor({ eventId, key });
      else ctl.select({ eventId, key });
      return;
    }
    const col = t.closest<HTMLElement>('[data-testid="cal-week-col"]');
    const date = col?.dataset.date;
    if (!canEdit || !col || !date) return;
    const start = Math.min(minutesAt(y, col), DAY_MIN - 60);
    ctl.newEvent({ date, start, end: start + 60 });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (e.pointerType !== 'touch') {
      begin(e.pointerId, t, e.clientX, e.clientY, e.currentTarget);
      return;
    }
    // A finger scrolls the grid; it taps, or holds still to drag (create, move, resize).
    endHold();
    const grid = e.currentTarget;
    const { pointerId, clientX: x, clientY: y } = e;
    const timer = window.setTimeout(() => {
      const h = hold.current;
      if (h?.pointerId !== pointerId) return;
      h.started = begin(pointerId, t, x, y, grid);
      if (!h.started) hold.current = null;
    }, LONG_PRESS_MS);
    hold.current = { pointerId, target: t, x, y, timer, started: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h?.pointerId === e.pointerId && !h.started) {
      // Moving before the hold completes is a scroll.
      if (moved(h, { x: e.clientX, y: e.clientY })) endHold();
      return;
    }
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === 'create') {
      g.to = minutesAt(e.clientY, g.col);
      show(g);
      return;
    }
    if (!canEdit) return;
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= DRAG_THRESHOLD) return;
      g.moved = true;
    }
    const col = columnAt(e.clientX, e.clientY);
    if (!col) return;
    const m = minutesAt(e.clientY, col);
    if (g.kind === 'resize') g.bottom = Math.max(g.top + SNAP_MIN, m);
    else {
      g.date = col.dataset.date ?? g.date;
      const t = moveTarget(g.grab, g.date, m);
      g.top = t.top;
      g.height = t.height;
      g.drop = t.drop;
    }
    show(g);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h?.pointerId === e.pointerId) {
      endHold();
      if (!h.started) {
        tap(h.target, h.y);
        return;
      }
    }
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    clear();
    if (g.kind === 'create') {
      const from = Math.min(g.from, g.to);
      const to = Math.max(g.from, g.to);
      // An end of 24:00 rolls into the next day in `newEvent`.
      ctl.newEvent({
        date: g.date,
        start: from,
        end: Math.min(DAY_MIN, to > from ? to : from + 60),
      });
    } else if (!g.moved) ctl.select(g.ref);
    else if (g.kind === 'move') {
      if (g.drop) ctl.move(g.ref, g.drop);
    } else ctl.resize(g.ref, { date: g.date, minutes: g.bottom });
  };

  const onCancel = (e: React.PointerEvent) => {
    if (hold.current?.pointerId === e.pointerId) endHold();
    if (gesture.current?.pointerId === e.pointerId) clear();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // After a finger, the second tap has already opened the event.
    if (lastPointer.current === 'touch') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-testid="cal-event"]');
    const { eventId, key } = el?.dataset ?? {};
    if (eventId && key) ctl.openEditor({ eventId, key });
  };

  const isSel = (o: Occurrence) => selected?.eventId === o.eventId && selected.key === o.key;
  const lanes = Math.max(1, layout.allDayLanes);

  return (
    // One scroller for both axes: hours scroll vertically under the sticky day header and
    // all-day row, and on a phone (columns at least DAY_MIN_W wide) the days scroll sideways
    // past the sticky hour labels.
    <div
      ref={scroller}
      data-week-scroller
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
    >
      <div className="min-w-full max-sm:w-max max-sm:[--day-min:5.5rem]">
        <div className="sticky top-0 z-20">
          <div
            className="grid border-b-2 border-ink bg-paper font-mono text-[11px]"
            style={{ gridTemplateColumns: gridColumns }}
          >
            <div className="sticky left-0 z-10 bg-paper" />
            {days.map((d, i) => (
              <div key={d} className={`px-2 py-1 uppercase ${d === today ? 'bg-sun' : ''}`}>
                {WEEKDAY_SHORT[i]} {parseDate(d)?.d}
              </div>
            ))}
          </div>
          <div
            className="relative grid border-b-2 border-ink bg-white"
            style={{ gridTemplateColumns: gridColumns, height: lanes * 20 + 4 }}
          >
            <div className="sticky left-0 z-10 bg-white px-1 font-mono text-[10px] text-ink/60">
              all-day
            </div>
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
                onPointerDown={allDayDrag.onPointerDown(s.occ)}
                onPointerMove={allDayDrag.onPointerMove}
                onPointerUp={allDayDrag.onPointerUp}
                onPointerCancel={allDayDrag.onPointerCancel}
                onLostPointerCapture={allDayDrag.onLostPointerCapture}
                onDoubleClick={allDayDrag.onDoubleClick(s.occ)}
                className={`absolute touch-none truncate px-1 font-mono text-[11px] ${isSel(s.occ) ? 'outline outline-2 outline-ink' : ''}`}
                style={{
                  top: 2 + s.lane * 20,
                  height: 18,
                  left: `calc(56px + (100% - 56px) * ${s.startCol / 7} + 2px)`,
                  width: `calc((100% - 56px) * ${(s.endCol - s.startCol + 1) / 7} - 4px)`,
                  background: s.occ.color,
                  color: textOn(s.occ.color),
                }}
              >
                {s.occ.title}
                <EventDots session={session} eventId={s.occ.eventId} />
              </div>
            ))}
          </div>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the time grid is a drag surface; keyboard users create with N and open with Enter */}
        <div
          className="relative grid"
          style={{ gridTemplateColumns: gridColumns, height: 24 * HOUR_PX }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onCancel}
          onLostPointerCapture={onCancel}
          onDoubleClick={onDoubleClick}
        >
          <div className="sticky left-0 z-10 bg-white">
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
              // Fingers pan the grid; drags start with a long press (see onPointerDown).
              className="relative touch-manipulation border-l border-ink/20"
              style={{ backgroundImage: hourLines }}
            >
              {byDay[day]?.map(({ box, hasEnd }) => (
                <EventBox
                  key={`${box.occ.eventId}:${box.occ.key}`}
                  session={session}
                  box={box}
                  selected={isSel(box.occ)}
                  resizable={canEdit && hasEnd}
                />
              ))}
              {date === today && (
                <div
                  data-testid="cal-now"
                  className="pointer-events-none absolute inset-x-0 h-0.5 bg-flame"
                  style={{ top: ((nowWall.hh * 60 + nowWall.mm) / 60) * HOUR_PX }}
                />
              )}
            </div>
          ))}
          <DragPreview store={preview} />
        </div>
      </div>
    </div>
  );
}

/** A timed event box; its gestures are handled by the time grid (delegated by data attributes). */
const EventBox = memo(function EventBox({
  session,
  box,
  selected,
  resizable,
}: {
  /** Stable: the peer dots subscribe to presence themselves, past the memo. */
  session: BoardSession;
  box: WeekBox;
  selected: boolean;
  resizable: boolean;
}) {
  const { occ } = box;
  return (
    <div
      data-testid="cal-event"
      data-event-id={occ.eventId}
      data-key={occ.key}
      data-selected={selected ? 'true' : undefined}
      className={`absolute touch-manipulation overflow-hidden border border-ink px-1 font-mono text-[11px] ${selected ? 'outline outline-2 outline-ink' : ''}`}
      style={{
        top: (box.top / 60) * HOUR_PX,
        height: Math.max(12, (box.height / 60) * HOUR_PX - 1),
        left: `${(box.col / box.cols) * 100}%`,
        width: `${100 / box.cols}%`,
        background: occ.color,
        color: textOn(occ.color),
      }}
    >
      <div className="font-bold">{occ.title}</div>
      <div>{timeLabel(box.top)}</div>
      {resizable && (
        <div
          data-testid="cal-resize"
          data-resize="1"
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize pointer-coarse:h-3"
        />
      )}
      <EventDots session={session} eventId={occ.eventId} />
    </div>
  );
});

/** The drag preview owns its subscription, so a pointer move re-renders only this element. */
function DragPreview({ store }: { store: StoreApi<Preview | null> }) {
  const p = useStore(store);
  if (!p || p.day < 0) return null;
  return (
    <div
      data-testid="cal-drag-preview"
      className={`pointer-events-none absolute border-2 border-dashed border-ink ${p.create ? 'bg-sun/40' : 'bg-ink/10'}`}
      style={{
        top: (p.top / 60) * HOUR_PX,
        height: (p.height / 60) * HOUR_PX,
        left: `calc(56px + (100% - 56px) * ${p.day / 7})`,
        width: 'calc((100% - 56px) / 7)',
      }}
    />
  );
}
