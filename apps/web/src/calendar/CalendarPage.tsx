'use client';

import { viewerZone } from '@relay/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { mayDelete, mayEdit } from '../sync/clock';
import { toast } from '../ui/toasts';
import { CalendarHeader } from './CalendarHeader';
import { type CalendarController, createCalendarController } from './calendarController';
import { EventEditor } from './EventEditor';
import { MonthView } from './MonthView';
import { SeriesDialog } from './SeriesDialog';
import { useCalendarKeys } from './useCalendarKeys';
import { useCalendarWheel } from './useCalendarWheel';
import { WeekView } from './WeekView';

export function CalendarPage({ session }: { session: BoardSession }) {
  const hasCalendar = useStore(session.calendar, (s) => s.calendar !== null);
  const pageId = useStore(session.calendar, (s) => s.pageId);
  const [ctl, setCtl] = useState<CalendarController | null>(null);

  useEffect(() => {
    const c = createCalendarController({
      calendar: session.calendar,
      commit: session.controller.commit,
      commitSession: session.controller.commitSession,
      canEdit: () => mayEdit(session.conn.clock.getState()),
      canDelete: () => mayDelete(session.conn.clock.getState()),
      notify: toast,
      user: session.user,
      zone: viewerZone(),
      now: () => Date.now(),
    });
    // Peers see which event this user has open.
    const unsubscribe = c.ui.subscribe((s, prev) => {
      const id = s.editor?.ref?.eventId ?? null;
      if (id !== (prev.editor?.ref?.eventId ?? null)) session.publisher.setCalEvent(id);
    });
    setCtl(c);
    return () => {
      unsubscribe();
      session.publisher.setCalEvent(null);
      c.destroy();
    };
  }, [session]);

  if (!ctl) return null;
  if (!hasCalendar) {
    return (
      <div
        data-testid="unsupported-page"
        className="grid h-full place-items-center px-4 text-center font-mono text-xs"
      >
        This calendar could not be loaded.
      </div>
    );
  }
  // Per-page view state (the "+N more" popover, a live drag) starts fresh on each calendar page.
  return <CalendarBody key={pageId ?? ''} session={session} ctl={ctl} />;
}

function CalendarBody({ session, ctl }: { session: BoardSession; ctl: CalendarController }) {
  useCalendarKeys(session, ctl);
  const root = useRef<HTMLDivElement>(null);
  useCalendarWheel(root, ctl);
  const view = useStore(ctl.ui, (s) => s.view);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const monthStart = useStore(ctl.ui, (s) => s.monthStart);
  const calendar = useStore(session.calendar, (s) => s.calendar);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when the calendar or the period changes
  const { occurrences, truncated } = useMemo(
    () => ctl.visible(),
    [ctl, calendar, view, anchor, monthStart],
  );
  return (
    <div ref={root} data-testid="calendar-page" className="flex h-full min-h-0 flex-col">
      <CalendarHeader session={session} ctl={ctl} />
      {truncated && (
        <p
          data-testid="cal-truncated"
          className="border-b-2 border-ink bg-sun px-3 py-1 font-mono text-xs"
        >
          Showing the first 1000 events
        </p>
      )}
      {view === 'month' ? (
        <MonthView session={session} ctl={ctl} occurrences={occurrences} />
      ) : (
        <WeekView session={session} ctl={ctl} occurrences={occurrences} />
      )}
      <EventEditor session={session} ctl={ctl} />
      <SeriesDialog ctl={ctl} />
    </div>
  );
}
